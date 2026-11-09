import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { askJsonWithUsage, ClaudeRefusalError, hasClaude } from "@/lib/ai/claude";
import {
  cvInput,
  cvScoreSchema,
  jobInput,
  SCREENING_DEFAULT_INSTRUCTIONS,
  screeningSystem,
  type ScoringRequirement,
} from "@/lib/ai/prompts/screening";
import type { CvScorePurpose, Database, Json, ScreeningModel, TablesInsert } from "@/lib/database.types";
import { redactIdentifiers } from "@/lib/talent/anonymize";
import { readStoredCv } from "@/lib/screening/cv-read";
import { mapLimit } from "@/lib/screening/limit";
import {
  costUsd,
  DEFAULT_SCREENING_MODEL,
  effortFor,
  isScreeningModel,
  normalizeScore,
  scoringRequirements,
} from "@/lib/screening/scoring";

/**
 * Score CVs against the JD (2.11) with Claude. No daily limit: the job
 * scores everything that is unscored, with bounded concurrency. The job
 * part of the prompt is the same for every CV of a vacancy and sits in a
 * cached block, so only the CV is paid in full per call. Each score stores
 * the model, the prompt version, the breakdown and the cost; a database
 * trigger copies real scores to the application (cv_score, cv_verdict).
 */

type Db = SupabaseClient<Database>;

export type ActivePrompt = { id: string | null; version: number; instructions: string };

export const BUILT_IN_PROMPT: ActivePrompt = { id: null, version: 0, instructions: SCREENING_DEFAULT_INSTRUCTIONS };

/** The active prompt version, or the built-in instructions (version 0). */
export async function getActivePrompt(db: Db): Promise<ActivePrompt> {
  const { data } = await db.from("screening_prompts").select("id, version, instructions").eq("is_active", true).maybeSingle();
  return data ?? BUILT_IN_PROMPT;
}

export async function getPrompt(db: Db, promptId: string | null): Promise<ActivePrompt> {
  if (!promptId) return BUILT_IN_PROMPT;
  const { data, error } = await db.from("screening_prompts").select("id, version, instructions").eq("id", promptId).maybeSingle();
  if (error || !data) throw new Error("This prompt version no longer exists.");
  return data;
}

export type ScoreRunOptions = {
  vacancyId?: string;
  applicationIds?: string[];
  /** Only applications without a score (default true). */
  onlyUnscored?: boolean;
  /** Model for this run; else the vacancy's model, else the default. */
  model?: ScreeningModel;
  /** Bulk first pass: low effort. */
  bulk?: boolean;
  /** At most this many applications in this run. */
  limit?: number;
  concurrency?: number;
  purpose?: CvScorePurpose;
  /** A specific prompt version (compare), undefined: the active one, null: built-in. */
  promptId?: string | null;
  log?: (message: string) => void;
};

export type ScoreRunSummary = {
  considered: number;
  scored: number;
  skipped: number;
  failed: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  /** Applications left over when the limit was reached. */
  remaining: number;
  errors: string[];
};

export const OUT_OF_FLOW = ["rejected", "placed"];

export const CANDIDATE_SCORING_COLUMNS =
  "id, full_name, email, phone, cv_text, cv_text_status, cv_path, skills, current_title, years_experience, summary" as const;

export type CandidateRow = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  cv_text: string | null;
  cv_text_status: string | null;
  cv_path: string | null;
  skills: string[];
  current_title: string | null;
  years_experience: number | null;
  summary: string | null;
};

/** The text Claude scores: the CV text with name and contact details removed, else the profile fields. */
export function scoringText(c: CandidateRow): string | null {
  const ids = {
    nameParts: c.full_name.split(/[\s.,-]+/).filter((p) => p.length >= 2),
    email: c.email,
    phone: c.phone,
    employers: [],
    skills: c.skills,
  };
  if (c.cv_text?.trim()) return redactIdentifiers(c.cv_text, ids).slice(0, 40000);
  if (c.skills.length === 0 && !c.summary?.trim()) return null;
  return [
    "(No CV text; profile fields only.)",
    c.current_title ? `Current title: ${redactIdentifiers(c.current_title, ids)}` : null,
    c.years_experience !== null ? `Years of experience: ${c.years_experience}` : null,
    c.skills.length > 0 ? `Skills: ${c.skills.join(", ")}` : null,
    c.summary ? `Summary: ${redactIdentifiers(c.summary, ids)}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function loadScoringVacancy(db: Db, vacancyId: string) {
  const [{ data: vacancy, error }, { data: rows }] = await Promise.all([
    db
      .from("vacancies")
      .select("id, title, seniority, description, raw_text, stack, must_haves, nice_to_haves, screening_model")
      .eq("id", vacancyId)
      .maybeSingle(),
    db.from("vacancy_requirements").select("label, kind, alternatives, position").eq("vacancy_id", vacancyId).order("position"),
  ]);
  if (error) throw new Error(`Could not load the vacancy: ${error.message}`);
  if (!vacancy) throw new Error("This vacancy no longer exists.");
  return { vacancy, requirements: scoringRequirements(vacancy, rows ?? []) };
}

/** Insert a score; a real score also clears a pending score request. */
export async function insertCvScore(db: Db, row: TablesInsert<"cv_scores">) {
  const { error } = await db.from("cv_scores").insert(row);
  if (error) throw new Error(`Could not save the score: ${error.message}`);
  if ((row.purpose ?? "score") === "score") {
    const { error: clearError } = await db.from("applications").update({ score_requested_at: null }).eq("id", row.application_id);
    if (clearError) throw new Error(`Could not clear the score request: ${clearError.message}`);
  }
}

export async function scoreApplications(db: Db, options: ScoreRunOptions = {}): Promise<ScoreRunSummary> {
  const { onlyUnscored = true, bulk = false, limit = 200, concurrency = 4, purpose = "score", log = () => {} } = options;
  if (!hasClaude()) throw new Error("ANTHROPIC_API_KEY is missing: CVs are scored by Claude's scheduled task claude-screening.");

  let q = db
    .from("applications")
    .select("id, vacancy_id, candidate_id", { count: "exact" })
    .not("stage", "in", `(${OUT_OF_FLOW.join(",")})`)
    .order("created_at", { ascending: true })
    .limit(Math.max(1, Math.min(limit, 2000)));
  if (options.vacancyId) q = q.eq("vacancy_id", options.vacancyId);
  if (options.applicationIds && options.applicationIds.length > 0) q = q.in("id", options.applicationIds);
  if (onlyUnscored) q = q.is("cv_scored_at", null);
  const { data: apps, error, count } = await q;
  if (error) throw new Error(`Could not load the applications: ${error.message}`);

  const summary: ScoreRunSummary = {
    considered: apps?.length ?? 0,
    scored: 0,
    skipped: 0,
    failed: 0,
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    remaining: Math.max(0, (count ?? 0) - (apps?.length ?? 0)),
    errors: [],
  };
  if (!apps || apps.length === 0) return summary;

  const prompt = options.promptId === undefined ? await getActivePrompt(db) : await getPrompt(db, options.promptId);
  const system = screeningSystem(prompt.instructions);
  log(`Prompt version ${prompt.version}. ${apps.length} applications to score.`);

  const byVacancy = new Map<string, typeof apps>();
  for (const a of apps) byVacancy.set(a.vacancy_id, [...(byVacancy.get(a.vacancy_id) ?? []), a]);

  for (const [vacancyId, group] of byVacancy) {
    const { vacancy, requirements } = await loadScoringVacancy(db, vacancyId);
    const model: ScreeningModel = options.model ?? (isScreeningModel(vacancy.screening_model) ? vacancy.screening_model : DEFAULT_SCREENING_MODEL);
    const effort = effortFor(model, bulk);
    const job = jobInput({ ...vacancy, description: vacancy.description ?? vacancy.raw_text }, requirements);
    log(`${vacancy.title}: ${group.length} CVs with ${model} (${effort} effort), ${requirements.length} requirements.`);

    const { data: candidates } = await db
      .from("candidates")
      .select(CANDIDATE_SCORING_COLUMNS)
      .in("id", [...new Set(group.map((a) => a.candidate_id))]);
    const byId = new Map((candidates ?? []).map((c) => [c.id, c as CandidateRow]));

    // Score the first CV alone so the job block is cached before the others start.
    const first = group.slice(0, 1);
    const rest = group.slice(1);
    for (const batch of [first, rest]) {
      await mapLimit(batch, batch === first ? 1 : concurrency, async (app) => {
        let candidate = byId.get(app.candidate_id);
        if (!candidate) {
          summary.skipped += 1;
          return;
        }
        if (!candidate.cv_text && candidate.cv_path && candidate.cv_text_status !== "failed") {
          try {
            await readStoredCv(db, candidate.id);
            const { data } = await db
              .from("candidates")
              .select(CANDIDATE_SCORING_COLUMNS)
              .eq("id", candidate.id)
              .maybeSingle();
            if (data) candidate = data as CandidateRow;
          } catch {
            // Score on the profile fields instead.
          }
        }
        const text = scoringText(candidate);
        if (!text) {
          summary.skipped += 1;
          return;
        }
        try {
          const { data, usage } = await askJsonWithUsage({
            system,
            input: [
              { type: "text", text: job, cache: true },
              { type: "text", text: cvInput(text) },
            ],
            schema: cvScoreSchema,
            effort,
            model,
            maxTokens: 6000,
          });
          const result = normalizeScore(data, requirements);
          const cost = costUsd(usage);
          const row: TablesInsert<"cv_scores"> = {
            application_id: app.id,
            vacancy_id: vacancyId,
            candidate_id: candidate.id,
            purpose,
            score: result.score,
            verdict: result.verdict,
            summary: result.summary,
            breakdown: result.breakdown as unknown as Json,
            must_have_missing: result.mustHaveMissing,
            model: usage.model,
            prompt_id: prompt.id,
            prompt_version: prompt.version,
            effort,
            input_tokens: usage.inputTokens,
            output_tokens: usage.outputTokens,
            cache_read_tokens: usage.cacheReadTokens,
            cache_write_tokens: usage.cacheWriteTokens,
            cost_usd: cost,
          };
          await insertCvScore(db, row);
          summary.scored += 1;
          summary.costUsd += cost ?? 0;
          summary.inputTokens += usage.inputTokens;
          summary.outputTokens += usage.outputTokens;
          summary.cacheReadTokens += usage.cacheReadTokens;
        } catch (e) {
          summary.failed += 1;
          const message = e instanceof ClaudeRefusalError ? "Claude declined one CV" : e instanceof Error ? e.message : "unknown error";
          if (summary.errors.length < 5) summary.errors.push(message);
        }
      });
    }
  }
  summary.costUsd = Math.round(summary.costUsd * 10000) / 10000;
  log(`${summary.scored} scored, ${summary.skipped} without CV, ${summary.failed} failed, about $${summary.costUsd.toFixed(4)}.`);
  return summary;
}

/**
 * Compare a prompt version (or model) with the current scores: re-score a
 * sample of already scored applications of one vacancy as purpose
 * 'compare'. The application keeps its real score.
 */
export async function compareSample(
  db: Db,
  { vacancyId, promptId, model, sampleSize = 10 }: { vacancyId: string; promptId: string | null; model?: ScreeningModel; sampleSize?: number },
) {
  const { data: apps, error } = await db
    .from("applications")
    .select("id")
    .eq("vacancy_id", vacancyId)
    .not("cv_scored_at", "is", null)
    .order("cv_scored_at", { ascending: false })
    .limit(Math.max(1, Math.min(sampleSize, 50)));
  if (error) throw new Error(`Could not load the applications: ${error.message}`);
  if (!apps || apps.length === 0) throw new Error("Nothing to compare yet: score some CVs of this vacancy first.");
  return scoreApplications(db, {
    applicationIds: apps.map((a) => a.id),
    onlyUnscored: false,
    purpose: "compare",
    promptId,
    model,
    limit: apps.length,
  });
}

export type { ScoringRequirement };
