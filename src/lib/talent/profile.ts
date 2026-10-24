import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { askJson, hasClaude } from "@/lib/ai/claude";
import { PROFILE_SYSTEM, profileContentSchema, profileInput, type ProfileContent } from "@/lib/ai/prompts/profile";
import type { Database, Json, MatchStatus } from "@/lib/database.types";
import { getPoolCandidate, hasAirtable, type PoolCandidate } from "@/lib/integrations/airtable";
import { addDealNote, hasOnePage, setNextAction } from "@/lib/integrations/onepage";
import { collectText, findIdentifierLeaks, leakMessage, profileCode, redactIdentifiers, type CandidateIdentifiers } from "@/lib/talent/anonymize";
import { advanceStage } from "@/lib/talent/match";
import { requirementsPayload } from "@/lib/talent/prefilter";
import { renderProfilePdf } from "@/lib/talent/profile-pdf";
import { ATTACHMENTS_BUCKET } from "@/lib/storage";

/**
 * T4 anonymous profile and T5 approval and sending.
 * Rule 12: Claude sees only redacted fields; the code check rejects any
 * profile that still contains a name part, email, phone or employer.
 * Rule 13: sent only with consent (Airtable field, or a staff confirmation
 * while the field does not exist). Rule 14: a human approves before sending;
 * the database refuses sent_at without approval and consent.
 */

type Db = SupabaseClient<Database>;

/** Stored in anonymous_profiles.content: the anonymous profile plus bookkeeping. */
export type StoredProfileContent = ProfileContent & {
  code: string;
  generated_at: string;
  consent_source: "airtable" | "staff" | null;
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

export function readProfileContent(value: Json): StoredProfileContent | null {
  const parsed = profileContentSchema.safeParse(value);
  if (!parsed.success || !value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  return {
    ...parsed.data,
    code: typeof v.code === "string" ? v.code : "",
    generated_at: typeof v.generated_at === "string" ? v.generated_at : "",
    consent_source: v.consent_source === "airtable" || v.consent_source === "staff" ? v.consent_source : null,
    consent_confirmed_by: typeof v.consent_confirmed_by === "string" ? v.consent_confirmed_by : null,
    consent_confirmed_at: typeof v.consent_confirmed_at === "string" ? v.consent_confirmed_at : null,
  };
}

async function loadMatch(db: Db, matchId: string) {
  const { data, error } = await db
    .from("matches")
    .select(
      "id, vacancy_id, airtable_candidate_id, status, reason, risks, missing, vacancy:vacancies(id, title, stack, seniority, hours, timezone_overlap, budget_min, budget_max, client_contact_required, must_haves, nice_to_haves)",
    )
    .eq("id", matchId)
    .maybeSingle();
  if (error) throw new Error(`Match laden mislukt: ${error.message}`);
  if (!data || !data.vacancy) throw new Error("Deze match bestaat niet (meer).");
  return { ...data, vacancy: data.vacancy };
}

async function liveCandidate(airtableId: string) {
  if (!hasAirtable()) throw new Error("Airtable is niet gekoppeld, dus de kandidaat kan niet live worden gelezen.");
  const candidate = await getPoolCandidate(airtableId);
  if (!candidate) {
    throw new Error("Deze kandidaat staat niet meer in Airtable, mogelijk verwijderd volgens de AVG-regels. Wijs de match af.");
  }
  return candidate;
}

export async function generateAnonymousProfile(db: Db, matchId: string): Promise<{ profileId: string; code: string }> {
  if (!hasClaude()) throw new Error("ANTHROPIC_API_KEY ontbreekt: een profiel maken kan niet zonder Claude.");
  const match = await loadMatch(db, matchId);
  if (!APPROVED_MATCH.includes(match.status)) {
    throw new Error("Keur de match eerst goed. Pas daarna maak je een anoniem profiel.");
  }
  const candidate = await liveCandidate(match.airtable_candidate_id);
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
  if (!content) throw new Error("Het profiel kon niet worden gemaakt.");

  const profileId = crypto.randomUUID();
  const code = profileCode(profileId);
  const now = new Date().toISOString();
  const stored: StoredProfileContent = {
    ...content,
    years_experience: content.years_experience === null ? null : Math.max(0, Math.round(content.years_experience)),
    code,
    generated_at: now,
    consent_source: candidate.consent === true ? "airtable" : null,
  };

  const pdf = await renderProfilePdf(stored, { code, vacancyTitle: match.vacancy.title, date: now.slice(0, 10) });
  const path = profileStoragePath(match.vacancy_id, profileId);
  const { error: uploadError } = await db.storage
    .from(ATTACHMENTS_BUCKET)
    .upload(path, pdf, { contentType: "application/pdf", upsert: false });
  if (uploadError) throw new Error(`PDF opslaan mislukt: ${uploadError.message}`);

  const { error } = await db.from("anonymous_profiles").insert({
    id: profileId,
    match_id: match.id,
    content: stored as unknown as Json,
    file_url: path,
    consent_confirmed: candidate.consent === true,
  });
  if (error) {
    await db.storage.from(ATTACHMENTS_BUCKET).remove([path]);
    throw new Error(`Profiel opslaan mislukt: ${error.message}`);
  }
  return { profileId, code };
}

async function loadProfile(db: Db, profileId: string) {
  const { data, error } = await db
    .from("anonymous_profiles")
    .select("id, match_id, content, consent_confirmed, approved_at, sent_at, match:matches(id, vacancy_id, airtable_candidate_id, status)")
    .eq("id", profileId)
    .maybeSingle();
  if (error) throw new Error(`Profiel laden mislukt: ${error.message}`);
  if (!data || !data.match) throw new Error("Dit profiel bestaat niet (meer).");
  return { ...data, match: data.match };
}

/** Rule 14: a staff member (Floris or the recruiter) approves the profile. */
export async function approveProfile(db: Db, profileId: string, userId: string) {
  const profile = await loadProfile(db, profileId);
  if (profile.sent_at) throw new Error("Dit profiel is al verstuurd.");
  const { error } = await db
    .from("anonymous_profiles")
    .update({ approved_by: userId, approved_at: new Date().toISOString() })
    .eq("id", profileId);
  if (error) throw new Error(`Goedkeuren mislukt: ${error.message}`);
  return profile.match.vacancy_id;
}

/**
 * Rule 13 fallback while Airtable has no consent value: a staff member
 * confirms the candidate agreed. An explicit "no" in Airtable always wins.
 */
export async function confirmConsentByStaff(db: Db, profileId: string, userId: string) {
  const profile = await loadProfile(db, profileId);
  const candidate = await liveCandidate(profile.match.airtable_candidate_id);
  if (candidate.consent === false) {
    throw new Error("In Airtable staat dat deze kandidaat geen toestemming gaf. Pas dat eerst daar aan als het niet klopt.");
  }
  const content = (profile.content && typeof profile.content === "object" && !Array.isArray(profile.content) ? profile.content : {}) as Record<string, Json>;
  const { error } = await db
    .from("anonymous_profiles")
    .update({
      consent_confirmed: true,
      content: {
        ...content,
        consent_source: candidate.consent === true ? "airtable" : "staff",
        consent_confirmed_by: userId,
        consent_confirmed_at: new Date().toISOString(),
      },
    })
    .eq("id", profileId);
  if (error) throw new Error(`Toestemming vastleggen mislukt: ${error.message}`);
  return profile.match.vacancy_id;
}

function addWorkdays(from: Date, days: number) {
  const date = new Date(from);
  let added = 0;
  while (added < days) {
    date.setUTCDate(date.getUTCDate() + 1);
    const day = date.getUTCDay();
    if (day !== 0 && day !== 6) added += 1;
  }
  return date.toISOString().slice(0, 10);
}

/** The OnePageCRM contact for the vacancy's company, best tier first. */
async function findOnepageContact(db: Db, vacancy: { company_id: string | null; client_id: string | null }) {
  let companyIds: string[] = vacancy.company_id ? [vacancy.company_id] : [];
  if (companyIds.length === 0 && vacancy.client_id) {
    const { data } = await db.from("companies").select("id").eq("client_id", vacancy.client_id);
    companyIds = (data ?? []).map((c) => c.id);
  }
  if (companyIds.length === 0) return null;
  const { data } = await db
    .from("contacts")
    .select("onepage_id, tier")
    .in("company_id", companyIds)
    .not("onepage_id", "is", null)
    .order("tier", { ascending: true, nullsFirst: false })
    .limit(1);
  return data?.[0]?.onepage_id ?? null;
}

/**
 * T5 Markeer als verstuurd: sent_at, match status verstuurd, vacancy
 * profiles_sent_at and stage, then OnePageCRM (deal note and next action).
 * A CRM failure is returned as a warning; the sent state stays.
 */
export async function markProfileSent(db: Db, profileId: string): Promise<{ vacancyId: string; warning?: string }> {
  const profile = await loadProfile(db, profileId);
  if (profile.sent_at) return { vacancyId: profile.match.vacancy_id };
  if (!profile.approved_at) throw new Error("Keur het profiel eerst goed. Een mens kijkt altijd mee voordat iets naar een klant gaat.");

  // Consent is checked live: Airtable is the source.
  const candidate = await liveCandidate(profile.match.airtable_candidate_id);
  if (candidate.consent === false) {
    throw new Error("De kandidaat gaf in Airtable geen toestemming om een anoniem profiel te delen.");
  }
  const consent = profile.consent_confirmed || candidate.consent === true;
  if (!consent) {
    throw new Error("Toestemming van de kandidaat is nog niet bevestigd. Vink eerst aan dat de kandidaat toestemming gaf.");
  }

  const now = new Date().toISOString();
  const { error } = await db
    .from("anonymous_profiles")
    .update({ sent_at: now, consent_confirmed: true })
    .eq("id", profileId);
  if (error) throw new Error(`Versturen vastleggen mislukt: ${error.message}`);

  if (profile.match.status === "goedgekeurd" || profile.match.status === "voorgesteld") {
    await db.from("matches").update({ status: "verstuurd" }).eq("id", profile.match.id);
  }

  const { data: vacancy } = await db
    .from("vacancies")
    .select("id, title, talent_stage, profiles_sent_at, onepage_deal_id, company_id, client_id")
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

  let warning: string | undefined;
  if (vacancy.onepage_deal_id && hasOnePage()) {
    const code = readProfileContent(profile.content)?.code || profileCode(profileId);
    try {
      await addDealNote(vacancy.onepage_deal_id, `Anoniem profiel ${code} verstuurd voor ${vacancy.title}.`);
      const contactId = await findOnepageContact(db, vacancy);
      if (contactId) {
        await setNextAction(contactId, { text: `Feedback vragen op profiel ${code} (${vacancy.title})`, date: addWorkdays(new Date(), 2) });
      } else {
        warning = "Notitie staat bij de deal, maar er is geen contact in OnePageCRM gevonden voor de volgende actie. Zet die zelf.";
      }
    } catch (crmError) {
      warning = `Verstuurd vastgelegd, maar OnePageCRM bijwerken lukte niet: ${crmError instanceof Error ? crmError.message : "onbekende fout"}. Werk de deal zelf bij.`;
    }
  } else if (vacancy.onepage_deal_id) {
    warning = "Verstuurd vastgelegd. OnePageCRM is niet gekoppeld, dus werk de deal zelf bij.";
  }

  return { vacancyId: vacancy.id, warning };
}
