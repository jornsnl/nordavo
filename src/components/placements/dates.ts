/**
 * Date helpers for date-only values (YYYY-MM-DD), safe on server and client.
 * All maths happens in UTC so a date never shifts by a day.
 */

function parse(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function toIso(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number) {
  const date = parse(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return toIso(date);
}

/** Adds months, clamping to the last day (31 jan + 1 month = 28 feb). */
export function addMonths(iso: string, months: number) {
  const date = parse(iso);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return toIso(date);
}

/** Whole days from a to b (b minus a). */
export function diffDays(a: string, b: string) {
  return Math.round((parse(b).getTime() - parse(a).getTime()) / 86_400_000);
}

/** Whole months from start to end, never negative. */
export function monthsBetween(start: string, end: string) {
  const s = parse(start);
  const e = parse(end);
  let months =
    (e.getUTCFullYear() - s.getUTCFullYear()) * 12 + (e.getUTCMonth() - s.getUTCMonth());
  if (e.getUTCDate() < s.getUTCDate()) months -= 1;
  return Math.max(0, months);
}

const shortFormatter = new Intl.DateTimeFormat("nl-NL", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

/** "12 nov", without the year. */
export function formatShortDate(iso: string) {
  return shortFormatter.format(parse(iso)).replace(/\.$/, "");
}
