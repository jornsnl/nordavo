/**
 * Vacancy clock (feedback Julius round 3). Pure functions, shared by the
 * lists, the vacancy page, the overview and the tests.
 *
 * - On hold periods (vacancy_holds) do not count: days open and lead time
 *   leave them out.
 * - The flow deadline: when the whole flow should be done, the
 *   presentation deadline when set, otherwise opened plus three weeks
 *   (moved on by the days on hold).
 * - Start time: the desired start in India (IST) and the Dutch time in
 *   winter (CET) and summer (CEST).
 */

export type HoldPeriod = { started_on: string; ended_on: string | null };

const DAY_MS = 86_400_000;

/** Whole day number of a date or timestamp (UTC calendar day of its first 10 characters for date strings). */
export function dayNumber(value: string | Date): number {
  if (value instanceof Date) return Math.floor(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()) / DAY_MS);
  const date = /^\d{4}-\d{2}-\d{2}/.exec(value)?.[0];
  if (date && value.length <= 10) return Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY_MS);
  return dayNumber(new Date(value));
}

function isoFromDay(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Days on hold inside [from, to): each period counts from its start up to
 * its end (or `to` while still on hold), clipped to the window. Overlapping
 * periods are counted once.
 */
export function daysOnHold(holds: HoldPeriod[], from: string | Date, to: string | Date): number {
  const start = dayNumber(from);
  const end = dayNumber(to);
  if (end <= start) return 0;
  const ranges = holds
    .map((h) => [Math.max(start, dayNumber(h.started_on)), Math.min(end, h.ended_on ? dayNumber(h.ended_on) : end)] as const)
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  let total = 0;
  let cursor = start;
  for (const [a, b] of ranges) {
    const from2 = Math.max(a, cursor);
    if (b > from2) {
      total += b - from2;
      cursor = b;
    }
  }
  return total;
}

/** Days a vacancy has been open, up to closed_at when closed, without the days on hold. */
export function daysOpenWithoutHolds(
  v: { opened_at: string; closed_at: string | null },
  holds: HoldPeriod[] = [],
  now: Date = new Date(),
): number {
  const end = v.closed_at ?? now;
  const total = dayNumber(end) - dayNumber(v.opened_at);
  return Math.max(0, total - daysOnHold(holds, v.opened_at, end));
}

/** Total days on hold so far, and the open period (if any). */
export function holdSummary(holds: HoldPeriod[], now: Date = new Date()) {
  const open = holds.find((h) => !h.ended_on) ?? null;
  const total = holds.reduce((sum, h) => sum + Math.max(0, dayNumber(h.ended_on ?? now) - dayNumber(h.started_on)), 0);
  const current = open ? Math.max(0, dayNumber(now) - dayNumber(open.started_on)) : null;
  return { total, current, open };
}

export const FLOW_DAYS = 21;

/**
 * End date of the whole flow: the presentation deadline when set,
 * otherwise opened plus three weeks, moved on by the days on hold.
 * Null for talent pool vacancies (no clock).
 */
export function flowDeadline(
  v: { opened_at: string; presentation_deadline: string | null; is_talent_pool?: boolean },
  holds: HoldPeriod[] = [],
  now: Date = new Date(),
): { date: string; source: "deadline" | "three_weeks" } | null {
  if (v.is_talent_pool) return null;
  if (v.presentation_deadline) return { date: v.presentation_deadline.slice(0, 10), source: "deadline" };
  const held = daysOnHold(holds, v.opened_at, now);
  return { date: isoFromDay(dayNumber(v.opened_at) + FLOW_DAYS + held), source: "three_weeks" };
}

/** Whole days from today to a date (negative when past). */
export function daysUntil(date: string, now: Date = new Date()): number {
  return dayNumber(date) - dayNumber(now);
}

export type DeadlineLevel = "none" | "ok" | "soon" | "late" | "done";

/**
 * Signal for the presentation deadline: late when past and fewer than
 * three were presented, soon within three days.
 */
export function deadlineLevel(deadline: string | null, presented: number, now: Date = new Date(), target = 3): DeadlineLevel {
  if (!deadline) return "none";
  if (presented >= target) return "done";
  const left = daysUntil(deadline, now);
  if (left < 0) return "late";
  if (left <= 3) return "soon";
  return "ok";
}

// ---------------------------------------------------------------------------
// Start time: India (IST, UTC+5:30, no daylight saving) to the Netherlands
// ---------------------------------------------------------------------------

const IST_OFFSET = 330;
const CET_OFFSET = 60;
const CEST_OFFSET = 120;

/** "12:30" or "12:30:00" to minutes after midnight, or null. */
export function parseClock(value: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec((value ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export function formatClock(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** 12:30 IST is 08:00 in the Dutch winter and 09:00 in the summer. */
export function istToNl(ist: string | null | undefined): { ist: string; winter: string; summer: string } | null {
  const minutes = parseClock(ist);
  if (minutes === null) return null;
  const utc = minutes - IST_OFFSET;
  return { ist: formatClock(minutes), winter: formatClock(utc + CET_OFFSET), summer: formatClock(utc + CEST_OFFSET) };
}

/** Last Sunday of a month (UTC date). */
function lastSunday(year: number, month: number): number {
  const last = new Date(Date.UTC(year, month + 1, 0));
  return Date.UTC(year, month, last.getUTCDate() - last.getUTCDay(), 1);
}

/** Whether the Netherlands is on summer time at this moment (EU rule: last Sunday of March to last Sunday of October, 01:00 UTC). */
export function isDutchSummerTime(at: Date): boolean {
  const year = at.getUTCFullYear();
  const t = at.getTime();
  return t >= lastSunday(year, 2) && t < lastSunday(year, 9);
}

/** The Dutch start time on a given day. */
export function nlStartOn(ist: string | null | undefined, at: Date = new Date()): string | null {
  const times = istToNl(ist);
  if (!times) return null;
  return isDutchSummerTime(at) ? times.summer : times.winter;
}
