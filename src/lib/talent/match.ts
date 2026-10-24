import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { askJson, hasClaude } from "@/lib/ai/claude";
import { MATCH_SYSTEM, matchInput, matchResultSchema } from "@/lib/ai/prompts/match";
import { SEARCH_SYSTEM, searchBriefSchema, searchInput, type SearchBrief } from "@/lib/ai/prompts/search";
import type { Database, Json, TalentStage, TablesInsert } from "@/lib/database.types";
import { hasAirtable, listPoolCandidates } from "@/lib/integrations/airtable";
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
 * and by the "Matchen" button (the user's client, staff RLS). Candidate
 * details stay in memory: only the Airtable id, score, reason, risks,
 * missing must haves and status are written (hard rule 11). Logs carry counts only.
 */

type Db = SupabaseClient<Database>;

export type MatchOptions = {
  /** How many prefiltered candidates Claude scores. */
  topN?: number;
  /** Candidates per Claude call. */
  batchSize?: number;
  /** Also store every candidate scoring at least this; null: top 3 only. */
  keepAbove?: number | null;
  /** Optional extra Airtable formula. */
  filterByFormula?: string;
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
  if (error) throw new Error(`Vacature laden mislukt: ${error.message}`);
  if (!data) throw new Error("Deze vacature bestaat niet (meer).");
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
  const { topN = 25, batchSize = 5, keepAbove = 50, filterByFormula, log = () => {} } = options;
  if (!hasAirtable()) {
    throw new Error("Airtable is niet gekoppeld: zet AIRTABLE_TOKEN, AIRTABLE_BASE_ID en AIRTABLE_CANDIDATES_TABLE.");
  }
  if (!hasClaude()) throw new Error("ANTHROPIC_API_KEY ontbreekt: matchen kan niet zonder Claude.");

  const vacancy = await loadRequirements(db, vacancyId);
  if (!hasRequirements(vacancy)) {
    throw new Error("Deze vacature heeft nog geen vaste eisen. Lees eerst de vacature uit (T1) of vul stack en must haves in.");
  }

  const pool = await listPoolCandidates({ filterByFormula });
  log(`Pool: ${pool.length} kandidaten.`);
  const shortlist = prefilterCandidates(vacancy, pool, topN);
  log(`Na voorselectie: ${shortlist.length} kandidaten naar Claude.`);

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
      log(`Een batch van ${batch.length} kandidaten kon niet gescoord worden: ${error instanceof Error ? error.message : "onbekende fout"}`);
      return [];
    }
  });
  if (batches.length > 0 && failedBatches === batches.length) {
    throw new Error("Claude kon geen enkele kandidaat scoren. Probeer het later opnieuw.");
  }

  const scored = batchResults
    .flat()
    .filter((r) => refToId.has(r.ref))
    .map((r) => ({
      airtableId: refToId.get(r.ref)!,
      score: clampScore(r.score),
      reason: twoSentences(r.reason),
      risks: r.risks.map((x) => x.trim()).filter(Boolean),
      missing: r.missing.map((x) => x.trim()).filter(Boolean),
    }))
    .filter((r, i, all) => all.findIndex((x) => x.airtableId === r.airtableId) === i);

  const toStore = selectMatchesToStore(scored, { keepAbove });
  if (toStore.length > 0) {
    // No status in the row: new matches get the default 'voorgesteld', existing
    // matches keep the status a recruiter already gave them.
    const rows: TablesInsert<"matches">[] = toStore.map((m) => ({
      vacancy_id: vacancyId,
      airtable_candidate_id: m.airtableId,
      score: m.score,
      reason: m.reason,
      risks: m.risks,
      missing: m.missing,
      source: "eigen_pool",
    }));
    const { error } = await db.from("matches").upsert(rows, { onConflict: "vacancy_id,airtable_candidate_id" });
    if (error) throw new Error(`Matches opslaan mislukt: ${error.message}`);
  }

  const strongScores = scored.map((s) => s.score);
  const strong = strongScores.filter((s) => s >= 70).length;
  const stage = advanceStage(vacancy.talent_stage, "zoeken");
  if (stage !== vacancy.talent_stage) {
    const { error } = await db.from("vacancies").update({ talent_stage: stage }).eq("id", vacancyId);
    if (error) throw new Error(`Fase bijwerken mislukt: ${error.message}`);
  }

  let searchBrief = false;
  if (needsSearchBrief(strongScores)) {
    log(`Minder dan 3 sterke matches (${strong}): zoekopdracht buiten de pool maken.`);
    await generateSearchBrief(db, vacancyId, { scored: scored.length, strong });
    searchBrief = true;
  }

  return {
    poolSize: pool.length,
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
  if (!hasClaude()) throw new Error("ANTHROPIC_API_KEY ontbreekt: een zoekopdracht maken kan niet zonder Claude.");
  const vacancy = await loadRequirements(db, vacancyId);
  if (!hasRequirements(vacancy)) {
    throw new Error("Deze vacature heeft nog geen vaste eisen. Lees eerst de vacature uit.");
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
  if (error) throw new Error(`Zoekopdracht opslaan mislukt: ${error.message}`);
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
