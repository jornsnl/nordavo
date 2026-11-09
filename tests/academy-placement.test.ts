import { test } from "node:test";
import assert from "node:assert/strict";
import { countryForZone, dutchHolidays, easterSunday, indiaFixedHolidays, isoWeekday } from "@/lib/academy/placement/holidays";
import { buildIcs, escapeIcsText, foldIcsLine } from "@/lib/academy/placement/ics";
import { MILESTONES, milestoneState, parseReviewAnswers, reviewOpen, timelineFor } from "@/lib/academy/placement/timeline";
import { canTick, periodStart, reminderPeriod, ritualConsistency, ritualsNow, type RitualLike } from "@/lib/academy/placement/rituals";
import { leaveSummary, workingDays } from "@/lib/academy/placement/leave";
import { pulseFlag, pulseRoundStart, pulseSeries } from "@/lib/academy/placement/pulse";
import { placementEn, placementNl } from "@/lib/academy/i18n/placement";

// ---------------------------------------------------------------------------
// Holidays
// ---------------------------------------------------------------------------

test("Easter Sunday for known years", () => {
  assert.equal(easterSunday(2024), "2024-03-31");
  assert.equal(easterSunday(2025), "2025-04-20");
  assert.equal(easterSunday(2026), "2026-04-05");
  assert.equal(easterSunday(2027), "2027-03-28");
  assert.equal(easterSunday(2028), "2028-04-16");
  assert.equal(easterSunday(2029), "2029-04-01");
  assert.equal(easterSunday(2030), "2030-04-21");
});

test("Dutch holidays 2026 to 2028", () => {
  const byName = (year: number) => Object.fromEntries(dutchHolidays(year).map((h) => [h.nameNl, h.date]));
  const y26 = byName(2026);
  assert.equal(y26["Goede Vrijdag"], "2026-04-03");
  assert.equal(y26["Tweede Paasdag"], "2026-04-06");
  assert.equal(y26["Koningsdag"], "2026-04-27");
  assert.equal(y26["Hemelvaartsdag"], "2026-05-14");
  assert.equal(y26["Eerste Pinksterdag"], "2026-05-24");
  assert.equal(y26["Tweede Pinksterdag"], "2026-05-25");
  const y27 = byName(2027);
  assert.equal(y27["Tweede Paasdag"], "2027-03-29");
  assert.equal(y27["Hemelvaartsdag"], "2027-05-06");
  assert.equal(y27["Tweede Pinksterdag"], "2027-05-17");
  const y28 = byName(2028);
  assert.equal(y28["Tweede Paasdag"], "2028-04-17");
  assert.equal(y28["Hemelvaartsdag"], "2028-05-25");
  assert.equal(y28["Tweede Pinksterdag"], "2028-06-05");
  assert.equal(dutchHolidays(2026).length, 11);
  // Ascension Day is always a Thursday, Whit Monday a Monday.
  for (const year of [2026, 2027, 2028, 2029, 2030]) {
    const names = byName(year);
    assert.equal(isoWeekday(names["Hemelvaartsdag"]), 4);
    assert.equal(isoWeekday(names["Tweede Pinksterdag"]), 1);
    assert.equal(isoWeekday(names["Goede Vrijdag"]), 5);
  }
});

test("King's Day moves to Saturday when 27 April is a Sunday", () => {
  assert.equal(dutchHolidays(2025).find((h) => h.nameNl === "Koningsdag")?.date, "2025-04-26");
  assert.equal(dutchHolidays(2031).find((h) => h.nameNl === "Koningsdag")?.date, "2031-04-26");
  assert.equal(dutchHolidays(2027).find((h) => h.nameNl === "Koningsdag")?.date, "2027-04-27");
});

test("days off: Good Friday never, Liberation Day every five years", () => {
  const off = (year: number, name: string) => dutchHolidays(year).find((h) => h.nameNl === name)?.dayOff;
  assert.equal(off(2026, "Goede Vrijdag"), false);
  assert.equal(off(2026, "Bevrijdingsdag"), false);
  assert.equal(off(2030, "Bevrijdingsdag"), true);
  assert.equal(off(2026, "Eerste Kerstdag"), true);
});

test("Indian fixed holidays, with Good Friday from Easter", () => {
  const list = indiaFixedHolidays(2028);
  assert.ok(list.every((h) => h.country === "IN" && h.region === "KA"));
  assert.equal(list.find((h) => h.nameEn === "Republic Day")?.date, "2028-01-26");
  assert.equal(list.find((h) => h.nameEn === "Kannada Rajyotsava")?.date, "2028-11-01");
  // In 2028 Good Friday and Ambedkar Jayanti fall on the same day.
  assert.equal(list.filter((h) => h.date === "2028-04-14").length, 2);
  assert.equal(countryForZone("Asia/Kolkata"), "IN");
  assert.equal(countryForZone("Europe/Amsterdam"), "NL");
  assert.equal(countryForZone(null), "NL");
});

// ---------------------------------------------------------------------------
// ICS
// ---------------------------------------------------------------------------

test("ICS: all-day events with an exclusive end, CRLF and escaping", () => {
  const ics = buildIcs({
    name: "Nordavo, KG",
    now: new Date("2026-11-09T10:00:00Z"),
    events: [
      { uid: "holiday-1", start: "2026-12-25", end: "2026-12-25", summary: "Christmas; Day, NL", categories: ["holiday_nl"] },
      { uid: "leave-1", start: "2026-12-28", end: "2026-12-31", summary: "Leave Asha", description: "Line 1\nLine 2" },
    ],
  });
  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n"));
  assert.ok(ics.endsWith("END:VCALENDAR\r\n"));
  assert.ok(!/[^\r]\n/.test(ics), "every line ends with CRLF");
  assert.match(ics, /X-WR-CALNAME:Nordavo\\, KG\r\n/);
  assert.match(ics, /UID:holiday-1@nordavo\.nl\r\n/);
  assert.match(ics, /DTSTART;VALUE=DATE:20261225\r\nDTEND;VALUE=DATE:20261226\r\n/);
  assert.match(ics, /DTSTART;VALUE=DATE:20261228\r\nDTEND;VALUE=DATE:20270101\r\n/);
  assert.match(ics, /SUMMARY:Christmas\\; Day\\, NL\r\n/);
  assert.match(ics, /DESCRIPTION:Line 1\\nLine 2\r\n/);
  assert.match(ics, /DTSTAMP:20261109T100000Z\r\n/);
  assert.equal(ics.match(/BEGIN:VEVENT/g)?.length, 2);
});

test("ICS: lines are folded at 75 octets, also with multi-byte characters", () => {
  const long = `SUMMARY:${"Kannada Rajyotsava – ".repeat(10)}`;
  const folded = foldIcsLine(long);
  const encoder = new TextEncoder();
  for (const line of folded.split("\r\n")) assert.ok(encoder.encode(line).length <= 75);
  assert.equal(folded.split("\r\n").map((l, i) => (i === 0 ? l : l.slice(1))).join(""), long);
  assert.equal(escapeIcsText("a\\b"), "a\\\\b");
});

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

test("timeline: day 1, week 1, 30 days and the 90-day review from the start", () => {
  assert.deepEqual(timelineFor("2026-11-02"), [
    { kind: "day_1", dueDate: "2026-11-02" },
    { kind: "week_1", dueDate: "2026-11-08" },
    { kind: "day_30", dueDate: "2026-12-01" },
    { kind: "day_90", dueDate: "2027-01-30" },
  ]);
  assert.deepEqual(MILESTONES.map((m) => m.offsetDays), [0, 6, 29, 89]);
});

test("timeline: state of a moment and when the form opens", () => {
  const m = { due_date: "2026-12-01", completed_at: null };
  assert.equal(milestoneState(m, "2026-11-20"), "upcoming");
  assert.equal(milestoneState(m, "2026-12-01"), "due");
  assert.equal(milestoneState(m, "2026-12-08"), "due");
  assert.equal(milestoneState(m, "2026-12-09"), "overdue");
  assert.equal(milestoneState({ ...m, completed_at: "2026-12-02T10:00:00Z" }, "2026-12-09"), "done");
  assert.equal(reviewOpen(m, "2026-11-23"), false);
  assert.equal(reviewOpen(m, "2026-11-24"), true);
  assert.equal(reviewOpen({ ...m, completed_at: "2026-12-02T10:00:00Z" }, "2026-12-03"), false);
});

test("review answers are cleaned", () => {
  assert.deepEqual(parseReviewAnswers({ rating: "4", going_well: "  Fast  ", improve: "", other: "x" }), { rating: 4, going_well: "Fast" });
  assert.deepEqual(parseReviewAnswers({ rating: 9 }), {});
  assert.deepEqual(parseReviewAnswers(null), {});
});

// ---------------------------------------------------------------------------
// Rituals and consistency
// ---------------------------------------------------------------------------

const rituals: RitualLike[] = [
  { id: "plan", title: "Weekly plan", cadence: "weekly", weekday: 1, audience: "both", active: true, position: 1 },
  { id: "daily", title: "Daily check-in", cadence: "daily", weekday: null, audience: "both", active: true, position: 2 },
  { id: "review", title: "Friday review", cadence: "weekly", weekday: 5, audience: "both", active: true, position: 3 },
  { id: "month", title: "Monthly talk", cadence: "monthly", weekday: null, audience: "both", active: true, position: 4 },
  { id: "old", title: "Old", cadence: "daily", weekday: null, audience: "both", active: false, position: 5 },
];
const log = (ritual_id: string, period_date: string) => ({ ritual_id, period_date, done_at: `${period_date}T10:00:00Z` });

test("periods: day, Monday, first of the month", () => {
  assert.equal(periodStart("daily", "2026-11-12"), "2026-11-12");
  assert.equal(periodStart("weekly", "2026-11-12"), "2026-11-09");
  assert.equal(periodStart("weekly", "2026-11-15"), "2026-11-09");
  assert.equal(periodStart("weekly", "2026-11-09"), "2026-11-09");
  assert.equal(periodStart("monthly", "2026-11-12"), "2026-11-01");
});

test("reminders: from 16:00 local time, on working days, once the day has come", () => {
  const daily = { cadence: "daily" as const, weekday: null };
  const monday = { cadence: "weekly" as const, weekday: 1 };
  const friday = { cadence: "weekly" as const, weekday: 5 };
  const monthly = { cadence: "monthly" as const, weekday: null };
  assert.equal(reminderPeriod(daily, "2026-11-09", 15), null);
  assert.equal(reminderPeriod(daily, "2026-11-09", 16), "2026-11-09");
  assert.equal(reminderPeriod(daily, "2026-11-14", 18), null); // Saturday
  assert.equal(reminderPeriod(monday, "2026-11-09", 17), "2026-11-09");
  assert.equal(reminderPeriod(monday, "2026-11-10", 9), "2026-11-09"); // missed on Monday
  assert.equal(reminderPeriod(monday, "2026-11-14", 17), null); // weekend
  assert.equal(reminderPeriod(friday, "2026-11-12", 17), null);
  assert.equal(reminderPeriod(friday, "2026-11-13", 16), "2026-11-09");
  assert.equal(reminderPeriod(monthly, "2026-11-19", 17), null);
  assert.equal(reminderPeriod(monthly, "2026-11-20", 17), "2026-11-01");
});

test("who ticks: the right side, never readers, Nordavo always", () => {
  assert.ok(canTick("both", "client_member", false));
  assert.ok(canTick("both", "developer", false));
  assert.ok(!canTick("both", "client_reader", false));
  assert.ok(!canTick("client", "developer", false));
  assert.ok(!canTick("developer", "client_admin", false));
  assert.ok(!canTick("nordavo", "client_admin", false));
  assert.ok(canTick("nordavo", null, true));
  assert.ok(!canTick("both", null, false));
});

test("rituals now: today, this week, this month", () => {
  const items = ritualsNow(rituals, [log("daily", "2026-11-09"), log("daily", "2026-11-11"), log("plan", "2026-11-09")], "2026-11-11");
  assert.deepEqual(items.map((i) => i.ritual.id), ["plan", "daily", "review", "month"]);
  const plan = items[0];
  assert.equal(plan.done, true);
  assert.equal(plan.periodDate, "2026-11-09");
  const daily = items[1];
  assert.equal(daily.done, true);
  assert.equal(daily.doneThisWeek, 2);
  assert.equal(daily.expectedThisWeek, 3);
  assert.equal(items[2].dueDate, "2026-11-13");
  assert.equal(items[2].done, false);
  assert.equal(items[3].periodDate, "2026-11-01");
});

test("consistency over the weeks since the start", () => {
  // Started Wednesday 4 November 2026; today Wednesday 18 November.
  const logs = [
    log("daily", "2026-11-04"),
    log("daily", "2026-11-05"),
    log("daily", "2026-11-06"),
    log("review", "2026-11-02"),
    log("plan", "2026-11-09"),
    log("daily", "2026-11-09"),
    log("daily", "2026-11-10"),
    log("daily", "2026-11-11"),
    log("daily", "2026-11-12"),
    log("daily", "2026-11-13"),
    log("review", "2026-11-09"),
    log("month", "2026-11-01"),
  ];
  const result = ritualConsistency(rituals, logs, { startDate: "2026-11-04", today: "2026-11-18" });
  assert.deepEqual(result.weeks.map((w) => w.weekStart), ["2026-11-02", "2026-11-09", "2026-11-16"]);
  const [first, second, third] = result.weeks;
  // Week 1: daily Wed to Fri (3 of 3), the plan of Monday 2 Nov was before the start, review done.
  assert.equal(first.expected, 4);
  assert.equal(first.done, 4);
  assert.equal(first.percent, 100);
  // Week 2: plan, five check-ins, review: all done.
  assert.equal(second.expected, 7);
  assert.equal(second.done, 7);
  // Week 3 so far: plan (Monday), Mon to Wed check-ins; Friday not yet.
  assert.equal(third.expected, 4);
  assert.equal(third.done, 0);
  assert.equal(third.percent, 0);
  assert.equal(result.percent, Math.round((11 / 15) * 100));
  assert.deepEqual(result.months, [{ month: "2026-11-01", rituals: [{ id: "month", done: true }] }]);
  // Inactive rituals do not count.
  assert.ok(result.weeks.every((w) => w.rituals.every((r) => r.id !== "old")));
});

test("consistency: nothing before the start, at most the asked weeks", () => {
  assert.deepEqual(ritualConsistency(rituals, [], { startDate: "2026-12-01", today: "2026-11-18" }).weeks, []);
  const many = ritualConsistency(rituals, [], { startDate: "2026-01-05", today: "2026-11-18", weeks: 4 });
  assert.equal(many.weeks.length, 4);
  assert.equal(many.weeks.at(-1)?.weekStart, "2026-11-16");
  assert.equal(many.percent, 0);
});

// ---------------------------------------------------------------------------
// Leave and pulse
// ---------------------------------------------------------------------------

test("working days skip weekends and holidays", () => {
  assert.equal(workingDays("2026-11-09", "2026-11-15"), 5);
  assert.equal(workingDays("2026-11-09", "2026-11-15", ["2026-11-10"]), 4);
  assert.equal(workingDays("2026-11-14", "2026-11-15"), 0);
  assert.equal(workingDays("2026-11-15", "2026-11-09"), 0);
});

test("leave summary of a year", () => {
  const summary = leaveSummary(
    { entitled_days: 24, carried_over_days: 2, adjustment_days: 3 },
    [
      { kind: "vacation", status: "approved", start_date: "2026-03-02", days: 5 },
      { kind: "vacation", status: "requested", start_date: "2026-12-21", days: 4 },
      { kind: "vacation", status: "client_agreed", start_date: "2026-07-01", days: 2 },
      { kind: "vacation", status: "rejected", start_date: "2026-08-01", days: 10 },
      { kind: "sick", status: "approved", start_date: "2026-04-01", days: 2 },
      { kind: "vacation", status: "approved", start_date: "2027-01-04", days: 3 },
    ],
    2026,
  );
  assert.deepEqual(summary, { year: 2026, total: 26, used: 8, pending: 6, remaining: 18, hasBalance: true });
  assert.equal(leaveSummary(null, [], 2026).hasBalance, false);
});

test("pulse: low and dropping scores are a signal", () => {
  assert.equal(pulseFlag(5, null), "low");
  assert.equal(pulseFlag(6, null), null);
  assert.equal(pulseFlag(6, 8), "drop");
  assert.equal(pulseFlag(7, 8), null);
  assert.equal(pulseFlag(4, 9), "low");
  assert.equal(pulseRoundStart("2026-11-02", "2026-11-15"), null);
  assert.equal(pulseRoundStart("2026-11-02", "2026-11-16"), "2026-11-16");
  assert.equal(pulseRoundStart("2026-11-02", "2026-11-29"), "2026-11-16");
  assert.equal(pulseRoundStart("2026-11-02", "2026-11-30"), "2026-11-30");
});

test("pulse series per person", () => {
  const series = pulseSeries([
    { profile_id: "d", name: "Asha", role: "developer", period_start: "2026-11-30", score: 6, flagged: true },
    { profile_id: "d", name: "Asha", role: "developer", period_start: "2026-11-16", score: 8, flagged: false },
    { profile_id: "c", name: "Klant", role: "client_admin", period_start: "2026-11-16", score: null, flagged: false },
  ]);
  assert.deepEqual(series.map((s) => s.profileId), ["c", "d"]);
  assert.equal(series[1].latest, 6);
  assert.equal(series[1].change, -2);
  assert.equal(series[1].average, 7);
  assert.equal(series[0].latest, null);
});

test("placement texts exist in both languages with the same placeholders", () => {
  const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  assert.deepEqual(Object.keys(placementNl).sort(), Object.keys(placementEn).sort());
  for (const key of Object.keys(placementEn) as (keyof typeof placementEn)[]) {
    assert.deepEqual(placeholders(placementNl[key]), placeholders(placementEn[key]), key);
  }
});
