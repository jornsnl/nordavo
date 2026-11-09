import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { askJson, hasClaude } from "@/lib/ai/claude";
import { PROFILE_SYSTEM, profileContentSchema, profileInput, type ProfileContent } from "@/lib/ai/prompts/profile";
import type { Database, Json, MatchStatus } from "@/lib/database.types";
import { collectText, findIdentifierLeaks, leakMessage, profileCode, redactIdentifiers, type CandidateIdentifiers } from "@/lib/talent/anonymize";
import { advanceStage } from "@/lib/talent/match";
import { getPoolCandidate, type PoolCandidate } from "@/lib/talent/pool";
import { requirementsPayload } from "@/lib/talent/prefilter";
import { renderProfilePdf } from "@/lib/talent/profile-pdf";
import { ATTACHMENTS_BUCKET } from "@/lib/storage";

/**
 * T4 anonymous profile and T5 approval and sending.
 * Rule 12: Claude sees only redacted fields; the code check rejects any
 * profile that still contains a name part, email, phone or employer.
 * Rule 13: sent only with consent (the candidate's profile consent field in
 * the portal, or a staff confirmation while it is unknown). Rule 14: a human approves before sending;
 * the database refuses sent_at without approval and consent.
 */

type Db = SupabaseClient<Database>;

/** Stored in anonymous_profiles.content: the anonymous profile plus bookkeeping. */
export type StoredProfileContent = ProfileContent & {
  code: string;
  generated_at: string;
  /** candidate: the consent field on the candidate; staff: confirmed by a team member. */
  consent_source: "candidate" | "staff" | null;
  consent_confirmed_by?: string | null;
  consent_confirmed_at?: string | null;
};

const APPROVED_MATCH: MatchStatus[] = ["goedgekeurd", "verstuurd", "gesprek", "aangenomen"];

export function profileStoragePath(vacancyId: string, profileId: string) {
  return `vacancy/${vacancyId}/profiles/${profileId}.pdf`;
}

function identifiersOf(c: PoolCandidate): CandidateIdentifiers {
  return { nameParts: c.nameParts, email: c.email, phone: c.phone, employers: c.employers, skills: c.skills };
}

/** What Claude may see to write the profile: only the needed fields, identifiers redacted. */
function profilePayload(c: PoolCandidate) {
  const ids = identifiersOf(c);
  const text = [c.summary, c.cvText].filter(Boolean).join("\n\n");
  return {
    skills: c.skills,
    years_experience: c.yearsExperience,
    seniority: c.seniority,
    current_role: c.currentTitle ? redactIdentifiers(c.currentTitle, ids) : null,
    project_types: c.projectTypes,
    sectors: c.sectors,
    english_level: c.englishLevel,
    availability: c.availability,
    experience: text ? redactIdentifiers(text, ids).slice(0, 6000) : null,
  };
}

function readConsentSource(value: unknown): StoredProfileContent["consent_source"] {
  return value === "candidate" || value === "staff" ? value : null;
}

export function readProfileContent(value: Json): StoredProfileContent | null {
  const parsed = profileContentSchema.safeParse(value);
  if (!parsed.success || !value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  return {
    ...parsed.data,
    code: typeof v.code === "string" ? v.code : "",
    generated_at: typeof v.generated_at === "string" ? v.generated_at : "",
    consent_source: readConsentSource(v.consent_source),
    consent_confirmed_by: typeof v.consent_confirmed_by === "string" ? v.consent_confirmed_by : null,
    consent_confirmed_at: typeof v.consent_confirmed_at === "string" ? v.consent_confirmed_at : null,
  };
}

async function loadMatch(db: Db, matchId: string) {
  const { data, error } = await db
    .from("matches")
    .select(
      "id, vacancy_id, candidate_id, status, reason, risks, missing, vacancy:vacancies(id, title, stack, seniority, hours, timezone_overlap, budget_min, budget_max, client_contact_required, must_haves, nice_to_haves)",
    )
    .eq("id", matchId)
    .maybeSingle();
  if (error) throw new Error(`Could not load the match: ${error.message}`);
  if (!data || !data.vacancy) throw new Error("This match no longer exists.");
  return { ...data, vacancy: data.vacancy };
}

async function loadCandidate(db: Db, candidateId: string) {
  const candidate = await getPoolCandidate(db, candidateId);
  if (!candidate) throw new Error("This candidate no longer exists in the portal. Reject the match.");
  return candidate;
}

export async function generateAnonymousProfile(db: Db, matchId: string): Promise<{ profileId: string; code: string }> {
  if (!hasClaude()) throw new Error("ANTHROPIC_API_KEY is missing: a profile cannot be made without Claude.");
  const match = await loadMatch(db, matchId);
  if (!APPROVED_MATCH.includes(match.status)) {
    throw new Error("Approve the match first. Then make the anonymous profile.");
  }
  const candidate = await loadCandidate(db, match.candidate_id);
  const ids = identifiersOf(candidate);
  const vacancy = requirementsPayload(match.vacancy);
  const payload = profilePayload(candidate);
  const matchInfo = { reason: match.reason, risks: match.risks, missing: match.missing };

  let content: ProfileContent | null = null;
  let leakKinds: string[] = [];
  for (let attempt = 0; attempt < 2 && !content; attempt += 1) {
    const retryNote =
      attempt > 0
        ? `de vorige versie bevatte nog ${leakKinds.join(", ")}. Laat elke naam, elk contactgegeven en elke werkgever weg en beschrijf werkgevers generiek.`
        : undefined;
    const draft = await askJson({
      system: PROFILE_SYSTEM,
      input: profileInput(vacancy, payload, matchInfo, retryNote),
      schema: profileContentSchema,
    });
    const leaks = findIdentifierLeaks(collectText(draft), ids);
    if (leaks.length === 0) content = draft;
    else leakKinds = [...new Set(leaks.map((l) => l.kind))];
    if (attempt === 1 && !content) throw new Error(leakMessage(leaks));
  }
  if (!content) throw new Error("The profile could not be made.");

  const profileId = crypto.randomUUID();
  const code = profileCode(profileId);
  const now = new Date().toISOString();
  const stored: StoredProfileContent = {
    ...content,
    years_experience: content.years_experience === null ? null : Math.max(0, Math.round(content.years_experience)),
    code,
    generated_at: now,
    consent_source: candidate.consent === true ? "candidate" : null,
  };

  const pdf = await renderProfilePdf(stored, { code, vacancyTitle: match.vacancy.title, date: now.slice(0, 10) });
  const path = profileStoragePath(match.vacancy_id, profileId);
  const { error: uploadError } = await db.storage
    .from(ATTACHMENTS_BUCKET)
    .upload(path, pdf, { contentType: "application/pdf", upsert: false });
  if (uploadError) throw new Error(`Could not save the PDF: ${uploadError.message}`);

  const { error } = await db.from("anonymous_profiles").insert({
    id: profileId,
    match_id: match.id,
    content: stored as unknown as Json,
    file_url: path,
    consent_confirmed: candidate.consent === true,
  });
  if (error) {
    await db.storage.from(ATTACHMENTS_BUCKET).remove([path]);
    throw new Error(`Could not save the profile: ${error.message}`);
  }
  return { profileId, code };
}

async function loadProfile(db: Db, profileId: string) {
  const { data, error } = await db
    .from("anonymous_profiles")
    .select("id, match_id, content, consent_confirmed, approved_at, sent_at, match:matches(id, vacancy_id, candidate_id, status)")
    .eq("id", profileId)
    .maybeSingle();
  if (error) throw new Error(`Could not load the profile: ${error.message}`);
  if (!data || !data.match) throw new Error("This profile no longer exists.");
  return { ...data, match: data.match };
}

/** Rule 14: a staff member (Floris or the recruiter) approves the profile. */
export async function approveProfile(db: Db, profileId: string, userId: string) {
  const profile = await loadProfile(db, profileId);
  if (profile.sent_at) throw new Error("This profile has already been sent.");
  const { error } = await db
    .from("anonymous_profiles")
    .update({ approved_by: userId, approved_at: new Date().toISOString() })
    .eq("id", profileId);
  if (error) throw new Error(`Could not approve: ${error.message}`);
  return profile.match.vacancy_id;
}

/**
 * Rule 13 fallback while the candidate's consent is unknown: a staff member
 * confirms the candidate agreed. An explicit "no" on the candidate always wins.
 */
export async function confirmConsentByStaff(db: Db, profileId: string, userId: string) {
  const profile = await loadProfile(db, profileId);
  const candidate = await loadCandidate(db, profile.match.candidate_id);
  if (candidate.consent === false) {
    throw new Error("The candidate's profile says they did not give consent. Change it on the candidate first if that is wrong.");
  }
  const content = (profile.content && typeof profile.content === "object" && !Array.isArray(profile.content) ? profile.content : {}) as Record<string, Json>;
  const { error } = await db
    .from("anonymous_profiles")
    .update({
      consent_confirmed: true,
      content: {
        ...content,
        consent_source: candidate.consent === true ? "candidate" : "staff",
        consent_confirmed_by: userId,
        consent_confirmed_at: new Date().toISOString(),
      },
    })
    .eq("id", profileId);
  if (error) throw new Error(`Could not record consent: ${error.message}`);
  return profile.match.vacancy_id;
}

/**
 * T5 Markeer als verstuurd: sent_at, match status verstuurd, vacancy
 * profiles_sent_at and stage. The company's pipeline stage follows from the
 * presented candidates (sales_sync_recruitment_stage); OnePageCRM is gone.
 */
export async function markProfileSent(db: Db, profileId: string): Promise<{ vacancyId: string; warning?: string }> {
  const profile = await loadProfile(db, profileId);
  if (profile.sent_at) return { vacancyId: profile.match.vacancy_id };
  if (!profile.approved_at) throw new Error("Approve the profile first. A person always reviews it before anything goes to a client.");

  // Consent is checked at the moment of sending: the candidate's field is the source.
  const candidate = await loadCandidate(db, profile.match.candidate_id);
  if (candidate.consent === false) {
    throw new Error("The candidate did not give consent to share an anonymous profile.");
  }
  const consent = profile.consent_confirmed || candidate.consent === true;
  if (!consent) {
    throw new Error("The candidate's consent is not confirmed yet. First confirm that the candidate gave consent.");
  }

  const now = new Date().toISOString();
  const { error } = await db
    .from("anonymous_profiles")
    .update({ sent_at: now, consent_confirmed: true })
    .eq("id", profileId);
  if (error) throw new Error(`Could not record sending: ${error.message}`);

  if (profile.match.status === "goedgekeurd" || profile.match.status === "voorgesteld") {
    await db.from("matches").update({ status: "verstuurd" }).eq("id", profile.match.id);
  }

  const { data: vacancy } = await db
    .from("vacancies")
    .select("id, talent_stage, profiles_sent_at")
    .eq("id", profile.match.vacancy_id)
    .maybeSingle();
  if (!vacancy) return { vacancyId: profile.match.vacancy_id };

  await db
    .from("vacancies")
    .update({
      profiles_sent_at: vacancy.profiles_sent_at ?? now,
      talent_stage: advanceStage(vacancy.talent_stage, "profielen_verstuurd"),
    })
    .eq("id", vacancy.id);

  return { vacancyId: vacancy.id };
}
