// Score, segment and signal points of the leadregels (20 November 2026,
// docs/leadregels.md). The database computes and stores the score
// (supabase/migrations/20261126000000_leadregels.sql); this module mirrors
// the rules for what the screens and the MCP show. Pure, safe everywhere;
// tested in tests/leadregels.test.ts.

import { isDevDataTitle } from "@/lib/sales/follow";
import { amsterdamToday, onlineSince } from "@/lib/sales/vacancies";

export type Segment = "A" | "B";

export const segments: { value: Segment; label: string; base: number; description: string }[] = [
  { value: "A", label: "A", base: 50, description: "SaaS en softwarebedrijven met een eigen product, in elke sector. Basis 50 punten." },
  {
    value: "B",
    label: "B",
    base: 30,
    description: "Elk ander ICP bedrijf met een eigen IT of data team, plus software en automation agencies. Basis 30 punten.",
  },
];

/** One row of the points table (Settings, Sales lists). */
export type SignalPoint = {
  type: string;
  label: string;
  description: string | null;
  points: number;
  active: boolean;
  derived: boolean;
  valid_days: number | null;
  position: number;
};

/** One part of a score: the segment base or a signal type, as sales_score_parts() returns it. */
export type ScorePart = { type: string; label: string; points: number };
export type ScoreBreakdown = { segment: Segment; parts: ScorePart[]; total: number };

export type ScoreGroupKey = "90_100" | "80_89" | "60_79" | "50_59" | "lt_50";

export const scoreGroups: { value: ScoreGroupKey; label: string; min: number; max: number; tone: "success" | "brand" | "accent" | "warning" | "neutral" }[] = [
  { value: "90_100", label: "90 tot 100", min: 90, max: 100, tone: "success" },
  { value: "80_89", label: "80 tot 89", min: 80, max: 89, tone: "brand" },
  { value: "60_79", label: "60 tot 79", min: 60, max: 79, tone: "accent" },
  { value: "50_59", label: "50 tot 59", min: 50, max: 59, tone: "warning" },
  { value: "lt_50", label: "Onder 50", min: 0, max: 49, tone: "neutral" },
];

/** The score group of a score; null without score. Mirrors public.sales_score_group(). */
export function scoreGroup(score: number | null | undefined): ScoreGroupKey | null {
  if (score == null || !Number.isFinite(score)) return null;
  if (score >= 90) return "90_100";
  if (score >= 80) return "80_89";
  if (score >= 60) return "60_79";
  if (score >= 50) return "50_59";
  return "lt_50";
}

/** "A 50 + vacature 30 + meerdere vacatures 10 = 90". */
export function formatScore(breakdown: ScoreBreakdown | null | undefined): string | null {
  if (!breakdown || breakdown.parts.length === 0) return null;
  const parts = breakdown.parts.map((p, i) => {
    const label = i === 0 && p.type === "segment" ? p.label : p.label.toLowerCase();
    const points = Math.abs(p.points);
    return i === 0 ? `${label} ${points}` : `${p.points < 0 ? "-" : "+"} ${label} ${points}`;
  });
  return `${parts.join(" ")} = ${breakdown.total}`;
}

/** Reads the JSON of sales_company_score() defensively. */
export function parseScore(raw: unknown): ScoreBreakdown | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.segment !== "A" && r.segment !== "B") return null;
  const parts = Array.isArray(r.parts)
    ? r.parts.flatMap((p) => {
        if (!p || typeof p !== "object") return [];
        const q = p as Record<string, unknown>;
        return typeof q.type === "string" && typeof q.label === "string" && typeof q.points === "number"
          ? [{ type: q.type, label: q.label, points: q.points }]
          : [];
      })
    : [];
  return { segment: r.segment, parts, total: typeof r.total === "number" ? r.total : 0 };
}

// ---------------------------------------------------------------------------
// Signals
// ---------------------------------------------------------------------------

const EVERGREEN_TITLE = /(open (sollicitatie|application)|talent ?pool|always hiring|altijd op zoek|general application|algemene sollicitatie)/i;
export const EVERGREEN_DAYS = 180;
export const LONG_OPEN_DAYS = 60;

function dayNumber(day: string): number {
  return Math.round(Date.parse(`${day.slice(0, 10)}T00:00:00Z`) / 86_400_000);
}

/** Evergreen: open longer than 180 days, or a title like open sollicitatie, talent pool or always hiring. */
export function isEvergreen(title: string | null | undefined, since: string | null | undefined, today: string): boolean {
  if (title && EVERGREEN_TITLE.test(title)) return true;
  return Boolean(since) && dayNumber(since as string) < dayNumber(today) - EVERGREEN_DAYS;
}

/** A dev or data vacancy: a dev or data title, or a role group that is not sales or service. Mirrors public.sales_is_dev_data_vacancy(). */
export function isDevDataVacancy(title: string | null | undefined, roleGroup: string | null | undefined): boolean {
  if (/^(sales|service|projecten)\b/i.test(roleGroup ?? "")) return false;
  return isDevDataTitle(title) || Boolean(roleGroup?.trim());
}

export type ScoredSignalInput = {
  type: string;
  title: string | null;
  role_group?: string | null;
  posted_at: string | null;
  first_seen_at: string | null;
  closed_at?: string | null;
  valid_until?: string | null;
};

export type SignalState = {
  /** Online since (vacancies) or the day of the signal. */
  date: string | null;
  /** Open and not past its valid until date. */
  active: boolean;
  /** A vacancy that does not count: open over 180 days or an open application. */
  evergreen: boolean;
  /** Counts for the score now. */
  counts: boolean;
  /** The points of its type when that type is switched on, else null. */
  points: number | null;
};

/** What one signal means for the score today. */
export function signalState(signal: ScoredSignalInput, points: SignalPoint[], today = amsterdamToday()): SignalState {
  const date = onlineSince(signal);
  const active = !signal.closed_at && (!signal.valid_until || signal.valid_until.slice(0, 10) >= today);
  const isVacancy = signal.type === "vacature";
  const evergreen = isVacancy && isEvergreen(signal.title, date, today);
  const row = points.find((p) => p.type === signal.type);
  const counts = isVacancy
    ? active && !evergreen && isDevDataVacancy(signal.title, signal.role_group) && Boolean(row?.active)
    : active && Boolean(row?.active) && !row?.derived;
  return { date, active, evergreen, counts, points: row?.active ? row.points : null };
}

/**
 * The score as the database computes it, from the segment, the signals and
 * the points table. Used by tests and as a fallback; the stored icp_score is
 * the truth.
 */
export function computeScore(
  segment: Segment | null | undefined,
  signals: ScoredSignalInput[],
  points: SignalPoint[],
  today = amsterdamToday(),
): ScoreBreakdown | null {
  if (!segment) return null;
  const base = segments.find((s) => s.value === segment)?.base ?? 0;
  const parts: ScorePart[] = [{ type: "segment", label: segment, points: base }];
  const vacancies = signals.filter((s) => {
    if (s.type !== "vacature") return false;
    const st = signalState(s, [{ type: "vacature", label: "", description: null, points: 0, active: true, derived: true, valid_days: null, position: 0 }], today);
    return st.counts;
  });
  const longOpen = vacancies.some((v) => {
    const d = onlineSince(v);
    return d != null && dayNumber(d) <= dayNumber(today) - LONG_OPEN_DAYS;
  });
  for (const p of [...points].filter((x) => x.active).sort((a, b) => a.position - b.position || a.type.localeCompare(b.type))) {
    const hit =
      (p.type === "vacature" && vacancies.length >= 1) ||
      (p.type === "meerdere_rollen" && vacancies.length >= 2) ||
      (p.type === "lang_open" && longOpen) ||
      (!p.derived && signals.some((s) => s.type === p.type && !s.closed_at && (!s.valid_until || s.valid_until.slice(0, 10) >= today)));
    if (hit) parts.push({ type: p.type, label: p.label, points: p.points });
  }
  const total = Math.max(0, Math.min(100, parts.reduce((sum, p) => sum + p.points, 0)));
  return { segment, parts, total };
}
