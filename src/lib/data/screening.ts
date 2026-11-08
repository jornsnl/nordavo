import "server-only";
import { requireAdmin, requireStaff } from "@/lib/auth";
import type { ApplicationStage, CandidateOrigin, CandidateSource, CvVerdict, ScreeningModel, TechstackResult } from "@/lib/database.types";
import { readBreakdown, rankApplications, scoringRequirements, type BreakdownItem } from "@/lib/screening/scoring";
import { createClient } from "@/lib/supabase/server";

/** Reads for the screening pages. Staff only; RLS decides what comes back. */

export async function getScreeningVacancy(vacancyId: string) {
  await requireStaff();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vacancies")
    .select("id, title, seniority, stack, must_haves, nice_to_haves, excluded_profiles, techstack_min_hits, screening_model, description, client:clients(name)")
    .eq("id", vacancyId)
    .maybeSingle();
  if (error) throw new Error(`Could not load the vacancy: ${error.message}`);
  return data;
}

export type SourceCounts = {
  total: number;
  bySource: { source: CandidateSource | null; count: number }[];
  byOrigin: { origin: CandidateOrigin; count: number; active: number }[];
};

/** 2.6.3: applicants per source and per origin for one vacancy. */
export async function getSourceCounts(vacancyId: string): Promise<SourceCounts> {
  await requireStaff();
  const supabase = await createClient();
  const { data, error } = await supabase.from("applications").select("source, origin, stage").eq("vacancy_id", vacancyId).limit(10000);
  if (error) throw new Error(`Could not count the sources: ${error.message}`);
  const rows = data ?? [];
  const bySource = new Map<CandidateSource | null, number>();
  for (const r of rows) bySource.set(r.source, (bySource.get(r.source) ?? 0) + 1);
  const origins: CandidateOrigin[] = ["applied", "headhunted"];
  return {
    total: rows.length,
    bySource: [...bySource.entries()].map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count),
    byOrigin: origins.map((origin) => ({
      origin,
      count: rows.filter((r) => r.origin === origin).length,
      active: rows.filter((r) => r.origin === origin && r.stage !== "rejected" && r.stage !== "parked").length,
    })),
  };
}

export type TechstackRow = {
  applicationId: string;
  candidateId: string;
  name: string;
  title: string | null;
  stage: ApplicationStage;
  skills: string[];
  check: { result: TechstackResult; reason: string; method: "rules" | "ai"; checkedAt: string } | null;
};

/** Candidates in sourced and techstack_check with their latest check. */
export async function listTechstackRows(vacancyId: string): Promise<TechstackRow[]> {
  await requireStaff();
  const supabase = await createClient();
  const [{ data: apps, error }, { data: checks }] = await Promise.all([
    supabase
      .from("applications")
      .select("id, stage, created_at, candidate:candidates(id, full_name, current_title, skills)")
      .eq("vacancy_id", vacancyId)
      .in("stage", ["sourced", "techstack_check"])
      .order("created_at")
      .limit(2000),
    supabase.from("techstack_checks").select("application_id, result, reason, method, checked_at").eq("vacancy_id", vacancyId).limit(5000),
  ]);
  if (error) throw new Error(`Could not load the candidates: ${error.message}`);
  const byApp = new Map((checks ?? []).map((c) => [c.application_id, c]));
  return (apps ?? []).flatMap((a) => {
    if (!a.candidate) return [];
    const c = byApp.get(a.id);
    return [
      {
        applicationId: a.id,
        candidateId: a.candidate.id,
        name: a.candidate.full_name,
        title: a.candidate.current_title,
        stage: a.stage,
        skills: a.candidate.skills,
        check: c ? { result: c.result, reason: c.reason, method: c.method, checkedAt: c.checked_at } : null,
      },
    ];
  });
}

export type RankingRow = {
  applicationId: string;
  candidateId: string;
  name: string;
  title: string | null;
  stage: ApplicationStage;
  source: CandidateSource | null;
  origin: CandidateOrigin;
  cvScore: number | null;
  cvVerdict: CvVerdict | null;
  scoredAt: string | null;
  hasCvText: boolean;
  cvTextPending: boolean;
  summary: string | null;
  breakdown: BreakdownItem[];
  mustHaveMissing: string[];
  model: string | null;
  promptVersion: number | null;
};

/** 2.11 ranking: applications sorted by match percentage, with the latest real score. */
export async function listRanking(vacancyId: string): Promise<RankingRow[]> {
  await requireStaff();
  const supabase = await createClient();
  const [{ data: apps, error }, { data: scores }] = await Promise.all([
    supabase
      .from("applications")
      .select("id, stage, source, origin, cv_score, cv_verdict, cv_scored_at, created_at, candidate:candidates(id, full_name, current_title, cv_text_status, cv_path, has_cv_text)")
      .eq("vacancy_id", vacancyId)
      .neq("stage", "placed")
      .limit(3000),
    supabase
      .from("cv_scores")
      .select("application_id, summary, breakdown, model, prompt_version, created_at")
      .eq("vacancy_id", vacancyId)
      .eq("purpose", "score")
      .order("created_at", { ascending: false })
      .limit(5000),
  ]);
  if (error) throw new Error(`Could not load the ranking: ${error.message}`);
  const latest = new Map<string, NonNullable<typeof scores>[number]>();
  for (const s of scores ?? []) if (!latest.has(s.application_id)) latest.set(s.application_id, s);
  const rows = (apps ?? []).flatMap((a) => {
    if (!a.candidate) return [];
    const s = latest.get(a.id);
    const breakdown = readBreakdown(s?.breakdown);
    return [
      {
        applicationId: a.id,
        candidateId: a.candidate.id,
        name: a.candidate.full_name,
        title: a.candidate.current_title,
        stage: a.stage,
        source: a.source,
        origin: a.origin,
        cv_score: a.cv_score,
        created_at: a.created_at,
        cvVerdict: a.cv_verdict,
        scoredAt: a.cv_scored_at,
        hasCvText: Boolean(a.candidate.has_cv_text),
        cvTextPending: a.candidate.cv_text_status === "pending",
        summary: s?.summary ?? null,
        breakdown,
        mustHaveMissing: breakdown.filter((b) => b.kind === "must_have" && b.status === "missing").map((b) => b.label),
        model: s?.model ?? null,
        promptVersion: s?.prompt_version ?? null,
      },
    ];
  });
  return rankApplications(rows).map(({ cv_score, created_at, ...rest }) => {
    void created_at;
    return { ...rest, cvScore: cv_score };
  });
}

export async function getRequirementRows(vacancyId: string) {
  await requireStaff();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vacancy_requirements")
    .select("label, kind, alternatives, position")
    .eq("vacancy_id", vacancyId)
    .order("position");
  if (error) throw new Error(`Could not load the requirements: ${error.message}`);
  return data ?? [];
}

/** What the scoring will use, and whether it comes from the structured table. */
export async function getScoringRequirements(vacancy: { id: string; stack: string[]; must_haves: string[]; nice_to_haves: string[] }) {
  const rows = await getRequirementRows(vacancy.id);
  return { rows, effective: scoringRequirements(vacancy, rows), structured: rows.length > 0 };
}

export type CandidateScore = {
  applicationId: string;
  vacancyId: string;
  vacancyTitle: string;
  score: number | null;
  verdict: CvVerdict | null;
  summary: string | null;
  breakdown: BreakdownItem[];
  model: string | null;
  promptVersion: number | null;
  scoredAt: string | null;
};

/** Latest real score per application of one candidate. */
export async function listCandidateScores(candidateId: string): Promise<CandidateScore[]> {
  await requireStaff();
  const supabase = await createClient();
  const [{ data: apps }, { data: scores }] = await Promise.all([
    supabase
      .from("applications")
      .select("id, vacancy_id, cv_score, cv_verdict, cv_scored_at, vacancy:vacancies(title)")
      .eq("candidate_id", candidateId)
      .order("created_at", { ascending: false }),
    supabase
      .from("cv_scores")
      .select("application_id, summary, breakdown, model, prompt_version, created_at")
      .eq("candidate_id", candidateId)
      .eq("purpose", "score")
      .order("created_at", { ascending: false })
      .limit(200),
  ]);
  const latest = new Map<string, NonNullable<typeof scores>[number]>();
  for (const s of scores ?? []) if (!latest.has(s.application_id)) latest.set(s.application_id, s);
  return (apps ?? []).map((a) => {
    const s = latest.get(a.id);
    return {
      applicationId: a.id,
      vacancyId: a.vacancy_id,
      vacancyTitle: a.vacancy?.title ?? "Vacancy",
      score: a.cv_score,
      verdict: a.cv_verdict,
      summary: s?.summary ?? null,
      breakdown: readBreakdown(s?.breakdown),
      model: s?.model ?? null,
      promptVersion: s?.prompt_version ?? null,
      scoredAt: a.cv_scored_at,
    };
  });
}

export async function getCandidateCvState(candidateId: string) {
  await requireStaff();
  const supabase = await createClient();
  const { data } = await supabase.from("candidates").select("cv_path, cv_text_status, cv_read_at, has_cv_text").eq("id", candidateId).maybeSingle();
  return data
    ? { hasFile: Boolean(data.cv_path), status: data.cv_text_status, readAt: data.cv_read_at, hasText: Boolean(data.has_cv_text) }
    : null;
}

export async function listScreeningPrompts() {
  await requireStaff();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("screening_prompts")
    .select("id, version, instructions, notes, is_active, created_at, activated_at, author:profiles!screening_prompts_created_by_fkey(full_name, email)")
    .order("version", { ascending: false });
  if (error) throw new Error(`Could not load the prompts: ${error.message}`);
  return data ?? [];
}

export type ComparisonRow = {
  applicationId: string;
  name: string;
  before: { score: number; verdict: CvVerdict; version: number } | null;
  after: { score: number; verdict: CvVerdict; version: number; model: string; at: string };
};

/** The latest comparison runs: compare scores next to the real score of the same application. */
export async function listComparisons(limit = 50): Promise<ComparisonRow[]> {
  await requireStaff();
  const supabase = await createClient();
  const { data: compares } = await supabase
    .from("cv_scores")
    .select("application_id, score, verdict, prompt_version, model, created_at, candidate:candidates(full_name)")
    .eq("purpose", "compare")
    .order("created_at", { ascending: false })
    .limit(limit);
  const ids = [...new Set((compares ?? []).map((c) => c.application_id))];
  if (ids.length === 0) return [];
  const { data: real } = await supabase
    .from("cv_scores")
    .select("application_id, score, verdict, prompt_version, created_at")
    .eq("purpose", "score")
    .in("application_id", ids)
    .order("created_at", { ascending: false });
  const latestReal = new Map<string, NonNullable<typeof real>[number]>();
  for (const r of real ?? []) if (!latestReal.has(r.application_id)) latestReal.set(r.application_id, r);
  return (compares ?? []).map((c) => {
    const r = latestReal.get(c.application_id);
    return {
      applicationId: c.application_id,
      name: c.candidate?.full_name ?? "Candidate",
      before: r ? { score: r.score, verdict: r.verdict, version: r.prompt_version } : null,
      after: { score: c.score, verdict: c.verdict, version: c.prompt_version, model: c.model, at: c.created_at },
    };
  });
}

/** Spend on CV scoring in the last 30 days, for the prompts page. */
export async function getScoringSpend() {
  await requireAdmin();
  const supabase = await createClient();
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const { data } = await supabase.from("cv_scores").select("cost_usd, model").gte("created_at", since).limit(20000);
  const rows = data ?? [];
  const byModel = new Map<string, { count: number; cost: number }>();
  for (const r of rows) {
    const m = byModel.get(r.model) ?? { count: 0, cost: 0 };
    m.count += 1;
    m.cost += Number(r.cost_usd ?? 0);
    byModel.set(r.model, m);
  }
  return { count: rows.length, byModel: [...byModel.entries()].map(([model, v]) => ({ model, ...v })) };
}

export type { ScreeningModel };
