// Pure helpers for the questionnaire and report pages and the PDF.
// Tested in tests/wsp.test.ts.

import {
  DEVELOPER_INTRO_SENTENCE,
  DIMENSION_TEXTS,
  ITEMS_PER_PAGE,
  VACANCY_SENTENCE,
  type Band,
  type Dimension,
  type DimensionText,
} from "./content";

export type PersonType = "candidate" | "developer";

export type ResultRow = { dimension: string; score: number; band: string; mean?: number | string | null };

export type ReportDimension = { text: DimensionText; score: number; band: Band };

function isBand(value: string): value is Band {
  return value === "lower" || value === "middle" || value === "higher";
}

/** The five blocks in report order (Openness, Conscientiousness, Extraversion, Agreeableness, Emotional stability). */
export function orderedDimensions(results: readonly ResultRow[]): ReportDimension[] {
  const out: ReportDimension[] = [];
  for (const text of DIMENSION_TEXTS) {
    const row = results.find((r) => r.dimension === text.dimension);
    if (!row || !isBand(row.band)) continue;
    out.push({ text, score: Math.max(0, Math.min(100, Math.round(row.score))), band: row.band });
  }
  return out;
}

export type QuestionItem = { id?: string; position: number; statement?: string; code?: string };

export function pageOfPosition(position: number): number {
  return Math.ceil(position / ITEMS_PER_PAGE);
}

export function pageItems<T extends QuestionItem>(items: readonly T[], page: number): T[] {
  return items.filter((item) => pageOfPosition(item.position) === page).sort((a, b) => a.position - b.position);
}

export function pageCount(items: readonly QuestionItem[]): number {
  return items.reduce((max, item) => Math.max(max, pageOfPosition(item.position)), 0);
}

/** The first page with a statement that has no answer, else the last page. */
export function firstOpenPage<T extends QuestionItem>(items: readonly T[], answered: (item: T) => boolean): number {
  const open = [...items].sort((a, b) => a.position - b.position).find((item) => !answered(item));
  return open ? pageOfPosition(open.position) : pageCount(items);
}

export function progressPercent(answered: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((Math.min(answered, total) / total) * 100);
}

/** The intro screen: developers get the extra sentence on top. */
export function introFor(personType: PersonType): { top: string | null } {
  return { top: personType === "developer" ? DEVELOPER_INTRO_SENTENCE : null };
}

/** The outward vacancy text with the fixed sentence when the profile is on. */
export function vacancyTextWithSentence(text: string | null | undefined, enabled: boolean): string {
  const base = (text ?? "").trim();
  if (!enabled) return base;
  return base ? `${base}\n\n${VACANCY_SENTENCE}` : VACANCY_SENTENCE;
}

export const DIMENSION_NAMES: Record<Dimension, string> = Object.fromEntries(
  DIMENSION_TEXTS.map((d) => [d.dimension, d.name]),
) as Record<Dimension, string>;

export const STATUS_LABELS: Record<string, string> = {
  invited: "Invited",
  started: "Started",
  completed: "Completed",
  expired: "Link expired",
  deleted: "Deleted",
};

export const REASON_LABELS: Record<string, string> = {
  trigger_stage: "Trigger stage",
  manual: "Sent by hand",
  placement_start: "Placement start",
};
