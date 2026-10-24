import type { PoolCandidate } from "@/lib/integrations/airtable";
import { foldText, redactIdentifiers } from "@/lib/talent/anonymize";

/**
 * T2 step one: a cheap prefilter in code (stack overlap and seniority), so
 * Claude only scores the most promising candidates. Pure, unit tested.
 */

export type VacancyRequirements = {
  title: string;
  stack: string[];
  seniority: string;
  hours: number | null;
  timezone_overlap: string | null;
  budget_min: number | null;
  budget_max: number | null;
  client_contact_required: boolean | null;
  must_haves: string[];
  nice_to_haves: string[];
};

const ALIASES: Record<string, string> = {
  js: "javascript",
  ts: "typescript",
  "node.js": "node",
  nodejs: "node",
  "react.js": "react",
  reactjs: "react",
  "next.js": "nextjs",
  "vue.js": "vue",
  vuejs: "vue",
  postgres: "postgresql",
  psql: "postgresql",
  golang: "go",
  "c sharp": "c#",
  csharp: "c#",
  ".net core": ".net",
  dotnet: ".net",
  "asp.net": ".net",
  k8s: "kubernetes",
  "power bi": "powerbi",
  "ms sql": "sql server",
  mssql: "sql server",
  "amazon web services": "aws",
  gcp: "google cloud",
  "ml": "machine learning",
  py: "python",
};

/** "Node.js " -> "node", "Postgres" -> "postgresql". */
export function normalizeSkill(skill: string) {
  const folded = foldText(skill).replace(/\s*\(.*?\)\s*/g, " ").trim();
  return ALIASES[folded] ?? folded;
}

/** Skills a candidate has that match the wanted list (also found in summary text). */
export function skillOverlap(wanted: string[], candidate: Pick<PoolCandidate, "skills" | "summary" | "cvText">) {
  const have = new Set(candidate.skills.map(normalizeSkill));
  const text = foldText(`${candidate.summary ?? ""} ${candidate.cvText ?? ""}`);
  const hits: string[] = [];
  for (const skill of wanted) {
    const norm = normalizeSkill(skill);
    if (!norm) continue;
    const escaped = norm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const inText = norm.length >= 2 && new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9#+])`).test(text);
    if (have.has(norm) || inText) hits.push(skill);
  }
  return hits;
}

/** Candidate level from the seniority field, or years of experience as fallback. */
export function candidateLevel(c: Pick<PoolCandidate, "seniority" | "yearsExperience">): "junior" | "medior" | "senior" | null {
  const s = c.seniority ? foldText(c.seniority) : "";
  if (/junior|trainee|intern|stagiair/.test(s)) return "junior";
  if (/senior|lead|principal|staff|architect/.test(s)) return "senior";
  if (/medior|mid/.test(s)) return "medior";
  if (c.yearsExperience === null) return null;
  if (c.yearsExperience >= 5) return "senior";
  if (c.yearsExperience >= 2) return "medior";
  return "junior";
}

/** Nordavo only places mediors and seniors. A senior vacancy accepts strong mediors (4+ years) for review. */
export function seniorityFits(vacancySeniority: string, c: Pick<PoolCandidate, "seniority" | "yearsExperience">) {
  const level = candidateLevel(c);
  if (level === null) return true; // unknown: let Claude judge
  if (level === "junior") return false;
  if (vacancySeniority === "medior") return true;
  if (level === "senior") return true;
  return (c.yearsExperience ?? 0) >= 4;
}

export type PrefilterResult = { candidate: PoolCandidate; points: number; hits: string[] };

/**
 * Rank candidates for scoring: drop juniors and candidates without any stack
 * or must have overlap (when the vacancy has a stack), then sort by overlap.
 */
export function prefilterCandidates(vacancy: VacancyRequirements, candidates: PoolCandidate[], limit = 25): PrefilterResult[] {
  const wanted = [...new Set([...vacancy.stack, ...vacancy.must_haves.filter((m) => m.split(/\s+/).length <= 3)])];
  const results: PrefilterResult[] = [];
  for (const candidate of candidates) {
    if (!seniorityFits(vacancy.seniority, candidate)) continue;
    const stackHits = skillOverlap(vacancy.stack, candidate);
    const allHits = skillOverlap(wanted, candidate);
    if (vacancy.stack.length > 0 && allHits.length === 0) continue;
    const level = candidateLevel(candidate);
    const points =
      stackHits.length * 10 +
      (allHits.length - stackHits.length) * 4 +
      (level === vacancy.seniority || (vacancy.seniority === "lead" && level === "senior") ? 5 : 0) +
      Math.min(candidate.yearsExperience ?? 0, 10);
    results.push({ candidate, points, hits: allHits });
  }
  return results.sort((a, b) => b.points - a.points).slice(0, Math.max(0, limit));
}

/**
 * What Claude may see for judgement: skills, experience, project types,
 * seniority, English level and availability. No name, email, phone or
 * employers; free text is redacted and shortened.
 */
export function judgementPayload(candidate: PoolCandidate, ref: string, maxSummary = 1500) {
  const ids = {
    nameParts: candidate.nameParts,
    email: candidate.email,
    phone: candidate.phone,
    employers: candidate.employers,
    skills: candidate.skills,
  };
  const summary = candidate.summary ?? candidate.cvText;
  return {
    ref,
    skills: candidate.skills,
    years_experience: candidate.yearsExperience,
    seniority: candidate.seniority,
    current_role: candidate.currentTitle ? redactIdentifiers(candidate.currentTitle, ids) : null,
    project_types: candidate.projectTypes,
    sectors: candidate.sectors,
    english_level: candidate.englishLevel,
    availability: candidate.availability,
    experience_summary: summary ? redactIdentifiers(summary, ids).slice(0, maxSummary) : null,
  };
}

export function requirementsPayload(v: VacancyRequirements) {
  return {
    title: v.title,
    stack: v.stack,
    seniority: v.seniority,
    hours_per_week: v.hours,
    timezone_overlap: v.timezone_overlap,
    budget_eur_per_month: v.budget_min || v.budget_max ? { min: v.budget_min, max: v.budget_max } : null,
    client_contact_required: v.client_contact_required,
    must_haves: v.must_haves,
    nice_to_haves: v.nice_to_haves,
  };
}

/** Keep a score inside 0 to 100 as an integer. */
export function clampScore(score: number) {
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Which scored candidates to store: always the top 3, plus everyone at or
 * above `keepAbove` (when set), capped at `max`.
 */
export function selectMatchesToStore<T extends { score: number }>(scored: T[], { keepAbove = 50, max = 10 }: { keepAbove?: number | null; max?: number } = {}) {
  const sorted = [...scored].sort((a, b) => b.score - a.score);
  return sorted.filter((s, i) => i < 3 || (keepAbove !== null && s.score >= keepAbove)).slice(0, Math.max(3, max));
}

/** T3 trigger: fewer than 3 matches with a score of 70 or higher. */
export function needsSearchBrief(scores: number[], threshold = 70) {
  return scores.filter((s) => s >= threshold).length < 3;
}

/** Keep at most two sentences (the briefing's limit for a match reason). */
export function twoSentences(text: string) {
  const sentences = text.trim().match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) ?? [];
  return sentences.slice(0, 2).join("").trim() || text.trim();
}
