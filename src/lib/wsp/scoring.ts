// Scoring and quality checks of the Working Style Profile (part 2 of the
// assignment). Pure and rule based, no AI. The database scores with the same
// rules (wsp_private.score() and wsp_private.flags() in
// supabase/migrations/20261116000000_wsp_core.sql); tests/wsp.test.ts and
// supabase/tests/wsp.test.sql run the same test cases on both.

import { ITEMS, ITEMS_PER_PAGE, type Band, type Dimension, type Item } from "./content";

export const DIMENSIONS: readonly Dimension[] = ["E", "A", "C", "S", "O"];

/** Answers by item code (E1 ... O10, CHK1, CHK2), each 1 to 5. */
export type Answers = Record<string, number>;

export type DimensionResult = { dimension: Dimension; mean: number; score: number; band: Band };

/** Itemscore = antwoord (normal) of 6 min antwoord (reversed). */
export function itemScore(item: Item, answer: number): number {
  return item.key === "reversed" ? 6 - answer : answer;
}

/**
 * Score = afgerond((gemiddelde min 1) / 4 x 100). Computed in steps of a
 * millionth so that floating point never tips a half (3.6 gives 65, 3.64 gives 66).
 * Halves round up, as round() on a numeric does in Postgres.
 */
export function scoreFromMean(mean: number): number {
  const exact = Math.round((mean - 1) * 25 * 1_000_000) / 1_000_000;
  return Math.floor(exact + 0.5);
}

/** Band: 0 t/m 34 Lower side, 35 t/m 65 Middle, 66 t/m 100 Higher side. */
export function bandFor(score: number): Band {
  if (score <= 34) return "lower";
  if (score <= 65) return "middle";
  return "higher";
}

function isAnswer(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5;
}

/** Per dimensie: the mean of its 10 item scores, the 0 to 100 score and the band. Control statements do not count. */
export function scoreAnswers(answers: Answers, items: readonly Item[] = ITEMS): DimensionResult[] {
  return DIMENSIONS.map((dimension) => {
    const scored = items.filter((item) => item.dimension === dimension);
    let sum = 0;
    for (const item of scored) {
      const answer = answers[item.code];
      if (!isAnswer(answer)) throw new Error(`Statement ${item.code} has no answer.`);
      sum += itemScore(item, answer);
    }
    const mean = Math.round((sum / scored.length) * 100) / 100;
    const score = scoreFromMean(sum / scored.length);
    return { dimension, mean, score, band: bandFor(score) };
  });
}

// ---------------------------------------------------------------------------
// Kwaliteitschecks (staff only)
// ---------------------------------------------------------------------------

export type FlagType = "attention_check_failed" | "too_fast" | "straightlining" | "yes_saying";

export type Flag = { type: FlagType; details: Record<string, number | string | null> };

export const TOO_FAST_SECONDS = 2;
export const SLOW_PAGE_MS = 10 * 60 * 1000;
export const STRAIGHTLINE_RUN = 12;
export const YES_SAYING_MEAN = 4.2;

/** Time per page in milliseconds, by page number (1 to 6). */
export type PageTimes = Record<number, number>;

export function pageOf(position: number): number {
  return Math.ceil(position / ITEMS_PER_PAGE);
}

export function itemsOnPage(page: number, items: readonly Item[] = ITEMS): Item[] {
  return items.filter((item) => pageOf(item.position) === page);
}

/** The longest run of the same answer, over all 52 statements in their fixed order. */
export function longestRun(answers: Answers, items: readonly Item[] = ITEMS): { length: number; answer: number | null } {
  let best = { length: 0, answer: null as number | null };
  let current = 0;
  let previous: number | null = null;
  for (const item of [...items].sort((a, b) => a.position - b.position)) {
    const answer = answers[item.code];
    if (!isAnswer(answer)) {
      current = 0;
      previous = null;
      continue;
    }
    current = answer === previous ? current + 1 : 1;
    previous = answer;
    if (current > best.length) best = { length: current, answer };
  }
  return best;
}

/**
 * Seconds per statement, averaged over the pages: per page its time divided
 * by the number of statements on that page; pages longer than 10 minutes do
 * not count. Null when no page counts.
 */
export function secondsPerStatement(pageTimes: PageTimes, items: readonly Item[] = ITEMS): number | null {
  const perPage: number[] = [];
  const pages = [...new Set(items.map((item) => pageOf(item.position)))];
  for (const page of pages) {
    const ms = pageTimes[page];
    if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0 || ms > SLOW_PAGE_MS) continue;
    perPage.push(ms / 1000 / itemsOnPage(page, items).length);
  }
  if (perPage.length === 0) return null;
  return Math.round((perPage.reduce((a, b) => a + b, 0) / perPage.length) * 100) / 100;
}

/** The quality flags of a finished questionnaire. The report is made in every case. */
export function qualityFlags(answers: Answers, pageTimes: PageTimes, items: readonly Item[] = ITEMS): Flag[] {
  const flags: Flag[] = [];

  const checks = items.filter((item) => item.dimension === "check");
  const failed = checks.filter((item) => answers[item.code] !== item.expected);
  if (failed.length > 0) {
    flags.push({
      type: "attention_check_failed",
      details: Object.fromEntries(failed.map((item) => [item.code, answers[item.code] ?? null])),
    });
  }

  const seconds = secondsPerStatement(pageTimes, items);
  if (seconds !== null && seconds < TOO_FAST_SECONDS) {
    flags.push({ type: "too_fast", details: { seconds_per_statement: seconds } });
  }

  const run = longestRun(answers, items);
  if (run.length >= STRAIGHTLINE_RUN) {
    flags.push({ type: "straightlining", details: { run: run.length, answer: run.answer } });
  }

  const scored = items.filter((item) => item.dimension !== "check");
  const raw = scored.map((item) => answers[item.code]).filter(isAnswer);
  if (raw.length === scored.length) {
    const mean = Math.round((raw.reduce((a, b) => a + b, 0) / raw.length) * 100) / 100;
    if (mean >= YES_SAYING_MEAN) flags.push({ type: "yes_saying", details: { mean_answer: mean } });
  }

  return flags;
}

/** The reason shown with "Interpret with caution" (staff only). */
export function flagReason(flag: { type: string; details?: unknown }): string {
  const d = (flag.details && typeof flag.details === "object" ? flag.details : {}) as Record<string, unknown>;
  switch (flag.type) {
    case "attention_check_failed": {
      const parts = Object.entries(d).map(([code, value]) => `${code} answered ${value ?? "nothing"}`);
      return `A control statement was not answered as asked (CHK1 should be 4, CHK2 should be 1)${parts.length ? `: ${parts.join(", ")}` : ""}.`;
    }
    case "too_fast":
      return `Answered very fast: on average ${d.seconds_per_statement ?? "under 2"} seconds per statement (less than 2).`;
    case "straightlining":
      return `The same answer ${d.run ?? "12 or more"} times in a row.`;
    case "yes_saying":
      return `Agreed with almost everything: the average answer is ${d.mean_answer ?? "4.2 or higher"} (4.2 or higher).`;
    default:
      return flag.type;
  }
}
