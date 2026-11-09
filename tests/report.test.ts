import { test } from "node:test";
import assert from "node:assert/strict";
import {
  amsterdamMidnight,
  attributionBreakdown,
  buildFunnel,
  goPerSegment,
  leadTimeRows,
  leadTimeWarnings,
  periodRange,
  renderReportHtml,
  type VacancyFact,
  type WeeklyReport,
} from "@/lib/gtm/report";
import {
  countLeadStatuses,
  figuresPerCaller,
  summarizeMeetings,
  summarizePipeline,
  summarizeSalesActivity,
  type ActivityFigureRow,
  type MeetingFigureRow,
} from "@/lib/sales/stats";

const row = (over: Partial<ActivityFigureRow>): ActivityFigureRow => ({
  type: "contact",
  channel: "bellen",
  outcome: null,
  direction: "outbound",
  contact_id: null,
  caller_id: null,
  created_by: null,
  review_status: null,
  ...over,
});

// Calls from the call screen (new outcomes) and one old call from the sheet.
const activities: ActivityFigureRow[] = [
  row({ contact_id: "a", outcome: "no_answer", caller_id: "c1" }),
  row({ contact_id: "a", outcome: "reached_interested", caller_id: "c1" }),
  row({ contact_id: "b", outcome: "meeting_planned", caller_id: "c1" }),
  row({ contact_id: "g", outcome: "wrong_number", created_by: "u1" }),
  row({ contact_id: "h", outcome: "bereikt", created_by: "u1" }),
  // An old "put on a call list" marker is not a call.
  row({ contact_id: "i", outcome: "verstuurd" }),
  // Edits and views are not contact moments.
  row({ contact_id: "a", type: "change", channel: "system", outcome: null }),
  row({ contact_id: "c", channel: "mail", outcome: "verstuurd", direction: null }),
  row({ contact_id: "d", channel: "mail", outcome: null }),
  row({ contact_id: "e", channel: "linkedin", outcome: null }),
  row({ contact_id: "c", type: "reply", channel: "mail", outcome: "reply_positief", direction: "inbound" }),
  row({ contact_id: "d", type: "reply", channel: "linkedin", outcome: "reply_neutraal", direction: "inbound", review_status: "pending" }),
  row({ contact_id: "f", channel: "mail", outcome: "bounce" }),
  row({ contact_id: "b", type: "meeting", channel: "meeting", outcome: "meeting_planned" }),
];

test("summarizeSalesActivity counts calls, reach, mails and replies from the new outcomes", () => {
  assert.deepEqual(summarizeSalesActivity(activities), {
    approached: 7, // a, b, g, h by phone, c and d by mail, e on LinkedIn
    calls: 5,
    reached: 3, // reached_interested, meeting_planned, old bereikt
    reachedContacts: 5, // a, b, h by phone, c and d replied
    meetingsFromCalls: 1,
    mails: 2,
    linkedin: 1,
    replies: 2,
    positiveReplies: 1,
    pendingReplies: 1,
  });
});

const period = { from: "2026-11-02T00:00:00Z", to: "2026-11-09T00:00:00Z" };
const meeting = (over: Partial<MeetingFigureRow>): MeetingFigureRow => ({
  status: "planned",
  created_at: "2026-11-03T10:00:00Z",
  scheduled_at: "2026-11-12T10:00:00Z",
  decided_at: null,
  fee: 0,
  caller_id: null,
  booked_by: null,
  ...over,
});

test("summarizeMeetings counts planned, held, approved, rejected, no shows and fees", () => {
  const rows = [
    meeting({ caller_id: "c1", fee: 75 }),
    meeting({ status: "approved", scheduled_at: "2026-11-04T10:00:00Z", decided_at: "2026-11-05T10:00:00Z", fee: 75, caller_id: "c1" }),
    meeting({ status: "rejected", created_at: "2026-10-20T10:00:00Z", scheduled_at: "2026-11-04T10:00:00Z", decided_at: "2026-11-06T10:00:00Z" }),
    meeting({ status: "no_show", created_at: "2026-10-20T10:00:00Z", scheduled_at: "2026-11-05T10:00:00Z" }),
    meeting({ status: "approved", created_at: "2026-10-01T10:00:00Z", scheduled_at: "2026-10-05T10:00:00Z", decided_at: "2026-10-06T10:00:00Z", fee: 50 }),
  ];
  assert.deepEqual(summarizeMeetings(rows, period, new Date("2026-11-09T00:00:00Z")), {
    planned: 2,
    held: 2,
    approved: 1,
    rejected: 1,
    noShow: 1,
    cancelled: 0,
    fees: 75,
    upcoming: 1,
  });
});

test("summarizePipeline counts companies per stage and what moved in the period", () => {
  const p = summarizePipeline(
    [
      { pipeline_stage: "interested", pipeline_entered_at: "2026-11-03T10:00:00Z", pipeline_stage_changed_at: "2026-11-03T10:00:00Z" },
      { pipeline_stage: "meeting_planned", pipeline_entered_at: "2026-10-01T10:00:00Z", pipeline_stage_changed_at: "2026-11-04T10:00:00Z" },
      { pipeline_stage: "won", pipeline_entered_at: "2026-09-01T10:00:00Z", pipeline_stage_changed_at: "2026-11-05T10:00:00Z" },
      { pipeline_stage: "lost", pipeline_entered_at: "2026-09-01T10:00:00Z", pipeline_stage_changed_at: "2026-10-05T10:00:00Z" },
      { pipeline_stage: null, pipeline_entered_at: null, pipeline_stage_changed_at: null },
    ],
    period,
  );
  assert.equal(p.open, 2);
  assert.equal(p.enteredInPeriod, 1);
  assert.equal(p.wonInPeriod, 1);
  assert.equal(p.lostInPeriod, 0);
  assert.equal(p.perStage.length, 8);
  assert.deepEqual(p.perStage[0], { stage: "interested", label: "Interested", count: 1 });
});

test("figuresPerCaller splits external callers and team members", () => {
  const rows = figuresPerCaller(
    activities,
    [meeting({ caller_id: "c1" }), meeting({ status: "approved", decided_at: "2026-11-05T10:00:00Z", fee: 75, caller_id: "c1" })],
    { callers: new Map([["c1", "Carla"]]), people: new Map([["u1", "Julius"]]) },
    period,
  );
  assert.deepEqual(
    rows.map((r) => [r.name, r.kind, r.calls, r.reached, r.meetingsPlanned, r.meetingsApproved, r.fees]),
    [
      ["Carla", "caller", 3, 2, 2, 1, 75],
      ["Julius", "team", 2, 1, 0, 0, 0],
    ],
  );
});

test("countLeadStatuses lists every lead status", () => {
  const counts = countLeadStatuses([{ lead_status: "new" }, { lead_status: "new" }, { lead_status: "ready" }]);
  assert.equal(counts.length, 8);
  assert.equal(counts.find((c) => c.status === "new")?.count, 2);
  assert.equal(counts.find((c) => c.status === "no_go")?.count, 0);
});

test("goPerSegment computes GO percentage per segment in segment order", () => {
  const rows = goPerSegment([
    { segment: "productie", icp_decision: "NO_GO" },
    { segment: "saas", icp_decision: "GO" },
    { segment: "saas", icp_decision: "GO" },
    { segment: "saas", icp_decision: "REVIEW" },
    { segment: null, icp_decision: "NO_GO" },
    { segment: "saas", icp_decision: null },
  ]);
  assert.deepEqual(rows, [
    { segment: "saas", label: "SaaS", total: 3, go: 2, review: 1, noGo: 0, goPct: 67 },
    { segment: "productie", label: "Manufacturing", total: 1, go: 0, review: 0, noGo: 1, goPct: 0 },
    { segment: "onbekend", label: "No segment", total: 1, go: 0, review: 0, noGo: 1, goPct: 0 },
  ]);
});

test("attributionBreakdown groups meetings by signal, segment and channel", () => {
  const result = attributionBreakdown([
    { segment: "saas", channel: "bellen", signal_type: "vacature" },
    { segment: "saas", channel: "mail", signal_type: "lang_open" },
    { segment: "agency_automation", channel: "bellen", signal_type: "vacature" },
    { segment: null, channel: "meeting", signal_type: null },
  ]);
  assert.deepEqual(result.bySignal, [
    { key: "vacature", label: "Vacancy", count: 2 },
    { key: "onbekend", label: "No signal", count: 1 },
    { key: "lang_open", label: "Open for long", count: 1 },
  ]);
  assert.deepEqual(result.bySegment[0], { key: "saas", label: "SaaS", count: 2 });
  assert.deepEqual(result.byChannel[0], { key: "bellen", label: "Call", count: 2 });
});

const meetingFigures = summarizeMeetings([meeting({}), meeting({})], period);
const pipelineFigures = summarizePipeline(
  [{ pipeline_stage: "won", pipeline_entered_at: "2026-11-03T10:00:00Z", pipeline_stage_changed_at: "2026-11-04T10:00:00Z" }],
  period,
);

test("buildFunnel", () => {
  const funnel = buildFunnel(summarizeSalesActivity(activities), meetingFigures, pipelineFigures);
  assert.deepEqual(funnel.map((f) => f.count), [7, 5, 2, 1, 2, 1]);
});

const now = new Date("2026-10-24T10:00:00Z");
const vacancy = (over: Partial<VacancyFact>): VacancyFact => ({
  id: "v",
  title: "Backend developer",
  talent_stage: "zoeken",
  opened_at: "2026-10-01T10:00:00Z",
  intake_at: null,
  profiles_sent_at: null,
  first_interview_at: null,
  start_at: null,
  company: "Acme",
  ...over,
});

test("leadTimeRows warns when approaching or past 21 days without profiles", () => {
  const rows = leadTimeRows(
    [
      vacancy({ id: "fresh", intake_at: "2026-10-20T10:00:00Z" }),
      vacancy({ id: "close", intake_at: "2026-10-08T10:00:00Z" }),
      vacancy({ id: "late", intake_at: null }),
      vacancy({ id: "sent", intake_at: "2026-09-20T10:00:00Z", profiles_sent_at: "2026-10-05T10:00:00Z" }),
      vacancy({ id: "done", talent_stage: "geplaatst" }),
    ],
    now,
  );
  assert.deepEqual(
    rows.map((r) => [r.vacancyId, r.days, r.level]),
    [
      ["late", 23, "over"],
      ["close", 16, "bijna"],
      ["sent", 34, "ok"],
      ["fresh", 4, "ok"],
    ],
  );
  assert.equal(rows.find((r) => r.vacancyId === "sent")?.daysToProfiles, 15);
  const warnings = leadTimeWarnings(rows);
  assert.equal(warnings.length, 2);
  assert.match(warnings[0], /Backend developer at Acme has been running for 23 days/);
  assert.match(warnings[1], /5 days left until 3 weeks/);
});

test("periodRange uses Amsterdam weeks starting Monday", () => {
  // Saturday 24 October 2026, summer time (UTC+2).
  assert.equal(periodRange("deze-week", now).from, "2026-10-18T22:00:00.000Z");
  assert.deepEqual(periodRange("vorige-week", now), { from: "2026-10-11T22:00:00.000Z", to: "2026-10-18T22:00:00.000Z" });
  assert.equal(periodRange("30-dagen", now).from, "2026-09-24T10:00:00.000Z");
  // Winter time (UTC+1).
  assert.equal(amsterdamMidnight("2026-11-02").toISOString(), "2026-11-01T23:00:00.000Z");
});

test("renderReportHtml puts warnings first and escapes data", () => {
  const report: WeeklyReport = {
    period: { from: "2026-10-17T10:00:00Z", to: "2026-10-24T10:00:00Z" },
    newCompanies: 12,
    goPerSegment: goPerSegment([{ segment: "saas", icp_decision: "GO" }]),
    activity: summarizeSalesActivity(activities),
    meetings: meetingFigures,
    pipeline: pipelineFigures,
    perCaller: [],
    repliesToReview: 2,
    funnel: buildFunnel(summarizeSalesActivity(activities), meetingFigures, pipelineFigures),
    attribution: attributionBreakdown([{ segment: "saas", channel: "bellen", signal_type: "vacature" }]),
    leadTimes: leadTimeRows([vacancy({ id: "late", title: "Dev <script>" })], now),
    warnings: ["Dev <script> at Acme has been running for 23 days"],
  };
  const html = renderReportHtml(report, "https://portal.nordavo.nl/dashboard/report");
  assert.ok(html.indexOf("Attention") < html.indexOf("GO percentage per segment"));
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("Dev &lt;script&gt;"));
  assert.ok(html.includes("#0a1a2f"));
  assert.ok(html.includes("https://portal.nordavo.nl/dashboard/report"));
  assert.ok(html.includes("Pipeline"));
  assert.ok(html.includes("2 replies wait for review"));
});
