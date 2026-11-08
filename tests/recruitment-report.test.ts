import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildFunnel,
  buildRecruitmentReport,
  csvCell,
  cvScoreDistribution,
  daysOpen,
  furthestStage,
  FLOW,
  groupEvents,
  recruitmentPeriodStart,
  recruitmentReportCsv,
  stageTimes,
  topReasons,
  type ReportApplication,
  type ReportEvent,
  type ReportVacancy,
} from "@/lib/recruitment/report";

const NOW = new Date("2026-11-08T12:00:00Z");

function app(id: string, extra: Partial<ReportApplication> = {}): ReportApplication {
  return {
    id,
    vacancy_id: "v1",
    source: "linkedin",
    origin: "applied",
    stage: "sourced",
    exit_from_stage: null,
    form_completed_at: null,
    cv_score: null,
    rejection_reason: null,
    park_reason: null,
    created_at: "2026-10-01T09:00:00Z",
    ...extra,
  };
}

const ev = (application_id: string, to_stage: ReportEvent["to_stage"], created_at: string): ReportEvent => ({
  application_id,
  to_stage,
  created_at,
});

const vacancies: ReportVacancy[] = [
  { id: "v1", title: "Laravel developer", client: "KG", status: "open", opened_at: "2026-10-01", closed_at: null },
  { id: "v2", title: "GTM engineer", client: "Acme", status: "filled", opened_at: "2026-09-01", closed_at: "2026-09-29" },
  { id: "v3", title: "Old role", client: null, status: "closed", opened_at: "2026-01-01", closed_at: "2026-02-01" },
];

test("furthestStage takes history, current stage and the stage a parked card left", () => {
  assert.equal(furthestStage(app("a", { stage: "video_review" })), FLOW.indexOf("video_review"));
  assert.equal(furthestStage(app("a", { stage: "parked", exit_from_stage: "interview" })), FLOW.indexOf("interview"));
  assert.equal(
    furthestStage(app("a", { stage: "rejected", exit_from_stage: null }), [ev("a", "technical_test", "2026-10-02T00:00:00Z")]),
    FLOW.indexOf("technical_test"),
  );
  assert.equal(furthestStage(app("a", { stage: "rejected" })), -1);
});

test("buildFunnel counts stages reached, form filled from the form, and conversions", () => {
  const apps = [
    app("a", { form_completed_at: "2026-10-02T00:00:00Z", stage: "placed" }),
    app("b", { form_completed_at: "2026-10-02T00:00:00Z", stage: "interview" }),
    app("c", { stage: "parked", exit_from_stage: "video_review" }),
    app("d"),
  ];
  const funnel = buildFunnel(apps, new Map());
  assert.deepEqual(
    funnel.map((s) => [s.key, s.count, s.conversion]),
    [
      ["applicants", 4, null],
      ["form_filled", 2, 50],
      ["video_review", 3, 150],
      ["technical_test", 2, 66.7],
      ["interview", 2, 100],
      ["matched", 1, 50],
      ["placed", 1, 100],
    ],
  );
  assert.equal(funnel[6].pctOfTotal, 25);
  assert.equal(buildFunnel([], new Map())[1].conversion, null);
});

test("topReasons groups case and spacing, and names missing reasons", () => {
  assert.deepEqual(topReasons(["Frontend profile", "frontend  profile.", null, " ", "Notice period"], 2), [
    { reason: "Frontend profile", count: 2 },
    { reason: "No reason given", count: 2 },
  ]);
});

test("cvScoreDistribution buckets scores and averages", () => {
  const result = cvScoreDistribution([10, 55, 59, 80, 100, null]);
  assert.equal(result.scored, 5);
  assert.equal(result.average, 61);
  assert.deepEqual(
    result.buckets.map((b) => b.count),
    [1, 0, 2, 0, 2],
  );
  assert.equal(cvScoreDistribution([null]).average, null);
});

test("stageTimes measures days between moves, the current stage until now", () => {
  const apps = [app("a", { stage: "video_review" }), app("b", { stage: "rejected" })];
  const events = groupEvents([
    ev("a", "sourced", "2026-11-01T12:00:00Z"),
    ev("a", "video_review", "2026-11-03T12:00:00Z"),
    ev("b", "sourced", "2026-11-01T12:00:00Z"),
    ev("b", "rejected", "2026-11-02T12:00:00Z"),
  ]);
  const times = stageTimes(apps, events, NOW);
  assert.deepEqual(
    times.map((t) => [t.stage, t.avgDays, t.medianDays, t.count]),
    [
      ["sourced", 1.5, 1.5, 2],
      ["video_review", 5, 5, 1],
    ],
  );
});

test("daysOpen counts until closing or today", () => {
  assert.equal(daysOpen(vacancies[0], NOW), 38);
  assert.equal(daysOpen(vacancies[1], NOW), 28);
});

test("buildRecruitmentReport: totals, sources, origins with their own funnel, per vacancy", () => {
  const apps = [
    app("a", { origin: "headhunted", source: "headhunted", stage: "matched", form_completed_at: "2026-10-02T00:00:00Z" }),
    app("b", { source: "naukri", stage: "rejected", exit_from_stage: "techstack_check", rejection_reason: "Frontend" }),
    app("c", { source: "naukri", stage: "parked", exit_from_stage: "interview", park_reason: "Notice 90 days", cv_score: 72 }),
    app("d", { vacancy_id: "v2", source: null, stage: "placed", form_completed_at: "2026-09-05T00:00:00Z" }),
  ];
  const report = buildRecruitmentReport({ applications: apps, events: [], vacancies }, NOW);

  assert.deepEqual(report.totals, { applicants: 4, applied: 3, headhunted: 1, active: 1, parked: 1, rejected: 1, placed: 1 });
  assert.deepEqual(
    report.bySource.map((r) => [r.label, r.count, r.pct]),
    [
      ["Naukri", 2, 50],
      ["Headhunted", 1, 25],
      ["Unknown", 1, 25],
    ],
  );
  assert.equal(report.byOrigin.find((r) => r.key === "headhunted")?.count, 1);
  const step = (origin: "applied" | "headhunted", key: string) =>
    report.funnelByOrigin[origin].find((s) => s.key === key)?.count;
  assert.equal(step("headhunted", "matched"), 1);
  assert.equal(step("applied", "interview"), 2);
  assert.equal(step("applied", "placed"), 1);
  assert.deepEqual(report.parked.reasons, [{ reason: "Notice 90 days", count: 1 }]);
  assert.equal(report.cvScores.scored, 1);

  // Open vacancies always show; closed ones only with applications.
  assert.deepEqual(
    report.vacancies.map((v) => [v.id, v.applicants, v.headhunted, v.formFilled, v.interview, v.matched, v.placed]),
    [
      ["v1", 3, 1, 1, 2, 1, 0],
      ["v2", 1, 0, 1, 1, 1, 1],
    ],
  );
});

test("recruitmentPeriodStart and the CSV export", () => {
  assert.equal(recruitmentPeriodStart("all", NOW), null);
  assert.equal(recruitmentPeriodStart("30-days", NOW), "2026-10-09T12:00:00.000Z");

  assert.equal(csvCell('He said "hi", ok'), '"He said ""hi"", ok"');
  assert.equal(csvCell("=HYPERLINK(1)"), "'=HYPERLINK(1)");
  assert.equal(csvCell(null), "");

  const report = buildRecruitmentReport({ applications: [app("a")], events: [], vacancies }, NOW);
  const csv = recruitmentReportCsv(report, "Test");
  assert.match(csv, /^Test\r\n/);
  assert.match(csv, /Applicants,Applied,Headhunted/);
  assert.match(csv, /\r\nLaravel developer,KG,open,38,1,0,0,0,0,0\r\n/);
});
