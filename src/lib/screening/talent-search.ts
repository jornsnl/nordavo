import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { askJson, hasClaude } from "@/lib/ai/claude";
import { MATCH_SYSTEM, matchInput, matchResultSchema } from "@/lib/ai/prompts/match";
import { PROFILE_QUERY_SYSTEM, profileQuerySchema } from "@/lib/ai/prompts/screening";
import type { Database } from "@/lib/database.types";
import { requestAi, type AiRequest } from "@/lib/ai/queue";
import type { Json } from "@/lib/database.types";
import { getPoolCandidate, listPoolCandidates, type PoolCandidate } from "@/lib/talent/pool";
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
  /** Sent to Claude through the MCP (claude-requests): its ranking comes later. */
  queued?: boolean;
  /** Without the API key: what Claude needs to rank the shortlist itself (the MCP tool). */
  forClaude?: { instructions: string; requirements: unknown; question: string | null; candidates: unknown[] };
};

/** The shortlist as Claude sees it: redacted, with the candidate id as ref. */
function rankPayload(requirements: VacancyRequirements, shortlist: { candidate: PoolCandidate }[], query: string | undefined) {
  const candidates = shortlist.map(({ candidate }) => judgementPayload(candidate, candidate.id));
  const question = query?.trim() ? query.trim() : null;
  const input = `${matchInput(requirementsPayload(requirements), candidates)}${question ? `\n\nThe question of the recruiter, in their own words:\n${question}` : ""}`;
  return { candidates, question, input };
}

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

export async function talentPoolTop(
  db: Db,
  input: { query?: string; vacancyId?: string; limit?: number; queue?: boolean },
): Promise<TalentPoolAnswer> {
  const limit = Math.max(1, Math.min(input.limit ?? 5, 10));
  const requirements = await requirementsFor(db, input);
  const pool = await listPoolCandidates(db, input.vacancyId ?? NO_VACANCY, requirements, 500);
  const shortlist = prefilterCandidates(requirements, pool, 20);

  if (!hasClaude() || shortlist.length === 0) {
    const payload = rankPayload(requirements, shortlist, input.query);
    let queued = false;
    if (!hasClaude() && shortlist.length > 0 && input.queue) {
      await requestAi(db, {
        kind: "talent_pool_rank",
        module: "recruitment",
        system: MATCH_SYSTEM,
        input: `${payload.input}\n\nThe ref of a candidate is its candidate id. Rank every candidate.`,
        context: {
          query: payload.question,
          vacancy_id: input.vacancyId ?? null,
          limit,
          pool_size: pool.length,
          shortlisted: shortlist.length,
          requirements: requirements as unknown as Json,
          candidate_ids: shortlist.map(({ candidate }) => candidate.id),
        },
      });
      queued = true;
    }
    return {
      queued,
      forClaude:
        !hasClaude() && shortlist.length > 0
          ? { instructions: MATCH_SYSTEM, requirements: requirementsPayload(requirements), question: payload.question, candidates: payload.candidates }
          : undefined,
      requirements,
      poolSize: pool.length,
      shortlisted: shortlist.length,
      rankedBy: "keywords",
      hits: shortlist.slice(0, limit).map(({ candidate, hits }) =>
        hitOf(candidate, {
          score: null,
          reason: hits.length > 0 ? `Matches ${hits.join(", ")} (keyword prefilter).` : "Keyword prefilter only.",
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

/** Claude's ranking of a queued talent pool question (claude-requests), as an answer for the page. */
export async function answerFromRequest(db: Db, request: AiRequest): Promise<TalentPoolAnswer | null> {
  const ctx = request.context;
  const ids = Array.isArray(ctx.candidate_ids) ? ctx.candidate_ids.filter((x): x is string => typeof x === "string") : [];
  const requirements = (ctx.requirements ?? null) as unknown as VacancyRequirements | null;
  if (!requirements) return null;
  const limit = typeof ctx.limit === "number" ? ctx.limit : 5;
  const parsed = request.status === "done" ? matchResultSchema.safeParse(request.result) : null;
  const ranked = parsed?.success
    ? parsed.data.candidates
        .filter((r) => ids.includes(r.ref))
        .map((r) => ({ id: r.ref, score: clampScore(r.score), reason: twoSentences(r.reason), risks: r.risks, missing: r.missing }))
        .filter((r, i, all) => all.findIndex((x) => x.id === r.id) === i)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
    : [];
  const hits: TalentPoolHit[] = [];
  for (const r of ranked) {
    const c = await getPoolCandidate(db, r.id);
    if (c) hits.push(hitOf(c, r));
  }
  return {
    requirements,
    poolSize: typeof ctx.pool_size === "number" ? ctx.pool_size : 0,
    shortlisted: typeof ctx.shortlisted === "number" ? ctx.shortlisted : ids.length,
    rankedBy: "claude",
    hits,
    queued: request.status === "pending",
  };
}
