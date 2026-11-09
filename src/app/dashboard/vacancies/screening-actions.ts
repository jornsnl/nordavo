"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { GENERIC_ERROR, formValues } from "@/lib/action-state";
import { ClaudeRefusalError, hasClaude } from "@/lib/ai/claude";
import { requireAdmin, requireStaff } from "@/lib/auth";
import type { CandidateOrigin, CandidateSource, TablesInsert } from "@/lib/database.types";
import { candidateImportFields, IMPORT_CHUNK_SIZE, type CandidateImportMapping } from "@/lib/screening/candidate-csv";
import { MAX_CV_BYTES } from "@/lib/screening/cv-text";
import { processCvUpload, readStoredCv, validateCvFile, type CvUploadResult } from "@/lib/screening/cv-read";
import { importCandidateRows, type CandidateImportReport } from "@/lib/screening/import";
import { compareSample, scoreApplications } from "@/lib/screening/score-run";
import { isScreeningModel, linesToList } from "@/lib/screening/scoring";
import { planTechstackMoves } from "@/lib/screening/techstack";
import { runTechstackCheck, TECHSTACK_STAGES } from "@/lib/screening/techstack-run";
import { talentPoolTop, type TalentPoolAnswer } from "@/lib/screening/talent-search";
import { createClient } from "@/lib/supabase/server";
import { generateAnonymousProfile } from "@/lib/talent/profile";
import type { TalentActionState } from "@/lib/talent/types";

/**
 * Screening on a vacancy (recruitment brief 2.6, 2.7, 2.11, 2.15). Every
 * action re-checks staff (prompts: admin) and runs with the user's Supabase
 * client, so RLS decides what may be read and written.
 */

const idSchema = z.guid();
const sources = ["linkedin", "naukri", "manatal", "indeed", "monster", "instagram", "referral", "website", "headhunted", "other"] as const;
const sourceSchema = z.enum(sources, { error: "Choose a source." });
const originSchema = z.enum(["applied", "headhunted"], { error: "Choose applied or headhunted." });

function failure(error: unknown): TalentActionState {
  if (error instanceof ClaudeRefusalError) return { error: "Claude could not process this request." };
  if (error instanceof Error && error.message) return { error: error.message };
  return { error: GENERIC_ERROR };
}

function revalidateVacancy(vacancyId: string) {
  revalidatePath(`/dashboard/vacancies/${vacancyId}`);
  revalidatePath(`/dashboard/vacancies/${vacancyId}/pipeline`);
  revalidatePath(`/dashboard/vacancies/${vacancyId}/ranking`);
  revalidatePath(`/dashboard/vacancies/${vacancyId}/techstack`);
  revalidatePath("/dashboard/candidates");
}


// ---------------------------------------------------------------------------
// 2.6.1 CSV import
// ---------------------------------------------------------------------------

const mappingSchema = z.object(
  Object.fromEntries(candidateImportFields.map((f) => [f, z.string().min(1).max(200).optional()])) as Record<
    (typeof candidateImportFields)[number],
    z.ZodOptional<z.ZodString>
  >,
);

const importSchema = z.object({
  vacancyId: idSchema,
  rows: z.array(z.record(z.string().max(200), z.string().max(10000))).min(1, "No rows to import.").max(IMPORT_CHUNK_SIZE),
  mapping: mappingSchema,
  source: sourceSchema,
  origin: originSchema,
  offset: z.number().int().min(0),
});

export type CandidateImportInput = {
  vacancyId: string;
  rows: Record<string, string>[];
  mapping: CandidateImportMapping;
  source: CandidateSource;
  origin: CandidateOrigin;
  offset: number;
};

export async function importCandidatesChunkAction(
  input: CandidateImportInput,
): Promise<{ ok: true; result: CandidateImportReport } | { ok: false; error: string }> {
  await requireStaff();
  const parsed = importSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "The import is not valid." };
  const { vacancyId, rows, mapping, source, origin, offset } = parsed.data;
  if (!mapping.full_name && !(mapping.first_name || mapping.last_name)) {
    return { ok: false, error: "Map the column with the name (or first and last name)." };
  }
  try {
    const supabase = await createClient();
    const { data: vacancy } = await supabase.from("vacancies").select("id").eq("id", vacancyId).maybeSingle();
    if (!vacancy) return { ok: false, error: "This vacancy no longer exists." };
    const result = await importCandidateRows(supabase, rows, mapping, { vacancyId, source, origin }, offset);
    revalidateVacancy(vacancyId);
    return { ok: true, result };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Something went wrong while importing." };
  }
}

// ---------------------------------------------------------------------------
// 2.6.2 Bulk CV upload and Read CV
// ---------------------------------------------------------------------------

export type CvUploadActionResult = { ok: true; result: CvUploadResult } | { ok: false; error: string };

/** One CV per call: the wizard sends the files one after the other. */
export async function uploadCvAction(formData: FormData): Promise<CvUploadActionResult> {
  await requireStaff();
  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "No file." };
  const vacancyRaw = formData.get("vacancy_id");
  const vacancyId = typeof vacancyRaw === "string" && vacancyRaw ? vacancyRaw : null;
  if (vacancyId && !idSchema.safeParse(vacancyId).success) return { ok: false, error: GENERIC_ERROR };
  const source = sourceSchema.safeParse(formData.get("source"));
  const origin = originSchema.safeParse(formData.get("origin"));
  if (!source.success || !origin.success) return { ok: false, error: "Choose the source and origin." };

  const bytes = Buffer.from(await file.arrayBuffer());
  const valid = validateCvFile(file.name, file.type || null, bytes, MAX_CV_BYTES);
  if ("error" in valid) return { ok: false, error: valid.error };
  try {
    const supabase = await createClient();
    if (vacancyId) {
      const { data: vacancy } = await supabase.from("vacancies").select("id").eq("id", vacancyId).maybeSingle();
      if (!vacancy) return { ok: false, error: "This vacancy no longer exists." };
    }
    const result = await processCvUpload(
      supabase,
      { bytes, fileName: file.name, mime: file.type || null, vacancyId, source: source.data, origin: origin.data },
      valid.kind,
    );
    if (vacancyId) revalidateVacancy(vacancyId);
    revalidatePath(`/dashboard/candidates/${result.candidateId}`);
    return { ok: true, result };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : GENERIC_ERROR };
  }
}

export async function readCvAction(candidateId: string, _prev: TalentActionState, _formData: FormData): Promise<TalentActionState> {
  void _formData;
  await requireStaff();
  if (!idSchema.safeParse(candidateId).success) return { error: GENERIC_ERROR };
  try {
    const supabase = await createClient();
    const result = await readStoredCv(supabase, candidateId);
    revalidatePath(`/dashboard/candidates/${candidateId}`);
    if (result.status === "read") return { ok: true, message: `CV read: ${result.characters.toLocaleString("en-GB")} characters stored as CV text.`, warning: result.note ?? undefined };
    if (result.status === "pending") return { ok: true, warning: result.note ?? "The CV text is pending." };
    return { error: result.note ?? "The CV could not be read." };
  } catch (error) {
    return failure(error);
  }
}

// ---------------------------------------------------------------------------
// 2.7 Techstack check
// ---------------------------------------------------------------------------

const rulesSchema = z.object({
  excluded_profiles: z.string().max(2000, "This is too long.").optional(),
  techstack_min_hits: z.coerce.number({ error: "Enter a number." }).int("Use a whole number.").min(1, "At least 1.").max(50, "At most 50.").optional(),
});

export async function saveTechstackRulesAction(vacancyId: string, _prev: TalentActionState, formData: FormData): Promise<TalentActionState> {
  await requireStaff();
  if (!idSchema.safeParse(vacancyId).success) return { error: GENERIC_ERROR };
  const parsed = rulesSchema.safeParse(formValues(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the fields." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("vacancies")
    .update({ excluded_profiles: linesToList(parsed.data.excluded_profiles).slice(0, 30), techstack_min_hits: parsed.data.techstack_min_hits ?? null })
    .eq("id", vacancyId);
  if (error) return { error: GENERIC_ERROR };
  revalidateVacancy(vacancyId);
  return { ok: true, message: "Rules saved. Run the check again to apply them." };
}

export async function runTechstackAction(vacancyId: string, _prev: TalentActionState, formData: FormData): Promise<TalentActionState> {
  await requireStaff();
  if (!idSchema.safeParse(vacancyId).success) return { error: GENERIC_ERROR };
  const ids = formData.getAll("ids").filter((v): v is string => typeof v === "string" && idSchema.safeParse(v).success);
  const useClaude = formData.get("use_claude") === "on";
  try {
    const supabase = await createClient();
    const s = await runTechstackCheck(supabase, vacancyId, { applicationIds: ids.length > 0 ? ids : undefined, useClaude });
    revalidateVacancy(vacancyId);
    if (s.checked === 0) return { ok: true, warning: "Nobody to check: there are no candidates in Sourced or Techstack check." };
    return {
      ok: true,
      message: `${s.checked} checked: ${s.pass} pass, ${s.fail} fail, ${s.unclear} unclear${s.byClaude ? ` (${s.byClaude} judged by Claude)` : ""}${s.queued ? `, ${s.queued} unclear ones sent to Claude, who judges them in its next run of claude-requests` : ""}. Nothing has moved yet.`,
    };
  } catch (error) {
    return failure(error);
  }
}

/**
 * After the confirmation screen: passes go to Fill out, fails to Rejected
 * with "Techstack mismatch: ...", through move_applications. Results are
 * read again from the database; the form only says which ones to move.
 */
export async function applyTechstackAction(vacancyId: string, _prev: TalentActionState, formData: FormData): Promise<TalentActionState> {
  await requireStaff();
  if (!idSchema.safeParse(vacancyId).success) return { error: GENERIC_ERROR };
  const ids = formData.getAll("ids").filter((v): v is string => typeof v === "string" && idSchema.safeParse(v).success);
  if (ids.length === 0) return { error: "Select the candidates to move." };
  const unclearToCheck = formData.get("unclear_to_check") === "on";

  const supabase = await createClient();
  const { data: rows, error } = await supabase
    .from("techstack_checks")
    .select("application_id, result, reason, application:applications!inner(stage, vacancy_id)")
    .eq("vacancy_id", vacancyId)
    .in("application_id", ids);
  if (error) return { error: GENERIC_ERROR };
  const current = (rows ?? []).filter((r) => r.application && (TECHSTACK_STAGES as readonly string[]).includes(r.application.stage));
  const plan = planTechstackMoves(current.map((r) => ({ applicationId: r.application_id, result: r.result, reason: r.reason })));

  try {
    let moved = 0;
    let rejected = 0;
    if (plan.pass.length > 0) {
      const { data, error: moveError } = await supabase.rpc("move_applications", { p_application_ids: plan.pass, p_stage: "fill_out" });
      if (moveError) throw new Error(moveError.message);
      moved += data ?? 0;
    }
    for (const group of plan.fail) {
      const { data, error: moveError } = await supabase.rpc("move_applications", { p_application_ids: group.ids, p_stage: "rejected", p_reason: group.reason });
      if (moveError) throw new Error(moveError.message);
      rejected += data ?? 0;
    }
    let toCheck = 0;
    if (unclearToCheck) {
      const unclear = current.filter((r) => r.result === "unclear" && r.application?.stage === "sourced").map((r) => r.application_id);
      if (unclear.length > 0) {
        const { data, error: moveError } = await supabase.rpc("move_applications", { p_application_ids: unclear, p_stage: "techstack_check" });
        if (moveError) throw new Error(moveError.message);
        toCheck = data ?? 0;
      }
    }
    revalidateVacancy(vacancyId);
    return { ok: true, message: `${moved} moved to Fill out, ${rejected} rejected${toCheck ? `, ${toCheck} unclear moved to Techstack check` : ""}.` };
  } catch (error) {
    return failure(error);
  }
}

// ---------------------------------------------------------------------------
// 2.11 Requirements, scoring and prompts
// ---------------------------------------------------------------------------

const requirementsSchema = z.object({
  must_have: z.string().max(6000, "This is too long.").optional(),
  alternative: z.string().max(6000, "This is too long.").optional(),
  nice_to_have: z.string().max(6000, "This is too long.").optional(),
  screening_model: z.string().optional(),
});

function lines(value: string | undefined) {
  return (value ?? "")
    .split("\n")
    .map((l) => l.replace(/^[\s*\-•]+/, "").trim())
    .filter(Boolean)
    .slice(0, 40);
}

/** "BigQuery: Snowflake, Redshift" -> label BigQuery with two alternatives. */
function alternativeLine(line: string) {
  const colon = line.indexOf(":");
  const label = colon >= 0 ? line.slice(0, colon) : line;
  const rest = colon >= 0 ? line.slice(colon + 1) : "";
  return { label: label.trim().slice(0, 300), alternatives: linesToList(rest).slice(0, 20) };
}

export async function saveScreeningRequirementsAction(vacancyId: string, _prev: TalentActionState, formData: FormData): Promise<TalentActionState> {
  await requireStaff();
  if (!idSchema.safeParse(vacancyId).success) return { error: GENERIC_ERROR };
  const parsed = requirementsSchema.safeParse(formValues(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the fields." };
  const d = parsed.data;
  const model = d.screening_model && isScreeningModel(d.screening_model) ? d.screening_model : null;

  const rows: TablesInsert<"vacancy_requirements">[] = [];
  let position = 0;
  for (const label of lines(d.must_have)) rows.push({ vacancy_id: vacancyId, label: label.slice(0, 300), kind: "must_have", position: position++ });
  for (const line of lines(d.alternative)) {
    const alt = alternativeLine(line);
    if (alt.label) rows.push({ vacancy_id: vacancyId, label: alt.label, kind: "alternative", alternatives: alt.alternatives, position: position++ });
  }
  for (const label of lines(d.nice_to_have)) rows.push({ vacancy_id: vacancyId, label: label.slice(0, 300), kind: "nice_to_have", position: position++ });

  const supabase = await createClient();
  const { error: modelError } = await supabase.from("vacancies").update({ screening_model: model }).eq("id", vacancyId);
  if (modelError) return { error: GENERIC_ERROR };
  const { error: deleteError } = await supabase.from("vacancy_requirements").delete().eq("vacancy_id", vacancyId);
  if (deleteError) return { error: GENERIC_ERROR };
  if (rows.length > 0) {
    const { error } = await supabase.from("vacancy_requirements").insert(rows);
    if (error) return { error: GENERIC_ERROR };
  }
  revalidateVacancy(vacancyId);
  return {
    ok: true,
    message: rows.length > 0 ? `${rows.length} requirements saved.` : "Requirements cleared: scoring uses the must haves, stack and nice to haves of the vacancy.",
  };
}

const QUEUED = "Claude scores them in its next run of claude-screening.";

/**
 * Without ANTHROPIC_API_KEY Claude scores through the MCP (task
 * claude-screening). Unscored CVs are always in its queue; a re-score is
 * asked for with score_requested_at.
 */
async function queueVacancyScores(vacancyId: string, rescore: boolean): Promise<TalentActionState> {
  const supabase = await createClient();
  if (rescore) {
    const { data, error } = await supabase
      .from("applications")
      .update({ score_requested_at: new Date().toISOString() })
      .eq("vacancy_id", vacancyId)
      .not("stage", "in", "(rejected,placed)")
      .select("id");
    if (error) return { error: GENERIC_ERROR };
    revalidateVacancy(vacancyId);
    return data.length > 0 ? { ok: true, message: `${data.length} CVs queued for a new score. ${QUEUED}` } : { ok: true, warning: "No candidates to score." };
  }
  const { count, error } = await supabase
    .from("applications")
    .select("id", { count: "exact", head: true })
    .eq("vacancy_id", vacancyId)
    .not("stage", "in", "(rejected,placed)")
    .is("cv_scored_at", null);
  if (error) return { error: GENERIC_ERROR };
  return count
    ? { ok: true, message: `${count} unscored CVs are in Claude's queue. ${QUEUED}` }
    : { ok: true, warning: "Every candidate already has a score. Tick re-score to score them again." };
}

async function queueApplicationScore(applicationId: string): Promise<TalentActionState> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("applications")
    .update({ score_requested_at: new Date().toISOString() })
    .eq("id", applicationId)
    .select("vacancy_id, candidate_id")
    .maybeSingle();
  if (error) return { error: GENERIC_ERROR };
  if (!data) return { error: "This application no longer exists." };
  revalidateVacancy(data.vacancy_id);
  revalidatePath(`/dashboard/candidates/${data.candidate_id}`);
  return { ok: true, message: `Queued. ${QUEUED}` };
}

/** One click scores at most this many CVs; the job does the rest. */
const SCORE_PER_CLICK = 60;

export async function scoreVacancyAction(vacancyId: string, _prev: TalentActionState, formData: FormData): Promise<TalentActionState> {
  await requireStaff();
  if (!idSchema.safeParse(vacancyId).success) return { error: GENERIC_ERROR };
  if (!hasClaude()) return queueVacancyScores(vacancyId, formData.get("rescore") === "on");
  const modelRaw = formData.get("model");
  const model = typeof modelRaw === "string" && isScreeningModel(modelRaw) ? modelRaw : undefined;
  const rescore = formData.get("rescore") === "on";
  try {
    const supabase = await createClient();
    const s = await scoreApplications(supabase, {
      vacancyId,
      model,
      bulk: formData.get("bulk") === "on",
      onlyUnscored: !rescore,
      limit: SCORE_PER_CLICK,
      concurrency: 4,
    });
    revalidateVacancy(vacancyId);
    if (s.considered === 0) return { ok: true, warning: rescore ? "No candidates to score." : "Every candidate already has a score. Tick re-score to score them again." };
    const parts = [`${s.scored} scored`, s.skipped ? `${s.skipped} without CV or skills` : null, s.failed ? `${s.failed} failed` : null].filter(Boolean);
    return {
      ok: s.scored > 0,
      message: s.scored > 0 ? `${parts.join(", ")}. Cost about $${s.costUsd.toFixed(4)}.` : undefined,
      error: s.scored === 0 ? `Nothing scored: ${s.errors[0] ?? parts.join(", ")}` : undefined,
      warning: s.remaining > 0 ? `${s.remaining} more to go: click again, or run the screening-score job for all of them.` : undefined,
    };
  } catch (error) {
    return failure(error);
  }
}

export async function scoreApplicationAction(applicationId: string, _prev: TalentActionState, _formData: FormData): Promise<TalentActionState> {
  void _formData;
  await requireStaff();
  if (!idSchema.safeParse(applicationId).success) return { error: GENERIC_ERROR };
  if (!hasClaude()) return queueApplicationScore(applicationId);
  try {
    const supabase = await createClient();
    const { data: app } = await supabase.from("applications").select("vacancy_id, candidate_id").eq("id", applicationId).maybeSingle();
    if (!app) return { error: "This application no longer exists." };
    const s = await scoreApplications(supabase, { applicationIds: [applicationId], onlyUnscored: false, limit: 1 });
    revalidateVacancy(app.vacancy_id);
    revalidatePath(`/dashboard/candidates/${app.candidate_id}`);
    if (s.scored === 1) return { ok: true, message: `Scored. Cost about $${s.costUsd.toFixed(4)}.` };
    if (s.skipped === 1) return { error: "No CV text or skills to score. Upload a CV and read it first." };
    return { error: s.errors[0] ?? "The CV could not be scored." };
  } catch (error) {
    return failure(error);
  }
}

const promptSchema = z.object({
  instructions: z.string({ error: "Write the instructions." }).min(20, "Write the instructions (at least 20 characters).").max(20000, "At most 20,000 characters."),
  notes: z.string().max(2000, "At most 2000 characters.").optional(),
});

export async function createPromptAction(_prev: TalentActionState, formData: FormData): Promise<TalentActionState> {
  await requireAdmin();
  const parsed = promptSchema.safeParse(formValues(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the fields." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("screening_prompts")
    .insert({ instructions: parsed.data.instructions, notes: parsed.data.notes ?? null })
    .select("version")
    .single();
  if (error || !data) return { error: GENERIC_ERROR };
  revalidatePath("/dashboard/settings/screening-prompts");
  return { ok: true, message: `Version ${data.version} saved. Compare it on a sample, then activate it.` };
}

export async function activatePromptAction(promptId: string | null, _prev: TalentActionState, _formData: FormData): Promise<TalentActionState> {
  void _formData;
  await requireAdmin();
  if (promptId !== null && !idSchema.safeParse(promptId).success) return { error: GENERIC_ERROR };
  const supabase = await createClient();
  const { error } = await supabase.rpc("activate_screening_prompt", { p_prompt_id: promptId });
  if (error) return { error: error.message || GENERIC_ERROR };
  revalidatePath("/dashboard/settings/screening-prompts");
  return { ok: true, message: promptId ? "Version activated. New scores use it." : "Back to the built-in instructions." };
}

export async function comparePromptAction(promptId: string | null, _prev: TalentActionState, formData: FormData): Promise<TalentActionState> {
  await requireStaff();
  if (promptId !== null && !idSchema.safeParse(promptId).success) return { error: GENERIC_ERROR };
  const vacancyId = formData.get("vacancy_id");
  if (typeof vacancyId !== "string" || !idSchema.safeParse(vacancyId).success) return { error: "Choose a vacancy with scored CVs." };
  const size = Number(formData.get("sample") ?? 10);
  const modelRaw = formData.get("model");
  try {
    const supabase = await createClient();
    const s = await compareSample(supabase, {
      vacancyId,
      promptId,
      sampleSize: Number.isFinite(size) ? Math.max(1, Math.min(50, Math.round(size))) : 10,
      model: typeof modelRaw === "string" && isScreeningModel(modelRaw) ? modelRaw : undefined,
    });
    revalidatePath("/dashboard/settings/screening-prompts");
    if (s.queued !== undefined) {
      return s.queued > 0
        ? { ok: true, message: `${s.queued} CVs sent to Claude for comparison. The scores appear here after its next run of claude-requests.` }
        : { error: "None of these CVs has text or skills to score." };
    }
    return { ok: s.scored > 0, message: `${s.scored} CVs re-scored for comparison. Cost about $${s.costUsd.toFixed(4)}.`, error: s.scored === 0 ? (s.errors[0] ?? "Nothing was re-scored.") : undefined };
  } catch (error) {
    return failure(error);
  }
}

// ---------------------------------------------------------------------------
// 2.15 Talent pool AI
// ---------------------------------------------------------------------------

export type TalentPoolState = TalentActionState & { answer?: TalentPoolAnswer; query?: string; vacancyId?: string };

export async function talentPoolSearchAction(_prev: TalentPoolState, formData: FormData): Promise<TalentPoolState> {
  await requireStaff();
  const query = String(formData.get("query") ?? "").trim().slice(0, 4000);
  const vacancyRaw = String(formData.get("vacancy_id") ?? "");
  const vacancyId = idSchema.safeParse(vacancyRaw).success ? vacancyRaw : undefined;
  if (!vacancyId && query.length < 3) return { error: "Describe the profile, or pick a vacancy.", query };
  try {
    const supabase = await createClient();
    const answer = await talentPoolTop(supabase, { query: vacancyId ? undefined : query, vacancyId, limit: 5, queue: true });
    if (answer.queued) revalidatePath("/dashboard/candidates/talent-pool");
    return {
      ok: true,
      answer,
      query,
      vacancyId,
      warning: answer.queued
        ? "This is the keyword ranking. Claude ranks the shortlist through the MCP in its next run of claude-requests; its answer appears under Claude's answers."
        : undefined,
      message: answer.hits.length === 0 ? "Nobody in the pool matches this profile yet." : undefined,
    };
  } catch (error) {
    return { ...failure(error), query, vacancyId };
  }
}

/**
 * One click anonymous profile from the talent pool: records the candidate as
 * an approved match for the chosen vacancy and runs the existing T4 profile
 * (redaction, anonymity check, PDF). Consent rules stay with the profile.
 */
export async function createPoolProfileAction(
  candidateId: string,
  match: { score: number | null; reason: string },
  _prev: TalentActionState,
  formData: FormData,
): Promise<TalentActionState> {
  const user = await requireStaff();
  const vacancyId = String(formData.get("vacancy_id") ?? "");
  if (!idSchema.safeParse(candidateId).success) return { error: GENERIC_ERROR };
  if (!idSchema.safeParse(vacancyId).success) return { error: "Choose the vacancy the profile is for." };
  const supabase = await createClient();
  const { data: existing } = await supabase.from("matches").select("id, status").eq("vacancy_id", vacancyId).eq("candidate_id", candidateId).maybeSingle();
  let matchId = existing?.id ?? null;
  const now = new Date().toISOString();
  if (existing?.status === "afgewezen") return { error: "This candidate was rejected as a match for this vacancy." };
  if (!existing) {
    const { data, error } = await supabase
      .from("matches")
      .insert({
        vacancy_id: vacancyId,
        candidate_id: candidateId,
        score: match.score === null ? null : Math.max(0, Math.min(100, Math.round(match.score))),
        reason: match.reason.slice(0, 1000),
        source: "eigen_pool",
        status: "goedgekeurd",
        approved_by: user.id,
        approved_at: now,
      })
      .select("id")
      .single();
    if (error || !data) return { error: GENERIC_ERROR };
    matchId = data.id;
  } else if (existing.status === "voorgesteld") {
    const { error } = await supabase.from("matches").update({ status: "goedgekeurd", approved_by: user.id, approved_at: now }).eq("id", existing.id);
    if (error) return { error: GENERIC_ERROR };
  }
  try {
    const made = await generateAnonymousProfile(supabase, matchId!);
    revalidatePath(`/dashboard/vacancies/${vacancyId}`);
    if (!made) {
      return { ok: true, message: "Sent to Claude. The profile appears on the vacancy after its next run of claude-requests, once it passed the anonymity check." };
    }
    return {
      ok: true,
      message: `Profile ${made.code} created and it passed the anonymity check. Approve it on the vacancy before sending.`,
      link: { href: `/dashboard/vacancies/${vacancyId}/profiles/${made.profileId}`, label: "Open the PDF" },
    };
  } catch (error) {
    return failure(error);
  }
}
