import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { askJson, hasClaude } from "@/lib/ai/claude";
import { MATCH_SYSTEM, matchInput, matchResultSchema } from "@/lib/ai/prompts/match";
import { SEARCH_SYSTEM, searchBriefSchema, searchInput, type SearchBrief } from "@/lib/ai/prompts/search";
import type { Database, Json, TalentStage, TablesInsert } from "@/lib/database.types";
import { countPool, listPoolCandidates, POOL_LIMIT } from "@/lib/talent/pool";
import {
  clampScore,
  judgementPayload,
  needsSearchBrief,
  prefilterCandidates,
  requirementsPayload,
  selectMatchesToStore,
  twoSentences,
  type VacancyRequirements,
} from "@/lib/talent/prefilter";

/**
 * T2 matching and T3 search brief. Used by the t2-match job (service role)
 * and by the "Match" button (the user's client, staff RLS). The pool is the
 * portal's candidates table (src/lib/talent/pool.ts). A match stores the
 * candidate id, score, reason, risks, missing must haves and status. Claude
 * only sees redacted candidate fields; logs carry counts only.
 */

type Db = SupabaseClient<Database>;

export type MatchOptions = {
  /** How many prefiltered candidates Claude scores. */
  topN?: number;
  /** Candidates per Claude call. */
  batchSize?: number;
  /** Also store every candidate scoring at least this; null: top 3 only. */
  keepAbove?: number | null;
  /** Cap on the candidates the SQL prefilter returns. */
  poolLimit?: number;
  log?: (message: string) => void;
};

export type MatchSummary = {
  poolSize: number;
  prefiltered: number;
  scored: number;
  stored: number;
  strong: number;
  searchBrief: boolean;
};

const STAGE_ORDER: TalentStage[] = ["intake", "zoeken", "profielen_verstuurd", "gesprekken", "geplaatst", "gesloten"];

/** Move the talent stage forward only, never back. */
export function advanceStage(current: TalentStage, next: TalentStage): TalentStage {
  return STAGE_ORDER.indexOf(next) > STAGE_ORDER.indexOf(current) ? next : current;
}

async function loadRequirements(db: Db, vacancyId: string) {
  const { data, error } = await db
    .from("vacancies")
    .select("id, title, stack, seniority, hours, timezone_overlap, budget_min, budget_max, client_contact_required, must_haves, nice_to_haves, talent_stage")
    .eq("id", vacancyId)
    .maybeSingle();
  if (error) throw new Error(`Could not load the vacancy: ${error.message}`);
  if (!data) throw new Error("This vacancy no longer exists.");
  return data;
}

function hasRequirements(v: VacancyRequirements) {
  return v.stack.length > 0 || v.must_haves.length > 0;
}

/** Run tasks with a small concurrency limit. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export async function runMatching(db: Db, vacancyId: string, options: MatchOptions = {}): Promise<MatchSummary> {
  const { topN = 25, batchSize = 5, keepAbove = 50, poolLimit = POOL_LIMIT, log = () => {} } = options;
  if (!hasClaude()) throw new Error("ANTHROPIC_API_KEY is missing: matching cannot run without Claude.");

  const vacancy = await loadRequirements(db, vacancyId);
  if (!hasRequirements(vacancy)) {
    throw new Error("This vacancy has no fixed requirements yet. Extract the vacancy first (T1) or fill in the stack and must haves.");
  }

  const [poolSize, pool] = await Promise.all([countPool(db), listPoolCandidates(db, vacancyId, vacancy, poolLimit)]);
  log(`Pool: ${poolSize} candidates, ${pool.length} after the SQL prefilter.`);
  const shortlist = prefilterCandidates(vacancy, pool, topN);
  log(`After the prefilter: ${shortlist.length} candidates go to Claude.`);

  const requirements = requirementsPayload(vacancy);
  const refToId = new Map<string, string>();
  const payloads = shortlist.map((item, i) => {
    const ref = `K${i + 1}`;
    refToId.set(ref, item.candidate.id);
    return judgementPayload(item.candidate, ref);
  });

  const batches: (typeof payloads)[] = [];
  for (let i = 0; i < payloads.length; i += Math.max(1, batchSize)) batches.push(payloads.slice(i, i + Math.max(1, batchSize)));

  let failedBatches = 0;
  const batchResults = await mapLimit(batches, 3, async (batch) => {
    try {
      const result = await askJson({ system: MATCH_SYSTEM, input: matchInput(requirements, batch), schema: matchResultSchema });
      return result.candidates;
    } catch (error) {
      failedBatches += 1;
      log(`A batch of ${batch.length} candidates could not be scored: ${error instanceof Error ? error.message : "unknown error"}`);
      return [];
    }
  });
  if (batches.length > 0 && failedBatches === batches.length) {
    throw new Error("Claude could not score any candidate. Try again later.");
  }

  const scored = batchResults
    .flat()
    .filter((r) => refToId.has(r.ref))
    .map((r) => ({
      candidateId: refToId.get(r.ref)!,
      score: clampScore(r.score),
      reason: twoSentences(r.reason),
      risks: r.risks.map((x) => x.trim()).filter(Boolean),
      missing: r.missing.map((x) => x.trim()).filter(Boolean),
    }))
    .filter((r, i, all) => all.findIndex((x) => x.candidateId === r.candidateId) === i);

  const toStore = selectMatchesToStore(scored, { keepAbove });
  if (toStore.length > 0) {
    // No status in the row: new matches get the default 'voorgesteld', existing
    // matches keep the status a recruiter already gave them.
    const rows: TablesInsert<"matches">[] = toStore.map((m) => ({
      vacancy_id: vacancyId,
      candidate_id: m.candidateId,
      score: m.score,
      reason: m.reason,
      risks: m.risks,
      missing: m.missing,
      source: "eigen_pool",
    }));
    const { error } = await db.from("matches").upsert(rows, { onConflict: "vacancy_id,candidate_id" });
    if (error) throw new Error(`Could not save the matches: ${error.message}`);
  }

  const strongScores = scored.map((s) => s.score);
  const strong = strongScores.filter((s) => s >= 70).length;
  const stage = advanceStage(vacancy.talent_stage, "zoeken");
  if (stage !== vacancy.talent_stage) {
    const { error } = await db.from("vacancies").update({ talent_stage: stage }).eq("id", vacancyId);
    if (error) throw new Error(`Could not update the stage: ${error.message}`);
  }

  let searchBrief = false;
  if (needsSearchBrief(strongScores)) {
    log(`Fewer than 3 strong matches (${strong}): making a search brief outside the pool.`);
    await generateSearchBrief(db, vacancyId, { scored: scored.length, strong });
    searchBrief = true;
  }

  return {
    poolSize,
    prefiltered: shortlist.length,
    scored: scored.length,
    stored: toStore.length,
    strong,
    searchBrief,
  };
}

export type StoredSearchBrief = SearchBrief & { generated_at: string; scored: number; strong: number };

/** T3: search terms and booleans for LinkedIn Recruiter and Naukri, stored on the vacancy. */
export async function generateSearchBrief(
  db: Db,
  vacancyId: string,
  context: { scored: number; strong: number } = { scored: 0, strong: 0 },
): Promise<StoredSearchBrief> {
  if (!hasClaude()) throw new Error("ANTHROPIC_API_KEY is missing: a search brief cannot be made without Claude.");
  const vacancy = await loadRequirements(db, vacancyId);
  if (!hasRequirements(vacancy)) {
    throw new Error("This vacancy has no fixed requirements yet. Extract the vacancy first.");
  }
  const brief = await askJson({
    system: SEARCH_SYSTEM,
    input: searchInput(requirementsPayload(vacancy), context),
    schema: searchBriefSchema,
    effort: "low",
  });
  // Bangalore always first (briefing T3).
  const locations = brief.locations.filter((l) => !/bangalore|bengaluru/i.test(l));
  const stored: StoredSearchBrief = {
    ...brief,
    locations: ["Bangalore (Bengaluru)", ...locations],
    generated_at: new Date().toISOString(),
    ...context,
  };
  const { error } = await db
    .from("vacancies")
    .update({ search_brief: stored as unknown as Json })
    .eq("id", vacancyId);
  if (error) throw new Error(`Could not save the search brief: ${error.message}`);
  return stored;
}

/** Read a stored search brief back, tolerating older or partial JSON. */
export function readSearchBrief(value: Json | null): StoredSearchBrief | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const parsed = searchBriefSchema.safeParse(value);
  if (!parsed.success) return null;
  const v = value as Record<string, unknown>;
  return {
    ...parsed.data,
    generated_at: typeof v.generated_at === "string" ? v.generated_at : "",
    scored: typeof v.scored === "number" ? v.scored : 0,
    strong: typeof v.strong === "number" ? v.strong : 0,
  };
}
