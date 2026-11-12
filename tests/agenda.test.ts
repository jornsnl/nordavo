import { test } from "node:test";
import assert from "node:assert/strict";
import {
  amsterdamDateTime,
  availabilityDate,
  buildAgenda,
  candidateItem,
  computedHolidays,
  durationLabel,
  filterAgenda,
  holidayItems,
  interviewItem,
  monthWeeks,
  parseGroups,
  parseView,
  placementItems,
  roleOverview,
  runsOn,
  shiftAnchor,
  vacancyItems,
  viewRange,
  type AgendaPlacement,
  type AgendaVacancy,
} from "@/lib/recruitment/agenda";

const NOW = new Date("2026-11-12T10:00:00Z");
const TODAY = "2026-11-12";

function vacancy(extra: Partial<AgendaVacancy> = {}): AgendaVacancy {
  return {
    id: "v1",
    title: "React developer",
    client: "Acme",
    status: "open",
    is_talent_pool: false,
    owner_id: "u1",
    opened_at: "2026-11-01T09:00:00Z",
    closed_at: null,
    intake_at: "2026-11-03T13:00:00Z",
    profiles_sent_at: null,
    first_interview_at: null,
    desired_start_date: "2027-01-04",
    start_at: null,
    presentation_deadline: null,
    presented: 1,
    holds: [],
    ...extra,
  };
}

function placement(extra: Partial<AgendaPlacement> = {}): AgendaPlacement {
  return {
    id: "p1",
    candidate: "Asha",
    candidate_id: "c1",
    client: "Acme",
    vacancy: "React developer",
    status: "active",
    start_date: "2026-06-01",
    end_date: null,
    guarantee_until: "2026-07-01",
    probation_end_date: null,
    next_checkin_at: "2026-11-20",
    ownerIds: ["u2"],
    ...extra,
  };
}

test("view ranges: week from Monday, month in whole weeks, list a month ahead", () => {
  assert.deepEqual(viewRange("day", TODAY), { from: TODAY, to: TODAY });
  assert.deepEqual(viewRange("week", TODAY), { from: "2026-11-09", to: "2026-11-15" });
  assert.deepEqual(viewRange("month", TODAY), { from: "2026-10-26", to: "2026-12-06" });
  assert.equal(monthWeeks(TODAY).length, 6);
  assert.ok(monthWeeks(TODAY).every((w) => w.length === 7));
  assert.deepEqual(viewRange("list", TODAY), { from: TODAY, to: "2026-12-12" });
  assert.equal(shiftAnchor("week", TODAY, 1), "2026-11-19");
  assert.equal(shiftAnchor("month", "2026-01-31", 1), "2026-02-01");
  assert.equal(shiftAnchor("day", "2026-12-31", 1), "2027-01-01");
  assert.equal(parseView("nonsense"), "week");
  assert.deepEqual(parseGroups("vacancies,foo,interviews,vacancies"), ["vacancies", "interviews"]);
});

test("vacancy: open since, intake, desired start and the fill deadline with days left", () => {
  const items = vacancyItems(vacancy(), NOW);
  const byKind = Object.fromEntries(items.map((i) => [i.kind, i]));
  assert.equal(byKind.vacancy_opened.date, "2026-11-01");
  assert.equal(byKind.vacancy_opened.tone, "success");
  assert.equal(byKind.intake.date, "2026-11-03");
  assert.equal(byKind.desired_start.date, "2027-01-04");
  // Three weeks after opening.
  assert.equal(byKind.fill_deadline.date, "2026-11-22");
  assert.match(byKind.fill_deadline.subtitle ?? "", /1 of 3 presented, 10 days left, open 11 days/);
  assert.ok(items.every((i) => i.href === "/dashboard/vacancies/v1"));

  // An explicit presentation deadline wins; past it the item is red.
  const late = vacancyItems(vacancy({ presentation_deadline: "2026-11-10", opened_at: "2026-10-01T09:00:00Z" }), NOW);
  const deadline = late.find((i) => i.kind === "fill_deadline");
  assert.equal(deadline?.date, "2026-11-10");
  assert.equal(deadline?.tone, "danger");
  assert.equal(late.find((i) => i.kind === "vacancy_opened")?.tone, "danger");

  // Days on hold move the three week deadline.
  const held = vacancyItems(vacancy({ holds: [{ started_on: "2026-11-05", ended_on: "2026-11-08" }] }), NOW);
  assert.equal(held.find((i) => i.kind === "fill_deadline")?.date, "2026-11-25");

  // Closed vacancies are out; filled ones keep their start.
  assert.equal(vacancyItems(vacancy({ status: "closed" }), NOW).length, 0);
  assert.deepEqual(vacancyItems(vacancy({ status: "filled" }), NOW).map((i) => i.kind), ["desired_start"]);
  // Talent pool: no clock.
  assert.ok(!vacancyItems(vacancy({ is_talent_pool: true }), NOW).some((i) => i.kind === "fill_deadline"));
});

test("placement: start with duration, last working day on notice, guarantee and check-in", () => {
  const items = placementItems(placement({ status: "notice", end_date: "2026-12-15" }), TODAY);
  const byKind = Object.fromEntries(items.map((i) => [i.kind, i]));
  assert.equal(byKind.placement_start.date, "2026-06-01");
  assert.match(byKind.placement_start.subtitle ?? "", /running 5 months/);
  assert.equal(byKind.last_day.date, "2026-12-15");
  assert.match(byKind.last_day.subtitle ?? "", /After 6 months/);
  assert.equal(byKind.guarantee_end.date, "2026-07-01");
  assert.equal(byKind.checkin.date, "2026-11-20");
  assert.deepEqual(byKind.checkin.ownerIds, ["u2"]);
  // Overdue check-ins are red.
  assert.equal(placementItems(placement({ next_checkin_at: "2026-11-01" }), TODAY).find((i) => i.kind === "checkin")?.tone, "danger");
});

test("interviews in Amsterdam time, cancelled ones left out; client interviews apart", () => {
  assert.deepEqual(amsterdamDateTime("2026-11-12T23:30:00Z"), { date: "2026-11-13", time: "00:30" });
  const base = {
    id: "i1",
    kind: "client_interview" as const,
    status: "scheduled",
    starts_at: "2026-11-13T09:00:00Z",
    candidate: "Asha",
    candidate_id: "c1",
    vacancy: "React developer",
    vacancy_id: "v1",
    application_id: "a1",
    ownerIds: ["u3"],
  };
  const item = interviewItem(base);
  assert.equal(item?.kind, "client_interview");
  assert.equal(item?.date, "2026-11-13");
  assert.equal(item?.time, "10:00");
  assert.equal(item?.href, "/dashboard/vacancies/v1/pipeline?application=a1");
  assert.equal(interviewItem({ ...base, status: "cancelled" }), null);
  assert.equal(interviewItem({ ...base, kind: "english_interview" })?.kind, "interview");
});

test("candidate availability from free text", () => {
  assert.equal(availabilityDate("From 2026-12-01"), "2026-12-01");
  assert.equal(availabilityDate("1-12-2026"), "2026-12-01");
  assert.equal(availabilityDate("available 15 January 2027"), "2027-01-15");
  assert.equal(availabilityDate("3 mei 2027"), "2027-05-03");
  assert.equal(availabilityDate("Immediately"), null);
  assert.equal(availabilityDate("31-02-2027"), null);
  assert.equal(candidateItem({ id: "c1", full_name: "Asha", availability: "1-12-2026", status: "available", owner_id: null })?.date, "2026-12-01");
  assert.equal(candidateItem({ id: "c1", full_name: "Asha", availability: "1-12-2026", status: "placed", owner_id: null }), null);
});

test("holidays only when they touch a running placement", () => {
  const running = placement();
  const ended = placement({ id: "p2", candidate: "Ravi", status: "ended", start_date: "2025-01-01", end_date: "2026-03-01" });
  const holidays = computedHolidays("2026-12-01", "2026-12-31");
  assert.ok(holidays.some((h) => h.country === "NL" && h.date === "2026-12-25"));
  assert.ok(holidays.some((h) => h.country === "IN" && h.date === "2026-12-25"));
  const items = holidayItems(holidays, [running, ended]);
  assert.deepEqual(
    items.map((i) => [i.date, i.title]),
    [
      ["2026-12-25", "Christmas Day (Netherlands)"],
      ["2026-12-26", "Boxing Day (Netherlands)"],
      ["2026-12-25", "Christmas (Karnataka)"],
    ],
  );
  assert.match(items[2].subtitle ?? "", /developer off: Asha/);
  assert.equal(holidayItems(holidays, [ended]).length, 0);
  // Good Friday is no day off in most Dutch jobs.
  assert.ok(!holidayItems(computedHolidays("2027-03-26", "2027-03-26"), [running]).some((i) => i.title.includes("Netherlands")));
  assert.equal(runsOn(running, "2026-05-31"), false);
  assert.equal(runsOn(placement({ status: "notice", end_date: "2026-12-15" }), "2026-12-16"), false);
});

test("filters: range, kinds and my agenda", () => {
  const items = buildAgenda(
    {
      vacancies: [vacancy()],
      placements: [placement()],
      interviews: [],
      candidates: [],
      holidays: computedHolidays("2026-11-01", "2026-12-31"),
    },
    TODAY,
    NOW,
  );
  const week = filterAgenda(items, { from: "2026-11-16", to: "2026-11-22" });
  assert.deepEqual(week.map((i) => i.kind), ["checkin", "fill_deadline"]);
  assert.deepEqual(filterAgenda(items, { from: "2026-11-16", to: "2026-11-22", groups: ["vacancies"] }).map((i) => i.kind), ["fill_deadline"]);
  assert.deepEqual(filterAgenda(items, { from: "2026-11-16", to: "2026-11-22", scope: "mine", userId: "u2" }).map((i) => i.kind), ["checkin"]);
  // Sorted by date.
  assert.deepEqual([...items].sort((a, b) => a.date.localeCompare(b.date)).map((i) => i.id), items.map((i) => i.id));
});

test("all roles: start, end and duration", () => {
  assert.equal(durationLabel("2026-06-01", "2026-11-12"), "5 months");
  assert.equal(durationLabel("2025-06-01", "2026-08-01"), "1 year, 2 months");
  assert.equal(durationLabel("2026-11-01", "2026-11-12"), "11 days");
  assert.equal(durationLabel("2026-12-01", "2026-11-12"), "Not started");
  const rows = roleOverview([vacancy()], [placement(), placement({ id: "p3", start_date: "2027-01-04" })], TODAY);
  assert.deepEqual(
    rows.map((r) => [r.type, r.start, r.duration]),
    [
      ["placement", "2027-01-04", "Not started"],
      ["vacancy", "2026-11-01", "11 days so far"],
      ["placement", "2026-06-01", "5 months so far"],
    ],
  );
});
