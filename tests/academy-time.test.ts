import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addDaysIso,
  convertWallTime,
  daysBetweenIso,
  deadlineFromOffset,
  defaultLocaleFor,
  defaultTimeZoneFor,
  endOfDayUtc,
  formatAcademyDate,
  formatAcademyDateTime,
  isAcademyTimeZone,
  isOverdue,
  localDateIso,
  relativeDeadlineLabel,
  releaseDateFor,
  safeZone,
  zonedTimeToUtc,
} from "@/lib/academy/time";

test("defaults per role: clients Dutch in Amsterdam, developers English in Kolkata", () => {
  assert.equal(defaultTimeZoneFor("client_admin"), "Europe/Amsterdam");
  assert.equal(defaultTimeZoneFor("client_reader"), "Europe/Amsterdam");
  assert.equal(defaultTimeZoneFor("developer"), "Asia/Kolkata");
  assert.equal(defaultTimeZoneFor("candidate"), "Asia/Kolkata");
  assert.equal(defaultLocaleFor("client_member"), "nl");
  assert.equal(defaultLocaleFor("candidate"), "en");
  assert.ok(isAcademyTimeZone("Asia/Kolkata"));
  assert.ok(!isAcademyTimeZone("Asia/Calcutta"));
  assert.equal(safeZone("Mars/Olympus"), "Europe/Amsterdam");
  assert.equal(safeZone(null), "Europe/Amsterdam");
});

test("today differs per zone around midnight", () => {
  // 20:00 UTC on 12 Nov is 21:00 in Amsterdam and 01:30 on 13 Nov in India.
  const instant = "2026-11-12T20:00:00Z";
  assert.equal(localDateIso(instant, "Europe/Amsterdam"), "2026-11-12");
  assert.equal(localDateIso(instant, "Asia/Kolkata"), "2026-11-13");
});

test("calendar arithmetic", () => {
  assert.equal(addDaysIso("2026-12-30", 3), "2027-01-02");
  assert.equal(addDaysIso("2026-03-01", -1), "2026-02-28");
  assert.equal(daysBetweenIso("2026-11-01", "2026-12-01"), 30);
  assert.equal(releaseDateFor("2026-11-02", 30), "2026-12-02");
  assert.equal(releaseDateFor(null, 30), null);
  assert.equal(releaseDateFor("2026-11-02", null), null);
});

test("wall clock times become the right UTC instant, also across summer time", () => {
  assert.equal(zonedTimeToUtc("2026-07-01", "09:00", "Europe/Amsterdam").toISOString(), "2026-07-01T07:00:00.000Z");
  assert.equal(zonedTimeToUtc("2026-12-01", "09:00", "Europe/Amsterdam").toISOString(), "2026-12-01T08:00:00.000Z");
  assert.equal(zonedTimeToUtc("2026-12-01", "09:00", "Asia/Kolkata").toISOString(), "2026-12-01T03:30:00.000Z");
});

test("deadlines are the end of the day in the user's zone", () => {
  assert.equal(endOfDayUtc("2026-11-12", "Asia/Kolkata"), "2026-11-12T18:29:59.000Z");
  assert.equal(endOfDayUtc("2026-11-12", "Europe/Amsterdam"), "2026-11-12T22:59:59.000Z");
  // "By day 1" with a start on 2 November: the end of 2 November.
  assert.equal(deadlineFromOffset("2026-11-02", 0, "Europe/Amsterdam"), "2026-11-02T22:59:59.000Z");
  assert.equal(deadlineFromOffset("2026-11-02", 7, "Asia/Kolkata"), "2026-11-09T18:29:59.000Z");
  assert.ok(isOverdue("2026-11-02T22:59:59.000Z", new Date("2026-11-03T00:00:00Z")));
  assert.ok(!isOverdue("2026-11-02T22:59:59.000Z", new Date("2026-11-02T12:00:00Z")));
  assert.ok(!isOverdue(null));
});

test("relative deadlines in words", () => {
  assert.equal(relativeDeadlineLabel(0, "nl"), "uiterlijk dag 1");
  assert.equal(relativeDeadlineLabel(0, "en"), "by day 1");
  assert.equal(relativeDeadlineLabel(4, "en"), "by day 5");
  assert.equal(relativeDeadlineLabel(7, "nl"), "in week 2");
  assert.equal(relativeDeadlineLabel(13, "en"), "in week 2");
  assert.equal(relativeDeadlineLabel(14, "en"), "in week 3");
});

test("dates are shown in the user's language and zone", () => {
  assert.equal(formatAcademyDate("2026-11-12", "nl", "Asia/Kolkata"), "12 november 2026");
  assert.equal(formatAcademyDate("2026-11-12", "en", "Europe/Amsterdam"), "12 November 2026");
  assert.equal(formatAcademyDate("2026-11-12T20:00:00Z", "en", "Asia/Kolkata"), "13 November 2026");
  assert.equal(formatAcademyDate(null, "en", "Asia/Kolkata", "none"), "none");
  assert.match(formatAcademyDateTime("2026-11-12T20:00:00Z", "en", "Asia/Kolkata"), /01:30/);
  assert.match(formatAcademyDateTime("2026-11-12T20:00:00Z", "nl", "Europe/Amsterdam"), /21:00/);
});

test("the overlap window for both sides", () => {
  assert.equal(convertWallTime("09:00", "Europe/Amsterdam", "Asia/Kolkata", "2026-12-01"), "13:30");
  assert.equal(convertWallTime("09:00", "Europe/Amsterdam", "Asia/Kolkata", "2026-07-01"), "12:30");
  assert.equal(convertWallTime("14:00", "Asia/Kolkata", "Europe/Amsterdam", "2026-12-01"), "09:30");
});
