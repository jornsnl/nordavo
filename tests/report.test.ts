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
  summarizeActivities,
  type ActivityFact,
  type VacancyFact,
  type WeeklyReport,
} from "@/lib/gtm/report";

const activities: ActivityFact[] = [
  { contact_id: "a", channel: "bellen", outcome: "geen_gehoor" },
  { contact_id: "a", channel: "bellen", outcome: "bereikt" },
  { contact_id: "b", channel: "bellen", outcome: "afspraak" },
  { contact_id: "c", channel: "mail", outcome: "verstuurd" },
  { contact_id: "d", channel: "mail", outcome: "verstuurd" },
  { contact_id: "c", channel: "mail", outcome: "reply_positief" },
  { contact_id: "d", channel: "mail", outcome: "reply_negatief" },
  { contact_id: "e", channel: "mail", outcome: "bounce" },
  { contact_id: "a", channel: "meeting", outcome: "notitie" },
  { contact_id: "b", channel: "bellen", outcome: "afspraak_goedgekeurd" },
  { contact_id: "f", channel: "bellen", outcome: "afspraak_afgekeurd" },
];

test("summarizeActivities counts calls, reach, mail and replies", () => {
  assert.deepEqual(summarizeActivities(activities), {
    approached: 5, // a, b, c, d, f (bounce does not count)
    called: 5,
    reached: 4,
    reachedContacts: 5, // a, b, f by phone, c and d replied
    mailed: 2,
    replies: 2,
    positiveReplies: 1,
    meetingsApproved: 1,
    meetingsRejected: 1,
  });
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
    { segment: "productie", label: "Productie", total: 1, go: 0, review: 0, noGo: 1, goPct: 0 },
    { segment: "onbekend", label: "Geen segment", total: 1, go: 0, review: 0, noGo: 1, goPct: 0 },
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
    { key: "vacature", label: "Vacature", count: 2 },
    { key: "onbekend", label: "Geen signaal", count: 1 },
    { key: "lang_open", label: "Lang open", count: 1 },
  ]);
  assert.deepEqual(result.bySegment[0], { key: "saas", label: "SaaS", count: 2 });
  assert.deepEqual(result.byChannel[0], { key: "bellen", label: "Bellen", count: 2 });
});

test("buildFunnel", () => {
  const funnel = buildFunnel(summarizeActivities(activities), 3);
  assert.deepEqual(funnel.map((f) => f.count), [5, 5, 2, 3]);
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
  assert.match(warnings[0], /Backend developer bij Acme loopt al 23 dagen/);
  assert.match(warnings[1], /Nog 5 dagen tot 3 weken/);
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
    activity: summarizeActivities(activities),
    meetings: 3,
    funnel: buildFunnel(summarizeActivities(activities), 3),
    attribution: attributionBreakdown([{ segment: "saas", channel: "bellen", signal_type: "vacature" }]),
    leadTimes: leadTimeRows([vacancy({ id: "late", title: "Dev <script>" })], now),
    warnings: ["Dev <script> bij Acme loopt al 23 dagen"],
  };
  const html = renderReportHtml(report, "https://portal.nordavo.nl/dashboard/rapport");
  assert.ok(html.indexOf("Let op") < html.indexOf("GO percentage per segment"));
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("Dev &lt;script&gt;"));
  assert.ok(html.includes("#0a1a2f"));
  assert.ok(html.includes("https://portal.nordavo.nl/dashboard/rapport"));
});
