// Calendar days (YYYY-MM-DD) for the calendar and timeline of Work, after
// src/lib/dates.ts and src/lib/schedule.ts of Athmium. Days are counted in
// UTC so the browser's own zone never shifts them; which day "today" is and
// which day a deadline falls on come from the viewer's time zone (time.ts).

import { dayIn, localInputToUtc, utcToLocalInput } from "@/lib/work/time";

const DAY_MS = 86_400_000;

function utc(day: string): number {
  return Date.parse(`${day}T00:00:00Z`);
}

export function addDays(day: string, days: number): string {
  return new Date(utc(day) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from `a` to `b` (negative when `b` is earlier). */
export function diffDays(a: string, b: string): number {
  return Math.round((utc(b) - utc(a)) / DAY_MS);
}

/** 0 = Sunday ... 6 = Saturday. */
export function weekday(day: string): number {
  return new Date(utc(day)).getUTCDay();
}

/** Monday of the week the day falls in. */
export function startOfWeek(day: string): string {
  return addDays(day, -((weekday(day) + 6) % 7));
}

export function isWeekend(day: string): boolean {
  const d = weekday(day);
  return d === 0 || d === 6;
}

export function dayOfMonth(day: string): number {
  return Number(day.slice(8, 10));
}

export function firstOfMonth(day: string, offset = 0): string {
  const [y, m] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + offset, 1)).toISOString().slice(0, 10);
}

export function lastOfMonth(day: string): string {
  return addDays(firstOfMonth(day, 1), -1);
}

/** "November 2026", "3 Nov", ... for a day, without the zone moving it. */
export function formatDay(day: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-GB", { ...options, timeZone: "UTC" }).format(new Date(utc(day)));
}

/** The deadline moved to another day, at the same time of day in the viewer's zone (17:00 stays 17:00). */
export function moveDeadline(dueAt: string, toDay: string, timeZone: string): string | null {
  const time = utcToLocalInput(dueAt, timeZone).slice(11, 16) || "17:00";
  return localInputToUtc(`${toDay}T${time}`, timeZone);
}

/** A new deadline on a day that had none: 17:00 in the viewer's zone, like the record tasks. */
export function deadlineOn(day: string, timeZone: string): string | null {
  return localInputToUtc(`${day}T17:00`, timeZone);
}

export type Scheduled = { startOn: string | null; dueAt: string | null; estimateMinutes: number | null };

/** Working hours in a day, to turn an estimate into a number of days when a task has only one date. */
export const HOURS_PER_DAY = 8;

/** `n` working days after (or before, when negative) `day`, skipping weekends. */
function addWorkdays(day: string, n: number): string {
  const step = n < 0 ? -1 : 1;
  let d = day;
  for (let left = Math.abs(n); left > 0; ) {
    d = addDays(d, step);
    if (!isWeekend(d)) left--;
  }
  return d;
}

/**
 * The days a task's bar covers on the timeline. With a start date and a
 * deadline that is start to deadline. With one of them, the estimate fills in
 * the other (in working days of HOURS_PER_DAY), marked as `derived`.
 */
export function timelineSpan(
  item: Scheduled,
  timeZone: string,
): { from: string; to: string; derived: "start" | "due" | null } | null {
  const start = item.startOn;
  const due = item.dueAt ? dayIn(item.dueAt, timeZone) : null;
  if (start && due) return { from: start, to: due < start ? start : due, derived: null };
  if (!start && !due) return null;
  const days = Math.max(1, Math.ceil((item.estimateMinutes ?? 0) / 60 / HOURS_PER_DAY));
  if (due) {
    const from = addWorkdays(due, -(days - 1));
    return { from, to: due, derived: from === due ? null : "start" };
  }
  const to = addWorkdays(start!, days - 1);
  return { from: start!, to, derived: to === start ? null : "due" };
}
