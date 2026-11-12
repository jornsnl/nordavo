import { test } from "node:test";
import assert from "node:assert/strict";
import {
  daysOnHold,
  daysOpenWithoutHolds,
  daysUntil,
  deadlineLevel,
  flowDeadline,
  holdSummary,
  isDutchSummerTime,
  istToNl,
  nlStartOn,
  parseClock,
} from "@/lib/recruitment/vacancy-time";
import { leadTime } from "@/lib/talent/lead-time";
import {
  isSeniority,
  mainApplication,
  nameKey,
  nextStepFor,
  noticePeriodLabel,
  parseNoticePeriod,
  seniorityOptions,
  videoEmbed,
} from "@/lib/recruitment/candidate-fields";
import { plainTextToMarkdown } from "@/lib/recruitment/job-profile";
import { nextDir, sortVacancies, type SortableVacancy } from "@/lib/recruitment/vacancy-sort";
import { activeBlockedMessage, clientReadiness } from "@/lib/recruitment/client-readiness";
import { clientRateTotals, vacancyBudgetText } from "@/lib/sales/client-rates";
import { fieldNameClashes, fieldNameWarning } from "@/lib/recruitment/field-names";
import { candidateTemplateCsv, rowsFromSheet, TEMPLATE_HEADERS } from "@/lib/recruitment/import-template";
import { guessCandidateMapping } from "@/lib/screening/candidate-csv";
import { applicationStages } from "@/lib/labels";

const at = (iso: string) => new Date(`${iso}T12:00:00Z`);

// ---------------------------------------------------------------------------
// On hold: the clock stands still
// ---------------------------------------------------------------------------

test("daysOnHold counts closed and open periods inside the window, overlaps once", () => {
  const holds = [
    { started_on: "2026-11-05", ended_on: "2026-11-10" },
    { started_on: "2026-11-08", ended_on: "2026-11-12" },
    { started_on: "2026-11-20", ended_on: null },
  ];
  assert.equal(daysOnHold(holds, "2026-11-01", "2026-11-25"), 7 + 5);
  assert.equal(daysOnHold(holds, "2026-11-09", "2026-11-11"), 2);
  assert.equal(daysOnHold([], "2026-11-01", "2026-11-25"), 0);
  assert.equal(daysOnHold(holds, "2026-11-25", "2026-11-01"), 0);
});

test("days open leave out the days on hold", () => {
  const v = { opened_at: "2026-11-01", closed_at: null };
  assert.equal(daysOpenWithoutHolds(v, [], at("2026-11-21")), 20);
  assert.equal(daysOpenWithoutHolds(v, [{ started_on: "2026-11-05", ended_on: "2026-11-15" }], at("2026-11-21")), 10);
  // Still on hold: the clock does not move.
  const holds = [{ started_on: "2026-11-11", ended_on: null }];
  assert.equal(daysOpenWithoutHolds(v, holds, at("2026-11-20")), 10);
  assert.equal(daysOpenWithoutHolds(v, holds, at("2026-12-20")), 10);
  // Closed: counted up to closed_at.
  assert.equal(daysOpenWithoutHolds({ opened_at: "2026-11-01", closed_at: "2026-11-11" }, [], at("2026-12-01")), 10);
});

test("lead time stands still while on hold", () => {
  const v = { intake_at: "2026-11-01T09:00:00Z", profiles_sent_at: null, talent_stage: "zoeken" };
  assert.equal(leadTime(v, at("2026-11-26")).level, "danger");
  const held = leadTime(v, at("2026-11-26"), [{ started_on: "2026-11-05", ended_on: "2026-11-20" }]);
  assert.equal(held.days, 10);
  assert.equal(held.level, "ok");
});

test("holdSummary: total and current period", () => {
  const s = holdSummary([{ started_on: "2026-11-01", ended_on: "2026-11-04" }, { started_on: "2026-11-10", ended_on: null }], at("2026-11-12"));
  assert.equal(s.total, 5);
  assert.equal(s.current, 2);
  assert.equal(s.open?.started_on, "2026-11-10");
});

test("flow deadline: presentation deadline first, else opened plus three weeks and days on hold", () => {
  assert.deepEqual(flowDeadline({ opened_at: "2026-11-01", presentation_deadline: "2026-11-18" }), { date: "2026-11-18", source: "deadline" });
  assert.deepEqual(flowDeadline({ opened_at: "2026-11-01", presentation_deadline: null }, [], at("2026-11-02")), { date: "2026-11-22", source: "three_weeks" });
  assert.deepEqual(
    flowDeadline({ opened_at: "2026-11-01", presentation_deadline: null }, [{ started_on: "2026-11-05", ended_on: "2026-11-10" }], at("2026-11-12")),
    { date: "2026-11-27", source: "three_weeks" },
  );
  assert.equal(flowDeadline({ opened_at: "2026-11-01", presentation_deadline: null, is_talent_pool: true }), null);
});

test("deadline level for the presentation deadline", () => {
  const now = at("2026-11-12");
  assert.equal(deadlineLevel(null, 0, now), "none");
  assert.equal(deadlineLevel("2026-11-11", 1, now), "late");
  assert.equal(deadlineLevel("2026-11-14", 1, now), "soon");
  assert.equal(deadlineLevel("2026-11-30", 1, now), "ok");
  assert.equal(deadlineLevel("2026-11-11", 3, now), "done");
  assert.equal(daysUntil("2026-11-15", now), 3);
});

// ---------------------------------------------------------------------------
// Start time IST to NL
// ---------------------------------------------------------------------------

test("12:30 IST is 08:00 NL in winter and 09:00 in summer", () => {
  assert.deepEqual(istToNl("12:30"), { ist: "12:30", winter: "08:00", summer: "09:00" });
  assert.deepEqual(istToNl("13:30:00"), { ist: "13:30", winter: "09:00", summer: "10:00" });
  assert.deepEqual(istToNl("03:00"), { ist: "03:00", winter: "22:30", summer: "23:30" });
  assert.equal(istToNl("25:00"), null);
  assert.equal(istToNl(""), null);
  assert.equal(parseClock("9:05"), 545);
});

test("Dutch summer time follows the EU rule", () => {
  assert.equal(isDutchSummerTime(new Date("2026-01-15T12:00:00Z")), false);
  assert.equal(isDutchSummerTime(new Date("2026-07-01T12:00:00Z")), true);
  // 2026: summer time from 29 March 01:00 UTC to 25 October 01:00 UTC.
  assert.equal(isDutchSummerTime(new Date("2026-03-29T00:59:00Z")), false);
  assert.equal(isDutchSummerTime(new Date("2026-03-29T01:00:00Z")), true);
  assert.equal(isDutchSummerTime(new Date("2026-10-25T00:59:00Z")), true);
  assert.equal(isDutchSummerTime(new Date("2026-10-25T01:00:00Z")), false);
  assert.equal(nlStartOn("12:30", new Date("2026-12-01T00:00:00Z")), "08:00");
  assert.equal(nlStartOn("12:30", new Date("2026-06-01T00:00:00Z")), "09:00");
});

// ---------------------------------------------------------------------------
// Candidate fields
// ---------------------------------------------------------------------------

test("one seniority list for vacancies and candidates", () => {
  const values = seniorityOptions.map((o) => o.value);
  for (const v of ["intern", "fresher", "junior", "medior", "senior", "lead", "manager", "senior_manager", "freelance"]) {
    assert.ok(values.includes(v as (typeof values)[number]), v);
    assert.ok(isSeniority(v));
  }
  assert.equal(isSeniority("principal"), false);
});

test("notice period free text to a choice, unreadable text stays", () => {
  assert.equal(parseNoticePeriod("Immediately"), "immediate");
  assert.equal(parseNoticePeriod("ASAP"), "immediate");
  assert.equal(parseNoticePeriod("0 days"), "immediate");
  assert.equal(parseNoticePeriod("Within 1 week"), "15");
  assert.equal(parseNoticePeriod("Within 2 weeks"), "15");
  assert.equal(parseNoticePeriod("30 days"), "30");
  assert.equal(parseNoticePeriod("Within 1 month"), "30");
  assert.equal(parseNoticePeriod("45"), "45");
  assert.equal(parseNoticePeriod("2 months"), "60");
  assert.equal(parseNoticePeriod("3 months or more"), "90_plus");
  assert.equal(parseNoticePeriod("90 days or more"), "90_plus");
  assert.equal(parseNoticePeriod("60"), "60");
  assert.equal(parseNoticePeriod("90_plus"), "90_plus");
  assert.equal(parseNoticePeriod("serving notice, LWD 3rd Jan"), null);
  assert.equal(parseNoticePeriod("negotiable"), null);
  assert.equal(parseNoticePeriod(""), null);
  assert.equal(noticePeriodLabel("30"), "30 days");
  assert.equal(noticePeriodLabel("negotiable"), "negotiable");
});

test("video links to an embeddable player", () => {
  assert.deepEqual(videoEmbed("https://www.loom.com/share/0123456789abcdef0123456789abcdef"), {
    provider: "loom",
    embedUrl: "https://www.loom.com/embed/0123456789abcdef0123456789abcdef",
  });
  assert.equal(videoEmbed("https://youtu.be/dQw4w9WgXcQ")?.embedUrl, "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
  assert.equal(videoEmbed("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10")?.embedUrl, "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
  assert.equal(videoEmbed("https://youtube.com/shorts/dQw4w9WgXcQ")?.provider, "youtube");
  assert.equal(videoEmbed("https://vimeo.com/123456789")?.embedUrl, "https://player.vimeo.com/video/123456789");
  assert.equal(
    videoEmbed("https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUv/view?usp=sharing")?.embedUrl,
    "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUv/preview",
  );
  assert.equal(videoEmbed("https://example.com/video.mp4"), null);
  assert.equal(videoEmbed("javascript:alert(1)"), null);
  assert.equal(videoEmbed("not a url"), null);
});

test("candidate header: main application and next step", () => {
  const order = applicationStages.map((s) => s.value);
  const apps = [
    { id: "a", stage: "sourced" as const, created_at: "2026-11-01" },
    { id: "b", stage: "interview" as const, created_at: "2026-10-01" },
    { id: "c", stage: "rejected" as const, created_at: "2026-11-05" },
  ];
  assert.equal(mainApplication(apps, order)?.id, "b");
  assert.equal(mainApplication([apps[2]], order)?.id, "c");
  assert.equal(mainApplication([], order), null);
  assert.equal(nextStepFor(null), "Link the candidate to a vacancy");
  assert.equal(nextStepFor("matched", "approved"), "Plan the client interview");
  assert.equal(nextStepFor("video_review"), "Review the video intro");
});

test("nameKey for duplicate checks", () => {
  assert.equal(nameKey("  Priya   SHARMA "), "priya sharma");
  assert.equal(nameKey("A"), null);
});

// ---------------------------------------------------------------------------
// Job profile formatting
// ---------------------------------------------------------------------------

test("plain vacancy text gets headings and bullets", () => {
  const md = plainTextToMarkdown("ABOUT THE ROLE\nYou build pipelines.\n\nRequirements:\n• Python\n• dbt\n1) SQL\n\n\n");
  assert.equal(md, "## About the role\nYou build pipelines.\n\n## Requirements\n- Python\n- dbt\n1. SQL");
});

// ---------------------------------------------------------------------------
// Vacancy list sorting
// ---------------------------------------------------------------------------

test("vacancy list sorts per column, empty values last", () => {
  const base: SortableVacancy = { title: "", owner: "", seniorityRank: 0, statusRank: 0, stageRank: 0, inPipeline: 0, daysOpen: 0, leadDays: null, flowDeadline: null };
  const rows = [
    { ...base, title: "b", daysOpen: 3, flowDeadline: "2026-12-01", leadDays: null },
    { ...base, title: "A", daysOpen: 10, flowDeadline: null, leadDays: 4 },
    { ...base, title: "c", daysOpen: 1, flowDeadline: "2026-11-20", leadDays: 9 },
  ];
  const titles = (list: typeof rows) => list.map((r) => r.title);
  assert.deepEqual(titles(sortVacancies(rows, (r) => r, "role", "asc")), ["A", "b", "c"]);
  assert.deepEqual(titles(sortVacancies(rows, (r) => r, "days_open", "desc")), ["A", "b", "c"]);
  assert.deepEqual(titles(sortVacancies(rows, (r) => r, "flow_deadline", "asc")), ["c", "b", "A"]);
  assert.deepEqual(titles(sortVacancies(rows, (r) => r, "flow_deadline", "desc")), ["b", "c", "A"]);
  assert.deepEqual(titles(sortVacancies(rows, (r) => r, "lead_time", "desc")), ["c", "A", "b"]);
  assert.deepEqual(titles(sortVacancies(rows, (r) => r, null, "asc")), ["b", "A", "c"]);
  assert.equal(nextDir("role", "asc", "role"), "desc");
  assert.equal(nextDir("role", "asc", "days_open"), "desc");
  assert.equal(nextDir(null, "asc", "client"), "asc");
});

// ---------------------------------------------------------------------------
// Clients and client rates
// ---------------------------------------------------------------------------

test("a client needs an owner and a contact before Active; city and industry warn", () => {
  assert.deepEqual(clientReadiness({ owner_id: null, city: null, industry: "", contactCount: 0 }), {
    missing: ["an owner", "a contact person"],
    warnings: ["city", "industry"],
  });
  assert.deepEqual(clientReadiness({ owner_id: "x", city: "Utrecht", industry: "SaaS", contactCount: 2 }), { missing: [], warnings: [] });
  assert.match(activeBlockedMessage(["an owner", "a contact person"]), /with an owner and a contact person/);
});

test("client rates: running placements and open vacancy budgets", () => {
  const totals = clientRateTotals(
    [
      { status: "active", monthly_rate: 4500 },
      { status: "notice", monthly_rate: "3000" },
      { status: "ended", monthly_rate: 9999 },
      { status: "active", monthly_rate: null },
    ],
    [
      { status: "open", monthly_budget: 5000, budget_min: null, budget_max: null },
      { status: "open", monthly_budget: null, budget_min: 3000, budget_max: 4000 },
      { status: "closed", monthly_budget: 7000, budget_min: null, budget_max: null },
    ],
  );
  assert.deepEqual(totals, { runningPerMonth: 7500, openBudgetPerMonth: 9000 });
  assert.deepEqual(clientRateTotals([], []), { runningPerMonth: null, openBudgetPerMonth: null });
  assert.equal(vacancyBudgetText({ monthly_budget: null, budget_min: 3000, budget_max: 4000 }), "€3,000 to €4,000");
  assert.equal(vacancyBudgetText({ monthly_budget: null, budget_min: null, budget_max: null }), null);
});

// ---------------------------------------------------------------------------
// Custom field names
// ---------------------------------------------------------------------------

test("custom field names that clash with fixed fields or other record types", () => {
  assert.match(fieldNameWarning(fieldNameClashes("Notice period", "candidate", []), "candidate") ?? "", /fixed field on candidates/);
  // The vacancy fields that started this: candidate data on a vacancy.
  assert.match(fieldNameWarning(fieldNameClashes("Notice-period", "vacancy", []), "vacancy") ?? "", /exists on candidates/);
  assert.match(fieldNameWarning(fieldNameClashes("LinkedIn profile", "vacancy", []), "vacancy") ?? "", /candidates/);
  const existing = [{ id: "1", label: "Preferred stack", key: "preferred_stack", entity: "candidate" }];
  assert.match(fieldNameWarning(fieldNameClashes("preferred stack", "candidate", existing), "candidate") ?? "", /already a field/);
  assert.equal(fieldNameClashes("Preferred stack", "candidate", existing, { ignoreId: "1" }).length, 0);
  assert.equal(fieldNameWarning(fieldNameClashes("Hobby", "candidate", existing), "candidate"), null);
  // Generic names on many record types do not warn across types.
  assert.equal(fieldNameClashes("Status", "application", []).length, 0);
});

// ---------------------------------------------------------------------------
// Bulk import
// ---------------------------------------------------------------------------

test("the import template maps onto the candidate fields by itself", () => {
  const csv = candidateTemplateCsv();
  assert.ok(csv.startsWith(TEMPLATE_HEADERS.join(",")));
  const mapping = guessCandidateMapping([...TEMPLATE_HEADERS]);
  assert.equal(mapping.full_name, "Full name");
  assert.equal(mapping.email, "Email");
  assert.equal(mapping.phone, "Phone");
});

test("an Excel sheet becomes headers and rows", () => {
  const { headers, rows } = rowsFromSheet([
    ["Full name", "Email", "Email", null],
    [null, null, null, null],
    ["Priya", "p@example.com", "x@example.com", 6],
    ["Ravi", null, null, new Date("2026-01-02T00:00:00Z")],
  ]);
  assert.deepEqual(headers, ["Full name", "Email", "Email (2)", "Column 4"]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]["Column 4"], "6");
  assert.equal(rows[1]["Column 4"], "2026-01-02");
  assert.deepEqual(rowsFromSheet([]), { headers: [], rows: [] });
});
