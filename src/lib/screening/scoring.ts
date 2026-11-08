import type { CvVerdict, RequirementKind, ScreeningModel } from "@/lib/database.types";
import type { CvScoreOutput, ScoringRequirement } from "@/lib/ai/prompts/screening";

/**
 * CV against JD scoring (recruitment brief 2.11), the parts that must go
 * the same every time: which requirements a vacancy has, how Claude's
 * answer becomes a stored score (must have misses cap the score), the
 * verdict and the cost. Pure, unit tested.
 */

export const SCREENING_MODELS: { value: ScreeningModel; label: string; hint: string }[] = [
  { value: "claude-haiku-5-5", label: "Haiku 5.5", hint: "Cheapest, for a first pass over many CVs" },
  { value: "claude-sonnet-5-5", label: "Sonnet 5.5", hint: "Good balance of cost and judgement" },
  { value: "claude-opus-5-5", label: "Opus 5.5", hint: "Best judgement, the default" },
];

export const DEFAULT_SCREENING_MODEL: ScreeningModel = "claude-opus-5-5";

export function isScreeningModel(value: unknown): value is ScreeningModel {
  return SCREENING_MODELS.some((m) => m.value === value);
}

/** USD per million tokens (Anthropic list prices, November 2026). Cache writes at 1.25x input. */
const PRICES: Record<ScreeningModel, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
};

export type TokenUsage = { model: string; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };

/** Cost of one call in USD, or null for an unknown model. */
export function costUsd(usage: TokenUsage): number | null {
  const key = (Object.keys(PRICES) as ScreeningModel[]).find((m) => usage.model.startsWith(m));
  if (!key) return null;
  const p = PRICES[key];
  const cost =
    (usage.inputTokens * p.input + usage.outputTokens * p.output + usage.cacheReadTokens * p.cacheRead + usage.cacheWriteTokens * p.cacheWrite) /
    1_000_000;
  return Math.round(cost * 1_000_000) / 1_000_000;
}

/** Effort per model: low for the cheap bulk pass, medium otherwise. */
export function effortFor(model: ScreeningModel, bulk: boolean): "low" | "medium" {
  return bulk || model === "claude-haiku-5-5" ? "low" : "medium";
}

// ---------------------------------------------------------------------------
// Requirements
// ---------------------------------------------------------------------------

export type RequirementRow = { label: string; kind: RequirementKind; alternatives: string[]; position: number };

function clean(items: string[]) {
  const seen = new Set<string>();
  return items
    .map((i) => i.trim())
    .filter((i) => {
      const key = i.toLowerCase();
      if (!i || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/**
 * The requirements a vacancy is scored on: the structured rows when there
 * are any; otherwise derived from the vacancy (must haves cannot be missing,
 * stack skills not named in a must have allow an alternative, nice to haves).
 */
export function scoringRequirements(
  vacancy: { stack: string[]; must_haves: string[]; nice_to_haves: string[] },
  rows: RequirementRow[] = [],
): ScoringRequirement[] {
  if (rows.length > 0) {
    return [...rows]
      .sort((a, b) => a.position - b.position)
      .map((r) => ({ label: r.label.trim(), kind: r.kind, alternatives: clean(r.alternatives) }))
      .filter((r) => r.label);
  }
  const must = clean(vacancy.must_haves);
  const mustText = must.join(" ").toLowerCase();
  const stack = clean(vacancy.stack).filter((s) => !mustText.includes(s.toLowerCase()));
  const nice = clean(vacancy.nice_to_haves);
  return [
    ...must.map((label) => ({ label, kind: "must_have" as const, alternatives: [] })),
    ...stack.map((label) => ({ label, kind: "alternative" as const, alternatives: [] })),
    ...nice.map((label) => ({ label, kind: "nice_to_have" as const, alternatives: [] })),
  ];
}

// ---------------------------------------------------------------------------
// Turning Claude's answer into a stored score
// ---------------------------------------------------------------------------

export type BreakdownItem = {
  label: string;
  kind: RequirementKind;
  status: "met" | "alternative" | "missing";
  evidence: string;
};

export type NormalizedScore = {
  score: number;
  verdict: CvVerdict;
  summary: string;
  breakdown: BreakdownItem[];
  mustHaveMissing: number;
};

/** Highest score with a missing must have. */
export const MUST_HAVE_CAP = 49;

export function verdictFor(score: number, mustHaveMissing: number): CvVerdict {
  if (mustHaveMissing > 0) return "no_fit";
  if (score >= 70) return "fit";
  if (score >= 50) return "maybe";
  return "no_fit";
}

function key(label: string) {
  return label.toLowerCase().replace(/[^a-z0-9#+]+/g, " ").trim();
}

/**
 * Match Claude's per requirement answer back to the vacancy's requirements
 * (by label, then by position), treat a must have met only through an
 * alternative as missing, cap the score when a must have is missing and set
 * the verdict from the score. A requirement Claude skipped counts as missing.
 */
export function normalizeScore(raw: CvScoreOutput, requirements: ScoringRequirement[]): NormalizedScore {
  const answers = raw.requirements;
  const byLabel = new Map(answers.map((a) => [key(a.label), a]));
  const breakdown: BreakdownItem[] = requirements.map((req, i) => {
    const answer = byLabel.get(key(req.label)) ?? (answers.length === requirements.length ? answers[i] : undefined);
    let status = answer?.status ?? "missing";
    let evidence = (answer?.evidence ?? "").trim().slice(0, 500) || (answer ? "" : "Not assessed by the model.");
    if (status === "alternative" && req.kind === "must_have") {
      status = "missing";
      evidence = `Only an alternative, and this is a must have. ${evidence}`.trim();
    }
    return { label: req.label, kind: req.kind, status, evidence };
  });
  const mustHaveMissing = breakdown.filter((b) => b.kind === "must_have" && b.status === "missing").length;
  let score = Number.isFinite(raw.match_percentage) ? Math.round(raw.match_percentage) : 0;
  score = Math.max(0, Math.min(100, score));
  if (mustHaveMissing > 0) score = Math.min(score, MUST_HAVE_CAP);
  return {
    score,
    verdict: verdictFor(score, mustHaveMissing),
    summary: raw.summary.replace(/\s+/g, " ").trim().slice(0, 2000),
    breakdown,
    mustHaveMissing,
  };
}

/** Read a stored breakdown back, tolerating older or partial JSON. */
export function readBreakdown(value: unknown): BreakdownItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((v) => {
    if (!v || typeof v !== "object") return [];
    const o = v as Record<string, unknown>;
    if (typeof o.label !== "string") return [];
    const status = o.status === "met" || o.status === "alternative" ? o.status : "missing";
    const kind = o.kind === "alternative" || o.kind === "nice_to_have" ? o.kind : "must_have";
    return [{ label: o.label, kind, status, evidence: typeof o.evidence === "string" ? o.evidence : "" }];
  });
}

/** Ranking order: score high to low, unscored last, then the oldest application first. */
export function rankApplications<T extends { cv_score: number | null; created_at: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    if (a.cv_score === null && b.cv_score !== null) return 1;
    if (b.cv_score === null && a.cv_score !== null) return -1;
    if (a.cv_score !== b.cv_score) return (b.cv_score ?? 0) - (a.cv_score ?? 0);
    return a.created_at.localeCompare(b.created_at);
  });
}

/** Comparison of two prompt versions on the same CVs. */
export function compareScores(
  pairs: { before: number | null; after: number; beforeVerdict?: CvVerdict | null; afterVerdict?: CvVerdict }[],
) {
  const both = pairs.filter((p) => p.before !== null);
  const deltas = both.map((p) => p.after - (p.before ?? 0));
  const mean = (xs: number[]) => (xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10 : 0);
  return {
    compared: both.length,
    meanDelta: mean(deltas),
    meanAbsDelta: mean(deltas.map(Math.abs)),
    verdictChanges: both.filter(
      (p) => (p.beforeVerdict ?? verdictFor(p.before ?? 0, 0)) !== (p.afterVerdict ?? verdictFor(p.after, 0)),
    ).length,
  };
}

/** Lines of a textarea ("Python, Go" or one per line) to a list. */
export function linesToList(value: string | undefined | null) {
  return clean((value ?? "").split(/[\n,]/));
}
