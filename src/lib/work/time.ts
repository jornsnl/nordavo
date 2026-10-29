// Deadlines are stored in UTC and shown in the viewer's time zone (Netherlands,
// Bangalore, freelancers anywhere). No date library: Intl does the zone math.

export const DEFAULT_TIME_ZONE = "Europe/Amsterdam";

/** A short list for the settings picker; any valid IANA zone is accepted. */
export const commonTimeZones = [
  "Europe/Amsterdam",
  "Europe/London",
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Singapore",
  "America/New_York",
  "America/Los_Angeles",
  "UTC",
];

export function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export function safeTimeZone(zone: string | null | undefined): string {
  return zone && isValidTimeZone(zone) ? zone : DEFAULT_TIME_ZONE;
}

type Parts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function partsIn(date: Date, timeZone: string): Parts {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second") };
}

/** Offset of a zone from UTC at a moment, in milliseconds. */
function offsetAt(date: Date, timeZone: string): number {
  const p = partsIn(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/**
 * "2026-11-03T17:00" (wall clock in timeZone, as a datetime-local input gives
 * it) to an ISO string in UTC. Null for empty or invalid input.
 */
export function localInputToUtc(value: string | null | undefined, timeZone: string): string | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(value.trim());
  if (!match) return null;
  const [, y, mo, d, h = "23", mi = h === "23" ? "59" : "00"] = match;
  const wall = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi));
  if (Number.isNaN(wall)) return null;
  // Two passes settle the offset around daylight saving changes.
  let guess = wall - offsetAt(new Date(wall), timeZone);
  guess = wall - offsetAt(new Date(guess), timeZone);
  return new Date(guess).toISOString();
}

/** UTC ISO string to "2026-11-03T17:00" in timeZone, for a datetime-local input. */
export function utcToLocalInput(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return "";
  const p = partsIn(new Date(iso), timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** Calendar day (YYYY-MM-DD) of a moment in timeZone. */
export function dayIn(date: Date | string, timeZone: string): string {
  const p = partsIn(typeof date === "string" ? new Date(date) : date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export type DueState = "none" | "overdue" | "today" | "tomorrow" | "later";

export function dueState(dueAt: string | null | undefined, timeZone: string, now: Date = new Date()): DueState {
  if (!dueAt) return "none";
  const due = new Date(dueAt);
  if (due.getTime() < now.getTime()) return "overdue";
  const today = dayIn(now, timeZone);
  const day = dayIn(due, timeZone);
  if (day === today) return "today";
  if (day === addDays(today, 1)) return "tomorrow";
  return "later";
}

/** "Today 17:00", "Tomorrow 09:30", "Mon 3 Nov 17:00", "3 Nov 2027 17:00". */
export function formatDue(dueAt: string | null | undefined, timeZone: string, now: Date = new Date()): string {
  if (!dueAt) return "No deadline";
  const due = new Date(dueAt);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(due);
  const today = dayIn(now, timeZone);
  const day = dayIn(due, timeZone);
  if (day === today) return `Today ${time}`;
  if (day === addDays(today, 1)) return `Tomorrow ${time}`;
  if (day === addDays(today, -1)) return `Yesterday ${time}`;
  const sameYear = day.slice(0, 4) === today.slice(0, 4);
  const date = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: sameYear ? "short" : undefined,
    day: "numeric",
    month: "short",
    year: sameYear ? undefined : "numeric",
  }).format(due);
  return `${date.replace(",", "")} ${time}`;
}

/** "3 Nov 2026, 17:00" in timeZone. */
export function formatDateTimeIn(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}

/** "3 Nov 2026" in timeZone. */
export function formatDateIn(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-GB", { timeZone, day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));
}

/** "just now", "5 min ago", "3 h ago", "2 days ago", else a date. */
export function formatAgo(iso: string, timeZone: string, now: Date = new Date()): string {
  const seconds = Math.round((now.getTime() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} h ago`;
  if (seconds < 7 * 86_400) return `${Math.floor(seconds / 86_400)} days ago`;
  return formatDateIn(iso, timeZone);
}
