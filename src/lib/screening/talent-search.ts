import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { askJson, hasClaude } from "@/lib/ai/claude";
import { MATCH_SYSTEM, matchInput, matchResultSchema } from "@/lib/ai/prompts/match";
import { PROFILE_QUERY_SYSTEM, profileQuerySchema } from "@/lib/ai/prompts/screening";
import type { Database } from "@/lib/database.types";
import { listPoolCandidates, type PoolCandidate } from "@/lib/talent/pool";
import {
  clampScore,
  judgementPayload,
  prefilterCandidates,
  requirementsPayload,
  twoSentences,
  type VacancyRequirements,
} from "@/lib/talent/prefilter";
import { requirementsFromText } from "@/lib/screening/talent-query";

/**
 * Talent pool AI (2.15): "who are the best 5 for this profile?". The
 * profile is a free text description or a vacancy. t2_candidate_pool and
 * the T2 prefilter narrow the pool, Claude ranks the shortlist with the T2
 * match prompt (only redacted fields), and the top N come back with the
 * reason, skills, project experience and location. Without Claude the
 * keyword prefilter ranks on its own and says so.
 */

type Db = SupabaseClient<Database>;

/** A vacancy id that never has applications: the pool without a vacancy filter. */
const NO_VACANCY = "00000000-0000-0000-0000-000000000000";

export type TalentPoolHit = {
  candidateId: string;
  name: string;
  score: number | null;
  reason: string;
  risks: string[];
  missing: string[];
  skills: string[];
  projectTypes: string[];
  sectors: string[];
  location: string | null;
  yearsExperience: number | null;
  seniority: string | null;
  currentTitle: string | null;
  availability: string | null;
  englishLevel: string | null;
};

export type TalentPoolAnswer = {
  requirements: VacancyRequirements;
  poolSize: number;
  shortlisted: number;
  rankedBy: "claude" | "keywords";
  hits: TalentPoolHit[];
};

async function requirementsFor(db: Db, input: { query?: string; vacancyId?: string }): Promise<VacancyRequirements> {
  if (input.vacancyId) {
    const { data, error } = await db
      .from("vacancies")
      .select("title, stack, seniority, hours, timezone_overlap, budget_min, budget_max, client_contact_required, must_haves, nice_to_haves")
      .eq("id", input.vacancyId)
      .maybeSingle();
    if (error) throw new Error(`Could not load the vacancy: ${error.message}`);
    if (!data) throw new Error("This vacancy no longer exists.");
    return data;
  }
  const query = (input.query ?? "").trim();
  if (query.length < 3) throw new Error("Describe the profile you are looking for, or pick a vacancy.");
  const base = requirementsFromText(query);
  if (!hasClaude()) return base;
  try {
    const parsed = await askJson({ system: PROFILE_QUERY_SYSTEM, input: query.slice(0, 4000), schema: profileQuerySchema, effort: "low", model: "claude-haiku-5-5", maxTokens: 2000 });
    return { ...base, ...parsed, stack: parsed.stack.length > 0 ? parsed.stack : base.stack };
  } catch {
    return base;
  }
}

function hitOf(c: PoolCandidate, r: { score: number | null; reason: string; risks: string[]; missing: string[] }): TalentPoolHit {
  return {
    candidateId: c.id,
    name: c.name,
    score: r.score,
    reason: r.reason,
    risks: r.risks,
    missing: r.missing,
    skills: c.skills,
    projectTypes: c.projectTypes,
    sectors: c.sectors,
    location: c.location,
    yearsExperience: c.yearsExperience,
    seniority: c.seniority,
    currentTitle: c.currentTitle,
    availability: c.availability,
    englishLevel: c.englishLevel,
  };
}

export async function talentPoolTop(db: Db, input: { query?: string; vacancyId?: string; limit?: number }): Promise<TalentPoolAnswer> {
  const limit = Math.max(1, Math.min(input.limit ?? 5, 10));
  const requirements = await requirementsFor(db, input);
  const pool = await listPoolCandidates(db, input.vacancyId ?? NO_VACANCY, requirements, 500);
  const shortlist = prefilterCandidates(requirements, pool, 20);

  if (!hasClaude() || shortlist.length === 0) {
    return {
      requirements,
      poolSize: pool.length,
      shortlisted: shortlist.length,
      rankedBy: "keywords",
      hits: shortlist.slice(0, limit).map(({ candidate, hits }) =>
        hitOf(candidate, {
          score: null,
          reason: hits.length > 0 ? `Matches ${hits.join(", ")} (keyword prefilter; Claude is not connected).` : "Keyword prefilter only.",
          risks: [],
          missing: [],
        }),
      ),
    };
  }

  const refs = new Map<string, PoolCandidate>();
  const payload = shortlist.map(({ candidate }, i) => {
    const ref = `K${i + 1}`;
    refs.set(ref, candidate);
    return judgementPayload(candidate, ref);
  });
  const result = await askJson({ system: MATCH_SYSTEM, input: matchInput(requirementsPayload(requirements), payload), schema: matchResultSchema });
  const ranked = result.candidates
    .filter((r) => refs.has(r.ref))
    .map((r) => ({ c: refs.get(r.ref)!, score: clampScore(r.score), reason: twoSentences(r.reason), risks: r.risks, missing: r.missing }))
    .filter((r, i, all) => all.findIndex((x) => x.c.id === r.c.id) === i)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return {
    requirements,
    poolSize: pool.length,
    shortlisted: shortlist.length,
    rankedBy: "claude",
    hits: ranked.map((r) => hitOf(r.c, r)),
  };
}
