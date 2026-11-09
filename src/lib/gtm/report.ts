import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActivityChannel, Database, Segment, TalentStage } from "@/lib/database.types";
import { activityChannels, optionFor, segments, signalTypes, talentStages } from "@/lib/labels";
import {
  loadSalesFigures,
  type ActivityFigures,
  type CallerFigures,
  type MeetingFigures,
  type PipelineFigures,
} from "@/lib/sales/stats";
import { countsInMetrics } from "@/lib/talent/talent-pool";
import { mailButton, renderMailLayout } from "@/lib/notify/layout";

/**
 * Weekly report (S10): the numbers Julius gets every Friday and sees under
 * Report in the portal. The sales figures come from the sales CRM
 * (src/lib/sales/stats.ts): calls, reach, mails and replies from Activities,
 * the pipeline from the companies and meetings from the Meetings register.
 * buildWeeklyReport does the queries; everything else here is pure
 * aggregation, unit tested with fixtures.
 */

type Db = SupabaseClient<Database>;

/** Lead time promise: 3 candidates within 3 weeks. */
export const LEAD_TIME_LIMIT_DAYS = 21;
export const LEAD_TIME_WARN_DAYS = 14;

export type CountRow = { key: string; label: string; count: number };

export type SegmentGoRow = { segment: string; label: string; total: number; go: number; review: number; noGo: number; goPct: number | null };

export type LeadTimeLevel = "ok" | "bijna" | "over";

export type LeadTimeRow = {
  vacancyId: string;
  title: string;
  company: string | null;
  stage: TalentStage;
  stageLabel: string;
  startedAt: string;
  days: number;
  profilesSentAt: string | null;
  firstInterviewAt: string | null;
  startAt: string | null;
  /** Days from intake to profiles sent, when sent. */
  daysToProfiles: number | null;
  level: LeadTimeLevel;
};

export type WeeklyReport = {
  period: { from: string; to: string };
  newCompanies: number;
  goPerSegment: SegmentGoRow[];
  activity: ActivityFigures;
  meetings: MeetingFigures;
  pipeline: PipelineFigures;
  perCaller: CallerFigures[];
  repliesToReview: number;
  funnel: CountRow[];
  attribution: { bySignal: CountRow[]; bySegment: CountRow[]; byChannel: CountRow[] };
  leadTimes: LeadTimeRow[];
  warnings: string[];
};

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export function goPerSegment(rows: { segment: Segment | null; icp_decision: string | null }[]): SegmentGoRow[] {
  const bySegment = new Map<string, SegmentGoRow>();
  for (const row of rows) {
    if (!row.icp_decision) continue;
    const key = row.segment ?? "onbekend";
    const entry =
      bySegment.get(key) ??
      { segment: key, label: segmentLabel(row.segment), total: 0, go: 0, review: 0, noGo: 0, goPct: null };
    entry.total += 1;
    if (row.icp_decision === "GO") entry.go += 1;
    else if (row.icp_decision === "REVIEW") entry.review += 1;
    else entry.noGo += 1;
    bySegment.set(key, entry);
  }
  const order = [...segments.map((s) => s.value as string), "onbekend"];
  return [...bySegment.values()]
    .map((row) => ({ ...row, goPct: row.total ? Math.round((row.go / row.total) * 100) : null }))
    .sort((a, b) => order.indexOf(a.segment) - order.indexOf(b.segment));
}

function segmentLabel(segment: Segment | null) {
  return segment ? optionFor(segments, segment).label : "No segment";
}

function countBy<T>(rows: T[], key: (row: T) => string, label: (key: string) => string): CountRow[] {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(key(row), (counts.get(key(row)) ?? 0) + 1);
  return [...counts.entries()]
    .map(([k, count]) => ({ key: k, label: label(k), count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export type AttributionFact = { segment: Segment | null; channel: ActivityChannel; signal_type: string | null };

export function attributionBreakdown(rows: AttributionFact[]) {
  return {
    bySignal: countBy(
      rows,
      (r) => r.signal_type ?? "onbekend",
      (k) => (k === "onbekend" ? "No signal" : (signalTypes.find((s) => s.value === k)?.label ?? k)),
    ),
    bySegment: countBy(
      rows,
      (r) => r.segment ?? "onbekend",
      (k) => (k === "onbekend" ? "No segment" : segmentLabel(k as Segment)),
    ),
    byChannel: countBy(
      rows,
      (r) => r.channel,
      (k) => optionFor(activityChannels, k as ActivityChannel).label,
    ),
  };
}

export function buildFunnel(activity: ActivityFigures, meetings: MeetingFigures, pipeline: PipelineFigures): CountRow[] {
  return [
    { key: "benaderd", label: "Contacted", count: activity.approached },
    { key: "bereikt", label: "Reached", count: activity.reachedContacts },
    { key: "replies", label: "Replies", count: activity.replies },
    { key: "pipeline", label: "Into pipeline", count: pipeline.enteredInPeriod },
    { key: "afspraken", label: "Meetings", count: meetings.planned },
    { key: "won", label: "Won", count: pipeline.wonInPeriod },
  ];
}

export type VacancyFact = {
  id: string;
  title: string;
  talent_stage: TalentStage;
  opened_at: string;
  intake_at: string | null;
  profiles_sent_at: string | null;
  first_interview_at: string | null;
  start_at: string | null;
  company: string | null;
  /** Talent pool vacancies have no clock and never count in the report. */
  is_talent_pool?: boolean;
};

function wholeDays(from: string, to: Date) {
  return Math.max(0, Math.floor((to.getTime() - new Date(from).getTime()) / 86_400_000));
}

/**
 * Lead time per open vacancy (T6). The clock runs from intake (else the
 * opening date) until profiles are sent: warn from 14 days, alarm from 21.
 * Talent pool vacancies are left out.
 */
export function leadTimeRows(vacancies: VacancyFact[], now = new Date()): LeadTimeRow[] {
  return vacancies
    .filter((v) => countsInMetrics(v) && v.talent_stage !== "geplaatst" && v.talent_stage !== "gesloten")
    .map((v) => {
      const startedAt = v.intake_at ?? v.opened_at;
      const days = wholeDays(startedAt, now);
      const daysToProfiles = v.profiles_sent_at ? wholeDays(startedAt, new Date(v.profiles_sent_at)) : null;
      const level: LeadTimeLevel = v.profiles_sent_at
        ? "ok"
        : days >= LEAD_TIME_LIMIT_DAYS
          ? "over"
          : days >= LEAD_TIME_WARN_DAYS
            ? "bijna"
            : "ok";
      return {
        vacancyId: v.id,
        title: v.title,
        company: v.company,
        stage: v.talent_stage,
        stageLabel: optionFor(talentStages, v.talent_stage).label,
        startedAt,
        days,
        profilesSentAt: v.profiles_sent_at,
        firstInterviewAt: v.first_interview_at,
        startAt: v.start_at,
        daysToProfiles,
        level,
      };
    })
    .sort((a, b) => levelRank(b.level) - levelRank(a.level) || b.days - a.days);
}

function levelRank(level: LeadTimeLevel) {
  return level === "over" ? 2 : level === "bijna" ? 1 : 0;
}

export function leadTimeWarnings(rows: LeadTimeRow[]): string[] {
  return rows
    .filter((r) => r.level !== "ok")
    .map((r) => {
      const who = r.company ? `${r.title} at ${r.company}` : r.title;
      return r.level === "over"
        ? `${who} has been running for ${r.days} days without profiles sent. The 3-week promise has passed.`
        : `${who} has been running for ${r.days} days without profiles sent. ${LEAD_TIME_LIMIT_DAYS - r.days} days left until 3 weeks.`;
    });
}

// ---------------------------------------------------------------------------
// Periods (Amsterdam time)
// ---------------------------------------------------------------------------

export const reportPeriods = [
  { value: "deze-week", label: "This week" },
  { value: "vorige-week", label: "Last week" },
  { value: "30-dagen", label: "Last 30 days" },
] as const;
export type ReportPeriodKey = (typeof reportPeriods)[number]["value"];

export function isReportPeriod(value: unknown): value is ReportPeriodKey {
  return reportPeriods.some((p) => p.value === value);
}

function amsterdamYmd(date: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Amsterdam" }).format(date);
}

/** Midnight in Amsterdam on a YYYY-MM-DD date, as a UTC instant. */
export function amsterdamMidnight(ymd: string): Date {
  const guess = new Date(`${ymd}T00:00:00Z`);
  const offset = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Amsterdam", timeZoneName: "longOffset" })
    .formatToParts(guess)
    .find((p) => p.type === "timeZoneName")?.value;
  const match = offset?.match(/GMT([+-])(\d{2}):(\d{2})/);
  const minutes = match ? (match[1] === "-" ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3])) : 0;
  return new Date(guess.getTime() - minutes * 60_000);
}

function shiftYmd(ymd: string, days: number) {
  const date = new Date(`${ymd}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function periodRange(key: ReportPeriodKey, now = new Date()): { from: string; to: string } {
  if (key === "30-dagen") {
    return { from: new Date(now.getTime() - 30 * 86_400_000).toISOString(), to: now.toISOString() };
  }
  const today = amsterdamYmd(now);
  const weekday = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
  const monday = shiftYmd(today, -weekday);
  if (key === "vorige-week") {
    return { from: amsterdamMidnight(shiftYmd(monday, -7)).toISOString(), to: amsterdamMidnight(monday).toISOString() };
  }
  return { from: amsterdamMidnight(monday).toISOString(), to: now.toISOString() };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

const PAGE = 1000;

/** Supabase returns at most 1000 rows per request: page through. */
async function fetchAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await page(offset, offset + PAGE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

export async function buildWeeklyReport(db: Db, { from, to }: { from: string; to: string }, now = new Date()): Promise<WeeklyReport> {
  const [newCompanies, qualified, figures, attribution, vacancies] = await Promise.all([
    db
      .from("companies")
      .select("id", { count: "exact", head: true })
      .gte("created_at", from)
      .lt("created_at", to)
      .then(({ count, error }) => {
        if (error) throw error;
        return count ?? 0;
      }),
    fetchAll((a, b) =>
      db
        .from("companies")
        .select("segment, icp_decision")
        .not("icp_decision", "is", null)
        .or(
          `and(qualified_at.gte."${from}",qualified_at.lt."${to}"),and(qualified_at.is.null,created_at.gte."${from}",created_at.lt."${to}")`,
        )
        .order("id")
        .range(a, b),
    ),
    loadSalesFigures(db, { from, to }, { perCaller: true, now }),
    fetchAll((a, b) =>
      db
        .from("appointment_attribution")
        .select("segment, channel, signal_type")
        .gte("date", from)
        .lt("date", to)
        .order("activity_id")
        .range(a, b),
    ),
    fetchAll((a, b) =>
      db
        .from("vacancies")
        .select(
          "id, title, talent_stage, opened_at, intake_at, profiles_sent_at, first_interview_at, start_at, is_talent_pool, client:clients(name), company:companies(name)",
        )
        .eq("is_talent_pool", false)
        .not("talent_stage", "in", "(geplaatst,gesloten)")
        .in("status", ["open", "on_hold"])
        .order("id")
        .range(a, b),
    ),
  ]);

  const leadTimes = leadTimeRows(
    vacancies.map((v) => ({
      id: v.id,
      title: v.title,
      talent_stage: v.talent_stage,
      opened_at: v.opened_at,
      intake_at: v.intake_at,
      profiles_sent_at: v.profiles_sent_at,
      first_interview_at: v.first_interview_at,
      start_at: v.start_at,
      company: v.client?.name ?? v.company?.name ?? null,
      is_talent_pool: v.is_talent_pool,
    })),
    now,
  );

  return {
    period: { from, to },
    newCompanies,
    goPerSegment: goPerSegment(qualified),
    activity: figures.activity,
    meetings: figures.meetings,
    pipeline: figures.pipeline,
    perCaller: figures.perCaller,
    repliesToReview: figures.repliesToReview,
    funnel: buildFunnel(figures.activity, figures.meetings, figures.pipeline),
    attribution: attributionBreakdown(attribution),
    leadTimes,
    warnings: leadTimeWarnings(leadTimes),
  };
}

// ---------------------------------------------------------------------------
// Mail (S10)
// ---------------------------------------------------------------------------

const navy = "#0a1a2f";
const saffronDark = "#d9871a";
const muted = "#5b6b80";
const line = "#e3ecf8";

function esc(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function formatDay(value: string | null) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "Europe/Amsterdam" }).format(new Date(value));
}

function table(head: string[], rows: (string | number)[][], empty: string) {
  if (rows.length === 0) return `<p style="margin:0 0 16px;color:${muted};font-size:14px">${esc(empty)}</p>`;
  const th = head
    .map((h, i) => `<th style="text-align:${i === 0 ? "left" : "right"};padding:8px 10px;font-size:12px;color:${muted};text-transform:uppercase;border-bottom:2px solid ${line}">${esc(h)}</th>`)
    .join("");
  const body = rows
    .map(
      (row) =>
        `<tr>${row
          .map((cell, i) => `<td style="text-align:${i === 0 ? "left" : "right"};padding:8px 10px;font-size:14px;color:${navy};border-bottom:1px solid ${line}">${esc(String(cell))}</td>`)
          .join("")}</tr>`,
    )
    .join("");
  return `<table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;margin:0 0 20px"><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table>`;
}

function heading(text: string) {
  return `<h2 style="margin:24px 0 8px;font-size:16px;color:${navy}">${esc(text)}</h2>`;
}

export function reportSubject(report: WeeklyReport) {
  return `Nordavo weekly report ${formatDay(report.period.from)} to ${formatDay(report.period.to)}: ${report.meetings.planned} meetings`;
}

/** The weekly report as a mail with inline styles. Warnings first. */
export function renderReportHtml(report: WeeklyReport, portalUrl?: string): string {
  const a = report.activity;
  const m = report.meetings;
  const stats: [string, number][] = [
    ["New companies", report.newCompanies],
    ["Calls", a.calls],
    ["Reached", a.reached],
    ["Mails", a.mails],
    ["Replies", a.replies],
    ["Meetings planned", m.planned],
    ["Approved", m.approved],
  ];
  const statCells = stats
    .map(
      ([label, value]) =>
        `<td style="padding:12px;border:1px solid ${line};border-radius:8px;text-align:center;width:14%"><div style="font-size:24px;font-weight:700;color:${navy}">${value}</div><div style="font-size:12px;color:${muted}">${esc(label)}</div></td>`,
    )
    .join("");

  const warnings = report.warnings.length
    ? `<div style="background:#fdf0dc;border-left:4px solid ${saffronDark};padding:12px 16px;margin:0 0 20px;border-radius:4px"><p style="margin:0 0 6px;font-weight:700;color:${navy}">Attention</p><ul style="margin:0;padding-left:18px;color:${navy};font-size:14px">${report.warnings
        .map((w) => `<li style="margin:2px 0">${esc(w)}</li>`)
        .join("")}</ul></div>`
    : "";

  const body = `${warnings}
<table role="presentation" cellspacing="6" cellpadding="0" style="width:100%;margin:0 0 8px"><tr>${statCells}</tr></table>
<p style="margin:0 0 8px;font-size:13px;color:${muted}">Meetings: ${m.held} held, ${m.approved} approved, ${m.rejected} rejected, ${m.noShow} no show. Fees approved: EUR ${m.fees.toFixed(2)}.${report.repliesToReview ? ` ${report.repliesToReview} replies wait for review.` : ""}</p>
${heading("Pipeline")}
${table(
  ["Stage", "Companies"],
  report.pipeline.perStage.map((s) => [s.label, s.count]),
  "No companies in the pipeline.",
)}
<p style="margin:0 0 8px;font-size:13px;color:${muted}">This period: ${report.pipeline.enteredInPeriod} into the pipeline, ${report.pipeline.wonInPeriod} won, ${report.pipeline.lostInPeriod} lost.</p>
${heading("Per caller")}
${table(
  ["Caller", "Calls", "Reached", "Meetings", "Approved"],
  report.perCaller.map((c) => [c.name, c.calls, c.reached, c.meetingsPlanned, c.meetingsApproved]),
  "No calls this period.",
)}
${heading("GO percentage per segment")}
${table(
  ["Segment", "Assessed", "GO", "Review", "No go", "GO %"],
  report.goPerSegment.map((s) => [s.label, s.total, s.go, s.review, s.noGo, s.goPct === null ? "" : `${s.goPct}%`]),
  "No companies were assessed this week.",
)}
${heading("Funnel")}
${table(["Step", "Count"], report.funnel.map((f) => [f.label, f.count]), "No activity.")}
${heading("Meetings per signal")}
${table(["Signal", "Meetings"], report.attribution.bySignal.map((r) => [r.label, r.count]), "No meetings this period.")}
${heading("Meetings per segment")}
${table(["Segment", "Meetings"], report.attribution.bySegment.map((r) => [r.label, r.count]), "No meetings this period.")}
${heading("Meetings per channel")}
${table(["Channel", "Meetings"], report.attribution.byChannel.map((r) => [r.label, r.count]), "No meetings this period.")}
${heading("Lead time of open vacancies")}
${table(
  ["Vacancy", "Stage", "Days", "Profiles", "1st interview", "Start"],
  report.leadTimes.map((v) => [
    v.company ? `${v.title} (${v.company})` : v.title,
    v.stageLabel,
    v.level === "over" ? `${v.days} (too long)` : v.level === "bijna" ? `${v.days} (almost 3 weeks)` : v.days,
    v.profilesSentAt ? formatDay(v.profilesSentAt) : "not yet",
    formatDay(v.firstInterviewAt),
    formatDay(v.startAt),
  ]),
  "No open vacancies.",
)}
${portalUrl ? mailButton(portalUrl, "View the report in the portal", { tone: "accent" }) : ""}`;
  return renderMailLayout({
    body,
    eyebrow: "Weekly report",
    title: `${formatDay(report.period.from)} to ${formatDay(report.period.to)}`,
    preheader: `${report.meetings.planned} meetings${report.warnings.length ? `, ${report.warnings.length} warnings` : ""}`,
    footerNote: "You get this mail because your address is set as REPORT_EMAIL_TO.",
    width: 680,
  });
}
