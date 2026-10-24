import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActivityChannel, ActivityOutcome, Database, Segment, TalentStage } from "@/lib/database.types";
import { activityChannels, optionFor, segments, signalTypes, talentStages } from "@/lib/labels";

/**
 * Weekly report (S10): the numbers Julius gets every Friday and sees under
 * Rapport in the portal. buildWeeklyReport does the queries; everything else
 * here is pure aggregation, unit tested with fixtures.
 */

type Db = SupabaseClient<Database>;

/** Lead time promise: 3 candidates within 3 weeks. */
export const LEAD_TIME_LIMIT_DAYS = 21;
export const LEAD_TIME_WARN_DAYS = 14;

export type CountRow = { key: string; label: string; count: number };

export type SegmentGoRow = { segment: string; label: string; total: number; go: number; review: number; noGo: number; goPct: number | null };

export type ActivitySummary = {
  /** Distinct contacts approached by phone, mail or LinkedIn. */
  approached: number;
  called: number;
  reached: number;
  /** Distinct contacts reached by phone or that replied. */
  reachedContacts: number;
  mailed: number;
  replies: number;
  positiveReplies: number;
  meetingsApproved: number;
  meetingsRejected: number;
};

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
  activity: ActivitySummary;
  meetings: number;
  funnel: CountRow[];
  attribution: { bySignal: CountRow[]; bySegment: CountRow[]; byChannel: CountRow[] };
  leadTimes: LeadTimeRow[];
  warnings: string[];
};

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

const reachedOnPhone: ActivityOutcome[] = [
  "bereikt",
  "terugbellen",
  "afspraak",
  "afspraak_goedgekeurd",
  "afspraak_afgekeurd",
  "niet_geinteresseerd",
];
const replyOutcomes: ActivityOutcome[] = ["reply_positief", "reply_neutraal", "reply_negatief"];
const outboundChannels: ActivityChannel[] = ["bellen", "mail", "linkedin"];

export type ActivityFact = { contact_id: string | null; channel: ActivityChannel; outcome: ActivityOutcome };

export function summarizeActivities(rows: ActivityFact[]): ActivitySummary {
  const approached = new Set<string>();
  const reachedContacts = new Set<string>();
  const summary: ActivitySummary = {
    approached: 0,
    called: 0,
    reached: 0,
    reachedContacts: 0,
    mailed: 0,
    replies: 0,
    positiveReplies: 0,
    meetingsApproved: 0,
    meetingsRejected: 0,
  };
  for (const row of rows) {
    if (row.outcome === "notitie") continue;
    const isOutbound = outboundChannels.includes(row.channel) && row.outcome !== "bounce" && row.outcome !== "afgemeld";
    if (isOutbound && row.contact_id) approached.add(row.contact_id);
    // "verstuurd" on the phone channel means "put on a Web Partners call
    // list" (it starts the 30-day rule); only real call outcomes count as called.
    if (row.channel === "bellen" && row.outcome !== "verstuurd") {
      summary.called += 1;
      if (reachedOnPhone.includes(row.outcome)) {
        summary.reached += 1;
        if (row.contact_id) reachedContacts.add(row.contact_id);
      }
    }
    if (row.channel === "mail" && row.outcome === "verstuurd") summary.mailed += 1;
    if (replyOutcomes.includes(row.outcome)) {
      summary.replies += 1;
      if (row.contact_id) reachedContacts.add(row.contact_id);
    }
    if (row.outcome === "reply_positief") summary.positiveReplies += 1;
    if (row.outcome === "afspraak_goedgekeurd") summary.meetingsApproved += 1;
    if (row.outcome === "afspraak_afgekeurd") summary.meetingsRejected += 1;
  }
  summary.approached = approached.size;
  summary.reachedContacts = reachedContacts.size;
  return summary;
}

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
  return segment ? optionFor(segments, segment).label : "Geen segment";
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
      (k) => (k === "onbekend" ? "Geen signaal" : (signalTypes.find((s) => s.value === k)?.label ?? k)),
    ),
    bySegment: countBy(
      rows,
      (r) => r.segment ?? "onbekend",
      (k) => (k === "onbekend" ? "Geen segment" : segmentLabel(k as Segment)),
    ),
    byChannel: countBy(
      rows,
      (r) => r.channel,
      (k) => optionFor(activityChannels, k as ActivityChannel).label,
    ),
  };
}

export function buildFunnel(activity: ActivitySummary, meetings: number): CountRow[] {
  return [
    { key: "benaderd", label: "Benaderd", count: activity.approached },
    { key: "bereikt", label: "Bereikt", count: activity.reachedContacts },
    { key: "replies", label: "Replies", count: activity.replies },
    { key: "afspraken", label: "Afspraken", count: meetings },
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
};

function wholeDays(from: string, to: Date) {
  return Math.max(0, Math.floor((to.getTime() - new Date(from).getTime()) / 86_400_000));
}

/**
 * Lead time per open vacancy (T6). The clock runs from intake (else the
 * opening date) until profiles are sent: warn from 14 days, alarm from 21.
 */
export function leadTimeRows(vacancies: VacancyFact[], now = new Date()): LeadTimeRow[] {
  return vacancies
    .filter((v) => v.talent_stage !== "geplaatst" && v.talent_stage !== "gesloten")
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
      const who = r.company ? `${r.title} bij ${r.company}` : r.title;
      return r.level === "over"
        ? `${who} loopt al ${r.days} dagen zonder verstuurde profielen. De belofte van 3 weken is voorbij.`
        : `${who} loopt ${r.days} dagen zonder verstuurde profielen. Nog ${LEAD_TIME_LIMIT_DAYS - r.days} dagen tot 3 weken.`;
    });
}

// ---------------------------------------------------------------------------
// Periods (Amsterdam time)
// ---------------------------------------------------------------------------

export const reportPeriods = [
  { value: "deze-week", label: "Deze week" },
  { value: "vorige-week", label: "Vorige week" },
  { value: "30-dagen", label: "Laatste 30 dagen" },
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
  const [newCompanies, qualified, activities, attribution, vacancies] = await Promise.all([
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
    fetchAll((a, b) =>
      db
        .from("activities")
        .select("contact_id, channel, outcome")
        .gte("date", from)
        .lt("date", to)
        .order("id")
        .range(a, b),
    ),
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
          "id, title, talent_stage, opened_at, intake_at, profiles_sent_at, first_interview_at, start_at, client:clients(name), company:companies(name)",
        )
        .not("talent_stage", "in", "(geplaatst,gesloten)")
        .in("status", ["open", "on_hold"])
        .order("id")
        .range(a, b),
    ),
  ]);

  const activity = summarizeActivities(activities);
  const meetings = attribution.length;
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
    })),
    now,
  );

  return {
    period: { from, to },
    newCompanies,
    goPerSegment: goPerSegment(qualified),
    activity,
    meetings,
    funnel: buildFunnel(activity, meetings),
    attribution: attributionBreakdown(attribution),
    leadTimes,
    warnings: leadTimeWarnings(leadTimes),
  };
}

// ---------------------------------------------------------------------------
// Mail (S10)
// ---------------------------------------------------------------------------

const navy = "#0a1a2f";
const saffron = "#f2a33a";
const saffronDark = "#d9871a";
const muted = "#5b6b80";
const line = "#e3ecf8";

function esc(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function formatDay(value: string | null) {
  if (!value) return "";
  return new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "short", timeZone: "Europe/Amsterdam" }).format(new Date(value));
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
  return `Nordavo weekrapport ${formatDay(report.period.from)} tot ${formatDay(report.period.to)}: ${report.meetings} afspraken`;
}

/** The weekly report as a mail with inline styles. Warnings first. */
export function renderReportHtml(report: WeeklyReport, portalUrl?: string): string {
  const a = report.activity;
  const stats: [string, number][] = [
    ["Nieuwe bedrijven", report.newCompanies],
    ["Gebeld", a.called],
    ["Bereikt", a.reached],
    ["Gemaild", a.mailed],
    ["Replies", a.replies],
    ["Positieve replies", a.positiveReplies],
    ["Afspraken", report.meetings],
  ];
  const statCells = stats
    .map(
      ([label, value]) =>
        `<td style="padding:12px;border:1px solid ${line};border-radius:8px;text-align:center;width:14%"><div style="font-size:24px;font-weight:700;color:${navy}">${value}</div><div style="font-size:12px;color:${muted}">${esc(label)}</div></td>`,
    )
    .join("");

  const warnings = report.warnings.length
    ? `<div style="background:#fdf0dc;border-left:4px solid ${saffronDark};padding:12px 16px;margin:0 0 20px;border-radius:4px"><p style="margin:0 0 6px;font-weight:700;color:${navy}">Let op</p><ul style="margin:0;padding-left:18px;color:${navy};font-size:14px">${report.warnings
        .map((w) => `<li style="margin:2px 0">${esc(w)}</li>`)
        .join("")}</ul></div>`
    : "";

  return `<!doctype html><html lang="nl"><body style="margin:0;padding:0;background:#f2f6fc;font-family:Arial,Helvetica,sans-serif">
<div style="max-width:680px;margin:0 auto;padding:24px 16px">
<div style="background:${navy};color:#ffffff;padding:20px 24px;border-radius:12px 12px 0 0;border-bottom:4px solid ${saffron}">
<p style="margin:0;font-size:12px;letter-spacing:1px;text-transform:uppercase;color:${saffron}">Weekrapport</p>
<h1 style="margin:4px 0 0;font-size:22px">${esc(formatDay(report.period.from))} tot ${esc(formatDay(report.period.to))}</h1>
</div>
<div style="background:#ffffff;padding:24px;border-radius:0 0 12px 12px">
${warnings}
<table role="presentation" cellspacing="6" cellpadding="0" style="width:100%;margin:0 0 8px"><tr>${statCells}</tr></table>
${a.meetingsApproved || a.meetingsRejected ? `<p style="margin:0 0 8px;font-size:13px;color:${muted}">Na de call: ${a.meetingsApproved} goedgekeurd, ${a.meetingsRejected} afgekeurd.</p>` : ""}
${heading("GO percentage per segment")}
${table(
  ["Segment", "Beoordeeld", "GO", "Review", "No go", "GO %"],
  report.goPerSegment.map((s) => [s.label, s.total, s.go, s.review, s.noGo, s.goPct === null ? "" : `${s.goPct}%`]),
  "Deze week zijn geen bedrijven beoordeeld.",
)}
${heading("Funnel")}
${table(["Stap", "Aantal"], report.funnel.map((f) => [f.label, f.count]), "Geen activiteit.")}
${heading("Afspraken per signaal")}
${table(["Signaal", "Afspraken"], report.attribution.bySignal.map((r) => [r.label, r.count]), "Geen afspraken deze periode.")}
${heading("Afspraken per segment")}
${table(["Segment", "Afspraken"], report.attribution.bySegment.map((r) => [r.label, r.count]), "Geen afspraken deze periode.")}
${heading("Afspraken per kanaal")}
${table(["Kanaal", "Afspraken"], report.attribution.byChannel.map((r) => [r.label, r.count]), "Geen afspraken deze periode.")}
${heading("Doorlooptijd open vacatures")}
${table(
  ["Vacature", "Fase", "Dagen", "Profielen", "1e gesprek", "Start"],
  report.leadTimes.map((v) => [
    v.company ? `${v.title} (${v.company})` : v.title,
    v.stageLabel,
    v.level === "over" ? `${v.days} (te lang)` : v.level === "bijna" ? `${v.days} (bijna 3 weken)` : v.days,
    v.profilesSentAt ? formatDay(v.profilesSentAt) : "nog niet",
    formatDay(v.firstInterviewAt),
    formatDay(v.startAt),
  ]),
  "Geen open vacatures.",
)}
${portalUrl ? `<p style="margin:24px 0 0"><a href="${esc(portalUrl)}" style="display:inline-block;background:${saffron};color:${navy};padding:10px 18px;border-radius:8px;font-weight:700;text-decoration:none">Bekijk het rapport in de portal</a></p>` : ""}
</div>
</div></body></html>`;
}
