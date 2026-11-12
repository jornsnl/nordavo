"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { SENIORITY_VALUES } from "@/lib/recruitment/candidate-fields";
import { fieldErrorsFrom, formValues, GENERIC_ERROR, parseList } from "@/lib/action-state";
import { askJson, ClaudeRefusalError, hasClaude } from "@/lib/ai/claude";
import { markAiRequestsApplied, requestAi } from "@/lib/ai/queue";
import { VACANCY_SYSTEM, vacancyExtractionSchema, vacancyInput } from "@/lib/ai/prompts/vacancy";
import { requireStaff } from "@/lib/auth";
import type { MatchStatus, TablesUpdate } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";
import { advanceStage, generateSearchBrief, runMatching } from "@/lib/talent/match";
import { approveProfile, confirmConsentByStaff, generateAnonymousProfile, markProfileSent } from "@/lib/talent/profile";
import type { IntakeState, TalentActionState } from "@/lib/talent/types";

/**
 * Talent workflows on a vacancy (T1 to T6). Every action re-checks staff and
 * uses the user's Supabase client (staff RLS). T2 matches portal candidates.
 */

const idSchema = z.guid();

function revalidateVacancy(vacancyId: string) {
  revalidatePath(`/dashboard/vacancies/${vacancyId}`);
  revalidatePath("/dashboard/vacancies");
}

const MATCH_ERROR = "Something went wrong. Please try again.";

const PROFILE_QUEUED = "Sent to Claude. The profile appears here after its next run of claude-requests, once it passed the anonymity check.";

function failure(error: unknown, fallback = GENERIC_ERROR): TalentActionState {
  if (error instanceof ClaudeRefusalError) return { error: "Claude could not process this request. Change the text or fill in the fields yourself." };
  if (error instanceof Error && error.message) return { error: error.message };
  return { error: fallback };
}

// ---------------------------------------------------------------------------
// T1 Read the vacancy text
// ---------------------------------------------------------------------------

export async function extractVacancyAction(vacancyId: string, _prev: IntakeState, formData: FormData): Promise<IntakeState> {
  await requireStaff();
  if (!idSchema.safeParse(vacancyId).success) return { error: GENERIC_ERROR };
  const rawText = String(formData.get("raw_text") ?? "").trim();
  if (rawText.length < 40) {
    return { error: "Paste the full vacancy text. This is too short to extract requirements from.", rawText, fieldErrors: { raw_text: "Too short" } };
  }
  if (rawText.length > 30000) return { error: "This text is too long. Paste only the vacancy itself.", rawText };
  const supabase = await createClient();
  const { data: vacancy } = await supabase.from("vacancies").select("title").eq("id", vacancyId).maybeSingle();
  if (!vacancy) return { error: "This vacancy no longer exists." };

  if (!hasClaude()) {
    // Claude reads the vacancy through the MCP (claude-requests); its reading comes back here to check.
    try {
      await supabase.from("vacancies").update({ raw_text: rawText }).eq("id", vacancyId);
      await requestAi(supabase, {
        kind: "vacancy_extract",
        module: "recruitment",
        entityType: "vacancy",
        entityId: vacancyId,
        system: VACANCY_SYSTEM,
        input: vacancyInput({ title: vacancy.title, text: rawText }),
      });
      revalidateVacancy(vacancyId);
      return { ok: true, queued: true, rawText, message: "Sent to Claude. Its reading appears here after its next run of claude-requests; then you check and save it." };
    } catch (error) {
      return { ...failure(error), rawText };
    }
  }

  try {
    const extraction = await askJson({
      system: VACANCY_SYSTEM,
      input: vacancyInput({ title: vacancy.title, text: rawText }),
      schema: vacancyExtractionSchema,
      effort: "low",
    });
    return { ok: true, extraction, rawText, message: "Text read. Check the requirements and save them." };
  } catch (error) {
    return { ...failure(error), rawText };
  }
}

const amount = z
  .string()
  .regex(/^\d{1,8}([.,]\d{1,2})?$/, "Enter an amount in euros, for example 3200.")
  .transform((value) => Number(value.replace(",", ".")));

const requirementsSchema = z
  .object({
    raw_text: z.string().max(30000, "This text is too long.").optional(),
    stack: z.string().max(1000, "Use at most 1000 characters.").optional(),
    seniority: z.enum(SENIORITY_VALUES, { error: "Choose a seniority." }),
    hours: z.coerce.number({ error: "Enter a number of hours." }).int("Use whole hours.").min(1, "At least 1 hour.").max(60, "At most 60 hours.").optional(),
    timezone_overlap: z.string().max(300, "Use at most 300 characters.").optional(),
    budget_min: amount.optional(),
    budget_max: amount.optional(),
    client_contact_required: z.enum(["ja", "nee"]).optional(),
    must_haves: z.string().max(4000, "This is too long.").optional(),
    nice_to_haves: z.string().max(4000, "This is too long.").optional(),
    unclear: z.string().max(4000, "This is too long.").optional(),
  })
  .superRefine((data, ctx) => {
    if (data.budget_min !== undefined && data.budget_max !== undefined && data.budget_min > data.budget_max) {
      ctx.addIssue({ code: "custom", path: ["budget_max"], message: "The maximum is lower than the minimum." });
    }
  });

function lines(value: string | undefined) {
  if (!value) return [];
  return value
    .split("\n")
    .map((line) => line.replace(/^[\s*\-•]+/, "").trim())
    .filter(Boolean);
}

export async function saveRequirementsAction(vacancyId: string, _prev: TalentActionState, formData: FormData): Promise<TalentActionState> {
  await requireStaff();
  if (!idSchema.safeParse(vacancyId).success) return { error: GENERIC_ERROR };
  const parsed = requirementsSchema.safeParse(formValues(formData));
  if (!parsed.success) return { error: "Check the highlighted fields.", fieldErrors: fieldErrorsFrom(parsed.error) };
  const d = parsed.data;

  const supabase = await createClient();
  const { data: current } = await supabase.from("vacancies").select("intake_at, raw_text").eq("id", vacancyId).maybeSingle();
  if (!current) return { error: "This vacancy no longer exists." };

  const update: TablesUpdate<"vacancies"> = {
    stack: parseList(d.stack),
    seniority: d.seniority,
    hours: d.hours ?? null,
    timezone_overlap: d.timezone_overlap ?? null,
    budget_min: d.budget_min ?? null,
    budget_max: d.budget_max ?? null,
    client_contact_required: d.client_contact_required ? d.client_contact_required === "ja" : null,
    must_haves: lines(d.must_haves),
    nice_to_haves: lines(d.nice_to_haves),
    unclear: lines(d.unclear),
    raw_text: d.raw_text ?? current.raw_text,
    intake_at: current.intake_at ?? new Date().toISOString(),
  };
  const { error } = await supabase.from("vacancies").update(update).eq("id", vacancyId);
  if (error) return { error: GENERIC_ERROR };
  // Claude's reading, if there was one, has been checked and taken over.
  await markAiRequestsApplied(supabase, "vacancy_extract", vacancyId);

  revalidateVacancy(vacancyId);
  return {
    ok: true,
    message: "Requirements saved.",
    warning: update.client_contact_required ? "Note: the developer would need direct contact with the client's own customers. That is a no go for Nordavo." : undefined,
  };
}

/** Tick off an item on the "still to ask" list. */
export async function resolveUnclearAction(vacancyId: string, item: string, _prev: TalentActionState, _formData: FormData): Promise<TalentActionState> {
  void _formData;
  await requireStaff();
  if (!idSchema.safeParse(vacancyId).success) return { error: GENERIC_ERROR };
  const supabase = await createClient();
  const { data } = await supabase.from("vacancies").select("unclear").eq("id", vacancyId).maybeSingle();
  if (!data) return { error: "This vacancy no longer exists." };
  const { error } = await supabase
    .from("vacancies")
    .update({ unclear: data.unclear.filter((u) => u !== item) })
    .eq("id", vacancyId);
  if (error) return { error: GENERIC_ERROR };
  revalidateVacancy(vacancyId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// T2 matching and T3 search brief
// ---------------------------------------------------------------------------

export async function runMatchingAction(vacancyId: string, _prev: TalentActionState, _formData: FormData): Promise<TalentActionState> {
  void _formData;
  await requireStaff();
  if (!idSchema.safeParse(vacancyId).success) return { error: MATCH_ERROR };
  const supabase = await createClient();
  if (!hasClaude()) {
    // Claude matches through the MCP (task claude-match): queue the request.
    const { data, error } = await supabase
      .from("vacancies")
      .update({ match_requested_at: new Date().toISOString() })
      .eq("id", vacancyId)
      .select("id")
      .maybeSingle();
    if (error || !data) return { error: MATCH_ERROR };
    revalidateVacancy(vacancyId);
    return { ok: true, message: "Queued for Claude. The matches appear here after its next run of claude-match." };
  }
  try {
    const s = await runMatching(supabase, vacancyId);
    revalidateVacancy(vacancyId);
    if (s.scored === 0) {
      return {
        ok: true,
        message: `No suitable candidates in the pool (${s.poolSize} candidates, ${s.prefiltered} after the prefilter).`,
        warning: s.searchBrief ? "A search brief for LinkedIn and Naukri is ready." : undefined,
      };
    }
    return {
      ok: true,
      message: `${s.scored} candidates scored from a pool of ${s.poolSize}. ${s.stored} matches saved, ${s.strong} with a score of 70 or higher.`,
      warning: s.searchBrief ? "Fewer than 3 strong matches: a search brief for LinkedIn and Naukri is ready." : undefined,
    };
  } catch (error) {
    return failure(error, MATCH_ERROR);
  }
}

export async function generateSearchBriefAction(vacancyId: string, _prev: TalentActionState, _formData: FormData): Promise<TalentActionState> {
  void _formData;
  await requireStaff();
  if (!idSchema.safeParse(vacancyId).success) return { error: MATCH_ERROR };
  const supabase = await createClient();
  try {
    const { data: matches } = await supabase.from("matches").select("score").eq("vacancy_id", vacancyId);
    const scores = (matches ?? []).map((m) => m.score ?? 0);
    await generateSearchBrief(supabase, vacancyId, { scored: scores.length, strong: scores.filter((s) => s >= 70).length });
    revalidateVacancy(vacancyId);
    return { ok: true, message: "Search brief created." };
  } catch (error) {
    return failure(error, MATCH_ERROR);
  }
}

// ---------------------------------------------------------------------------
// Match status (approve, reject, interview, hired)
// ---------------------------------------------------------------------------

const matchStatusSchema = z.enum(["voorgesteld", "goedgekeurd", "gesprek", "aangenomen", "afgewezen"]);

export async function setMatchStatusAction(matchId: string, status: MatchStatus, _prev: TalentActionState, _formData: FormData): Promise<TalentActionState> {
  void _formData;
  const user = await requireStaff();
  if (!idSchema.safeParse(matchId).success || !matchStatusSchema.safeParse(status).success) return { error: MATCH_ERROR };
  const supabase = await createClient();
  const { data: match } = await supabase
    .from("matches")
    .select("id, vacancy_id, status, vacancy:vacancies(talent_stage)")
    .eq("id", matchId)
    .maybeSingle();
  if (!match) return { error: "This match no longer exists." };

  const update: TablesUpdate<"matches"> = { status };
  if (status === "goedgekeurd") {
    update.approved_by = user.id;
    update.approved_at = new Date().toISOString();
  }
  if (status === "voorgesteld") {
    update.approved_by = null;
    update.approved_at = null;
  }
  const { error } = await supabase.from("matches").update(update).eq("id", matchId);
  if (error) return { error: MATCH_ERROR };

  const current = match.vacancy?.talent_stage;
  if (current && (status === "gesprek" || status === "aangenomen")) {
    const next = advanceStage(current, status === "gesprek" ? "gesprekken" : "geplaatst");
    if (next !== current) await supabase.from("vacancies").update({ talent_stage: next }).eq("id", match.vacancy_id);
  }

  revalidateVacancy(match.vacancy_id);
  return { ok: true };
}

/** Put the matched portal candidate in the vacancy's pipeline, in stage "sourced". */
export async function addMatchToPipelineAction(matchId: string, _prev: TalentActionState, _formData: FormData): Promise<TalentActionState> {
  void _formData;
  await requireStaff();
  if (!idSchema.safeParse(matchId).success) return { error: MATCH_ERROR };
  const supabase = await createClient();
  const { data: match } = await supabase.from("matches").select("id, vacancy_id, candidate_id, status").eq("id", matchId).maybeSingle();
  if (!match) return { error: "This match no longer exists." };
  if (match.status === "afgewezen") return { error: "This match was rejected. Restore it first." };

  const { data: last } = await supabase
    .from("applications")
    .select("position")
    .eq("vacancy_id", match.vacancy_id)
    .eq("stage", "sourced")
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { error } = await supabase.from("applications").insert({
    vacancy_id: match.vacancy_id,
    candidate_id: match.candidate_id,
    stage: "sourced",
    position: (last?.position ?? 0) + 1024,
  });
  if (error?.code === "23505") return { error: "This candidate is already in the pipeline of this vacancy." };
  if (error?.code === "23503") return { error: "This vacancy or candidate no longer exists." };
  if (error) return { error: MATCH_ERROR };

  revalidateVacancy(match.vacancy_id);
  revalidatePath(`/dashboard/vacancies/${match.vacancy_id}/pipeline`);
  revalidatePath(`/dashboard/candidates/${match.candidate_id}`);
  revalidatePath("/dashboard/candidates");
  return { ok: true, message: "Added to the pipeline." };
}

// ---------------------------------------------------------------------------
// T4 anonymous profile and T5 approval and sending
// ---------------------------------------------------------------------------

export async function generateProfileAction(vacancyId: string, matchId: string, _prev: TalentActionState, _formData: FormData): Promise<TalentActionState> {
  void _formData;
  await requireStaff();
  if (!idSchema.safeParse(matchId).success || !idSchema.safeParse(vacancyId).success) return { error: MATCH_ERROR };
  const supabase = await createClient();
  try {
    const made = await generateAnonymousProfile(supabase, matchId);
    revalidateVacancy(vacancyId);
    if (!made) return { ok: true, message: PROFILE_QUEUED };
    return { ok: true, message: `Profile ${made.code} created and it passed the anonymity check. Review it and approve it.` };
  } catch (error) {
    return failure(error, MATCH_ERROR);
  }
}

export async function approveProfileAction(profileId: string, _prev: TalentActionState, _formData: FormData): Promise<TalentActionState> {
  void _formData;
  const user = await requireStaff();
  if (!idSchema.safeParse(profileId).success) return { error: MATCH_ERROR };
  const supabase = await createClient();
  try {
    const vacancyId = await approveProfile(supabase, profileId, user.id);
    revalidateVacancy(vacancyId);
    return { ok: true, message: "Profile approved." };
  } catch (error) {
    return failure(error, MATCH_ERROR);
  }
}

export async function confirmConsentAction(profileId: string, _prev: TalentActionState, formData: FormData): Promise<TalentActionState> {
  const user = await requireStaff();
  if (!idSchema.safeParse(profileId).success) return { error: MATCH_ERROR };
  if (formData.get("consent") !== "on") return { error: "Tick the box to confirm the candidate gave consent." };
  const supabase = await createClient();
  try {
    const vacancyId = await confirmConsentByStaff(supabase, profileId, user.id);
    revalidateVacancy(vacancyId);
    return { ok: true, message: "Consent recorded." };
  } catch (error) {
    return failure(error, MATCH_ERROR);
  }
}

export async function markProfileSentAction(profileId: string, _prev: TalentActionState, _formData: FormData): Promise<TalentActionState> {
  void _formData;
  await requireStaff();
  if (!idSchema.safeParse(profileId).success) return { error: MATCH_ERROR };
  const supabase = await createClient();
  try {
    const { vacancyId, warning } = await markProfileSent(supabase, profileId);
    revalidateVacancy(vacancyId);
    return { ok: true, message: "Marked as sent.", warning };
  } catch (error) {
    return failure(error, MATCH_ERROR);
  }
}

// ---------------------------------------------------------------------------
// T6 lead time
// ---------------------------------------------------------------------------

const optionalDate = z.iso.date({ error: "Choose a valid date." }).optional();
const timelineSchema = z.object({
  intake_at: optionalDate,
  profiles_sent_at: optionalDate,
  first_interview_at: optionalDate,
  start_at: optionalDate,
  presentation_deadline: optionalDate,
});

/** A date input (YYYY-MM-DD) as a timestamp at noon UTC, so it shows as the same day in Amsterdam. */
function dateToTimestamp(value: string | undefined) {
  return value ? `${value}T12:00:00Z` : null;
}

export async function updateTimelineAction(vacancyId: string, _prev: TalentActionState, formData: FormData): Promise<TalentActionState> {
  await requireStaff();
  if (!idSchema.safeParse(vacancyId).success) return { error: GENERIC_ERROR };
  const parsed = timelineSchema.safeParse(formValues(formData));
  if (!parsed.success) return { error: "Check the dates.", fieldErrors: fieldErrorsFrom(parsed.error) };
  const d = parsed.data;
  if (d.intake_at && d.profiles_sent_at && d.profiles_sent_at < d.intake_at) {
    return { error: "Profiles cannot have been sent before the intake.", fieldErrors: { profiles_sent_at: "Before the intake" } };
  }

  const supabase = await createClient();
  const { data: current } = await supabase
    .from("vacancies")
    .select("intake_at, profiles_sent_at, first_interview_at, talent_stage")
    .eq("id", vacancyId)
    .maybeSingle();
  if (!current) return { error: "This vacancy no longer exists." };

  // Keep the exact time when the day did not change.
  const keep = (value: string | undefined, existing: string | null) =>
    value && existing && existing.slice(0, 10) === value ? existing : dateToTimestamp(value);

  const update: TablesUpdate<"vacancies"> = {
    intake_at: keep(d.intake_at, current.intake_at),
    profiles_sent_at: keep(d.profiles_sent_at, current.profiles_sent_at),
    first_interview_at: keep(d.first_interview_at, current.first_interview_at),
    start_at: d.start_at ?? null,
    presentation_deadline: d.presentation_deadline ?? null,
  };
  let stage = current.talent_stage;
  if (update.profiles_sent_at && !current.profiles_sent_at) stage = advanceStage(stage, "profielen_verstuurd");
  if (update.first_interview_at && !current.first_interview_at) stage = advanceStage(stage, "gesprekken");
  if (stage !== current.talent_stage) update.talent_stage = stage;

  const { error } = await supabase.from("vacancies").update(update).eq("id", vacancyId);
  if (error) return { error: GENERIC_ERROR };
  revalidateVacancy(vacancyId);
  return { ok: true, message: "Timeline saved." };
}
