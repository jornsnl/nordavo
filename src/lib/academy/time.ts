// Dates and deadlines in the Academy, in the user's own time zone (Academy:
// taal, tijdzone en huisstijl). Timestamps are stored in UTC; calendar dates
// (start date, release dates) are plain YYYY-MM-DD. Pure, safe for client
// components, tested in tests/academy-time.test.ts.

import type { AcademyLocale, AcademyRole } from "@/lib/academy/database";

/** The two zones of the Academy: the Netherlands and India. */
export const ACADEMY_TIME_ZONES = ["Europe/Amsterdam", "Asia/Kolkata"] as const;
export type AcademyTimeZone = (typeof ACADEMY_TIME_ZONES)[number];

export function isAcademyTimeZone(value: unknown): value is AcademyTimeZone {
  return typeof value === "string" && (ACADEMY_TIME_ZONES as readonly string[]).includes(value);
}

/** Clients are in the Netherlands, developers and candidates in India. */
export function defaultTimeZoneFor(role: AcademyRole): AcademyTimeZone {
  return role === "developer" || role === "candidate" ? "Asia/Kolkata" : "Europe/Amsterdam";
}

/** Clients read Dutch, developers and candidates English. */
export function defaultLocaleFor(role: AcademyRole): AcademyLocale {
  return role === "developer" || role === "candidate" ? "en" : "nl";
}

/** A zone that Intl knows, else Europe/Amsterdam. */
export function safeZone(zone: string | null | undefined): string {
  if (!zone) return "Europe/Amsterdam";
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: zone });
    return zone;
  } catch {
    return "Europe/Amsterdam";
  }
}

const intlLocale = (locale: AcademyLocale) => (locale === "nl" ? "nl-NL" : "en-GB");

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Parts of an instant on the wall clock of a zone. */
function zonedParts(date: Date, zone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: safeZone(zone),
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

/** The calendar day (YYYY-MM-DD) of an instant in a zone: "today" for that user. */
export function localDateIso(value: Date | string, zone: string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  const p = zonedParts(date, zone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** YYYY-MM-DD plus a number of days (calendar arithmetic, no time zone). */
export function addDaysIso(dateIso: string, days: number): string {
  const [y, m, d] = dateIso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

/** Whole days from a to b (both YYYY-MM-DD). */
export function daysBetweenIso(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/** Offset of a zone from UTC at an instant, in minutes (Amsterdam summer: 120). */
export function zoneOffsetMinutes(at: Date, zone: string): number {
  const p = zonedParts(at, zone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}

/** The UTC instant of a wall clock time in a zone (handles summer time). */
export function zonedTimeToUtc(dateIso: string, time: string, zone: string): Date {
  const [y, m, d] = dateIso.split("-").map(Number);
  const [hh, mm, ss = "0"] = time.split(":");
  const guess = Date.UTC(y, m - 1, d, Number(hh), Number(mm), Number(ss));
  // Two passes: the offset at the guess, then at the corrected instant.
  let instant = guess - zoneOffsetMinutes(new Date(guess), zone) * 60_000;
  instant = guess - zoneOffsetMinutes(new Date(instant), zone) * 60_000;
  return new Date(instant);
}

/** The last moment of a calendar day in a zone, as UTC ISO: the deadline of "by day N". */
export function endOfDayUtc(dateIso: string, zone: string): string {
  return new Date(zonedTimeToUtc(addDaysIso(dateIso, 1), "00:00", zone).getTime() - 1000).toISOString();
}

/** A relative deadline (days after the start date) as a real deadline in the user's zone. */
export function deadlineFromOffset(startDate: string, offsetDays: number, zone: string): string {
  return endOfDayUtc(addDaysIso(startDate, offsetDays), zone);
}

/** The day a module opens: start date plus release offset, or null. */
export function releaseDateFor(startDate: string | null, offsetDays: number | null): string | null {
  if (offsetDays === null || offsetDays === undefined || !startDate) return null;
  return addDaysIso(startDate, offsetDays);
}

export function isOverdue(dueAt: string | null | undefined, now: Date = new Date()): boolean {
  return Boolean(dueAt) && new Date(dueAt as string).getTime() < now.getTime();
}

/** "12 november 2026" / "12 November 2026"; dates without time are shown as they are. */
export function formatAcademyDate(value: string | null | undefined, locale: AcademyLocale, zone: string, fallback = ""): string {
  if (!value) return fallback;
  if (DATE_ONLY.test(value)) {
    const [y, m, d] = value.split("-").map(Number);
    return new Intl.DateTimeFormat(intlLocale(locale), { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(
      new Date(Date.UTC(y, m - 1, d)),
    );
  }
  return new Intl.DateTimeFormat(intlLocale(locale), { day: "numeric", month: "long", year: "numeric", timeZone: safeZone(zone) }).format(
    new Date(value),
  );
}

/** "12 nov, 17:00" in the user's zone. */
export function formatAcademyDateTime(value: string | null | undefined, locale: AcademyLocale, zone: string, fallback = ""): string {
  if (!value) return fallback;
  return new Intl.DateTimeFormat(intlLocale(locale), {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: safeZone(zone),
  }).format(new Date(value));
}

/** A wall clock time in one zone shown in another: the overlap window for both sides. */
export function convertWallTime(time: string, fromZone: string, toZone: string, onDate: string): string {
  const instant = zonedTimeToUtc(onDate, time, fromZone);
  const p = zonedParts(instant, toZone);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

/**
 * A relative deadline in words: 0 is "day 1", up to 6 "by day N", from 7
 * "in week N" (7 to 13 is week 2).
 */
export function relativeDeadlineLabel(offsetDays: number, locale: AcademyLocale): string {
  if (offsetDays < 7) {
    const day = Math.max(offsetDays, 0) + 1;
    return locale === "nl" ? `uiterlijk dag ${day}` : `by day ${day}`;
  }
  const week = Math.floor(offsetDays / 7) + 1;
  return locale === "nl" ? `in week ${week}` : `in week ${week}`;
}
