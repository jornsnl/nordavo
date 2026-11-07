import type { SupabaseClient } from "@supabase/supabase-js";
import type { Candidate, CandidateStatus, Database } from "@/lib/database.types";
import { poolPatterns, type VacancyRequirements } from "@/lib/talent/prefilter";

/**
 * The T2 talent pool: candidates in the portal (public.candidates). The
 * matcher, the anonymous profile and the matches list all read candidates
 * through this module, mapped to one PoolCandidate shape.
 */

type Db = SupabaseClient<Database>;

/** Statuses that count as the pool. Placed and unavailable candidates are not matched. */
export const POOL_STATUSES: CandidateStatus[] = ["available", "in_process"];

/** Default cap on the candidates read for one matching run (the SQL prefilter ranks them first). */
export const POOL_LIMIT = 500;

/** A pool candidate as T2 and T4 use it. Identifiers only go to the anonymity checks. */
export type PoolCandidate = {
  id: string;
  name: string;
  /** Name parts for the anonymisation check. */
  nameParts: string[];
  email: string | null;
  phone: string | null;
  skills: string[];
  yearsExperience: number | null;
  seniority: string | null;
  currentTitle: string | null;
  /** Current and previous employers, for the anonymisation check only. */
  employers: string[];
  projectTypes: string[];
  sectors: string[];
  cvText: string | null;
  summary: string | null;
  /** An uploaded CV file exists (the file itself is not parsed). */
  hasCvAttachment: boolean;
  englishLevel: string | null;
  availability: string | null;
  location: string | null;
  status: CandidateStatus;
  /** true: consent given, false: explicitly refused, null: unknown. */
  consent: boolean | null;
};

/** The candidate columns the pool needs. */
export const POOL_COLUMNS =
  "id, full_name, email, phone, location, current_title, years_experience, skills, cv_path, summary, status, seniority, employers, project_types, sectors, cv_text, english_level, availability, profile_consent";

export type PoolCandidateRow = Pick<
  Candidate,
  | "id"
  | "full_name"
  | "email"
  | "phone"
  | "location"
  | "current_title"
  | "years_experience"
  | "skills"
  | "cv_path"
  | "summary"
  | "status"
  | "seniority"
  | "employers"
  | "project_types"
  | "sectors"
  | "cv_text"
  | "english_level"
  | "availability"
  | "profile_consent"
>;

function text(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** Trimmed, without empty items and case-insensitive duplicates. */
function uniqueList(values: readonly (string | null | undefined)[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed || seen.has(trimmed.toLowerCase())) continue;
    seen.add(trimmed.toLowerCase());
    result.push(trimmed);
  }
  return result;
}

export function mapPortalCandidate(row: PoolCandidateRow): PoolCandidate {
  const name = text(row.full_name) ?? "";
  const nameParts = name
    .split(/[\s.,\-]+/)
    .map((part) => part.trim())
    .filter((part, i, all) => part.length >= 2 && all.indexOf(part) === i);
  return {
    id: row.id,
    name: name || "Unknown name",
    nameParts,
    email: text(row.email),
    phone: text(row.phone),
    skills: uniqueList(row.skills),
    yearsExperience: row.years_experience,
    seniority: row.seniority,
    currentTitle: text(row.current_title),
    employers: uniqueList(row.employers),
    projectTypes: uniqueList(row.project_types),
    sectors: uniqueList(row.sectors),
    cvText: text(row.cv_text),
    summary: text(row.summary),
    hasCvAttachment: Boolean(row.cv_path),
    englishLevel: text(row.english_level),
    availability: text(row.availability),
    location: text(row.location),
    status: row.status,
    consent: row.profile_consent,
  };
}

/** How many candidates are in the pool at all (for the run summary). */
export async function countPool(db: Db) {
  const { count, error } = await db.from("candidates").select("id", { count: "exact", head: true }).in("status", POOL_STATUSES);
  if (error) throw new Error(`Could not count the candidate pool: ${error.message}`);
  return count ?? 0;
}

/**
 * The bounded pool for one vacancy, ranked by the SQL prefilter: no placed,
 * unavailable or junior candidates, nobody already in the vacancy's pipeline
 * and no match staff rejected. With a stack, only candidates with overlap.
 */
export async function listPoolCandidates(
  db: Db,
  vacancyId: string,
  vacancy: Pick<VacancyRequirements, "stack" | "must_haves">,
  limit = POOL_LIMIT,
): Promise<PoolCandidate[]> {
  const { patterns, weights } = poolPatterns(vacancy);
  const { data, error } = await db.rpc("t2_candidate_pool", {
    p_vacancy_id: vacancyId,
    p_patterns: patterns,
    p_weights: weights,
    p_require_hit: vacancy.stack.length > 0,
    p_limit: limit,
  });
  if (error) throw new Error(`Could not load the candidate pool: ${error.message}`);
  return (data ?? []).map(mapPortalCandidate);
}

/** One candidate by id, or null when it no longer exists. */
export async function getPoolCandidate(db: Db, candidateId: string): Promise<PoolCandidate | null> {
  const { data, error } = await db.from("candidates").select(POOL_COLUMNS).eq("id", candidateId).maybeSingle();
  if (error) throw new Error(`Could not load the candidate: ${error.message}`);
  return data ? mapPortalCandidate(data) : null;
}
