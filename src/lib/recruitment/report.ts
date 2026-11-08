import type { ApplicationStage, CandidateOrigin, CandidateSource } from "@/lib/database.types";
import { applicationStages, candidateOrigins, candidateSources } from "@/lib/labels";

/**
 * Recruitment report (recruitment brief 2.16 and 2.6.4.3): the hiring report
 * Judith kept in Excel, from the pipeline itself. Pure functions over rows
 * the page loads (src/lib/recruitment/report-data.ts), so they are unit
 * tested in tests/recruitment-report.test.ts. Talent pool vacancies are left
 * out by the loader.
 */

export const FLOW: ApplicationStage[] = [
  "sourced",
  "techstack_check",
  "fill_out",
  "video_review",
  "technical_test",
  "interview",
  "matched",
  "client_interview",
  "final_screening",
  "placed",
];

export type ReportApplication = {
  id: string;
  vacancy_id: string;
  source: CandidateSource | null;
  origin: CandidateOrigin;
  stage: ApplicationStage;
  exit_from_stage: ApplicationStage | null;
  form_completed_at: string | null;
  cv_score: number | null;
  rejection_reason: string | null;
  park_reason: string | null;
  created_at: string;
};

export type ReportEvent = { application_id: string; to_stage: ApplicationStage; created_at: string };

export type ReportVacancy = {
  id: string;
  title: string;
  client: string | null;
  status: string;
  opened_at: string;
  closed_at: string | null;
};

export type CountRow = { key: string; label: string; count: number; pct: number | null };
export type FunnelStep = { key: FunnelKey; label: string; count: number; conversion: number | null; pctOfTotal: number | null };
export type StageTime = { stage: ApplicationStage; label: string; avgDays: number; medianDays: number; count: number };
export type ReasonRow = { reason: string; count: number };
export type VacancyRow = {
  id: string;
  title: string;
  client: string | null;
  status: string;
  daysOpen: number;
  applicants: number;
  headhunted: number;
  formFilled: number;
  interview: number;
  matched: number;
  placed: number;
};

export type RecruitmentReport = {
  totals: { applicants: number; applied: number; headhunted: number; active: number; parked: number; rejected: number; placed: number };
  bySource: CountRow[];
  byOrigin: CountRow[];
  funnel: FunnelStep[];
  funnelByOrigin: Record<CandidateOrigin, FunnelStep[]>;
  stageTimes: StageTime[];
  parked: { count: number; reasons: ReasonRow[] };
  rejected: { count: number; reasons: ReasonRow[] };
  cvScores: { scored: number; average: number | null; buckets: CountRow[] };
  vacancies: VacancyRow[];
};

// ---------------------------------------------------------------------------
// Funnel
// ---------------------------------------------------------------------------

export const funnelSteps = [
  { key: "applicants", label: "Applicants" },
  { key: "form_filled", label: "Form filled" },
  { key: "video_review", label: "Video review" },
  { key: "technical_test", label: "Technical test" },
  { key: "interview", label: "Interview" },
  { key: "matched", label: "Matched to client" },
  { key: "placed", label: "Placed" },
] as const;
export type FunnelKey = (typeof funnelSteps)[number]["key"];

const rank = (stage: ApplicationStage | null | undefined) => (stage ? FLOW.indexOf(stage) : -1);

/**
 * The furthest flow stage an application reached: the highest of every stage
 * in its history, its current stage and the stage a parked or rejected card
 * left. Skipping a stage counts as passing it.
 */
export function furthestStage(application: ReportApplication, events: ReportEvent[] = []): number {
  let best = Math.max(rank(application.stage), rank(application.exit_from_stage));
  for (const event of events) best = Math.max(best, rank(event.to_stage));
  return best;
}

/** Whether an application reached a funnel step. Form filled is the form itself (form_completed_at). */
export function reachedStep(key: FunnelKey, application: ReportApplication, furthest: number): boolean {
  switch (key) {
    case "applicants":
      return true;
    case "form_filled":
      return application.form_completed_at !== null;
    default:
      return furthest >= FLOW.indexOf(key);
  }
}

function pct(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;
}

export function buildFunnel(applications: ReportApplication[], eventsByApp: Map<string, ReportEvent[]>): FunnelStep[] {
  const furthest = applications.map((a) => furthestStage(a, eventsByApp.get(a.id)));
  const counts = funnelSteps.map((step) => applications.filter((a, i) => reachedStep(step.key, a, furthest[i])).length);
  return funnelSteps.map((step, i) => ({
    key: step.key,
    label: step.label,
    count: counts[i],
    conversion: i === 0 ? null : pct(counts[i], counts[i - 1]),
    pctOfTotal: pct(counts[i], counts[0]),
  }));
}

// ---------------------------------------------------------------------------
// Breakdowns
// ---------------------------------------------------------------------------

export function countBy<T extends string>(
  values: (T | null)[],
  options: { value: T; label: string }[],
  unknownLabel = "Unknown",
): CountRow[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value ?? "", (counts.get(value ?? "") ?? 0) + 1);
  const total = values.length;
  return [...counts.entries()]
    .map(([key, count]) => ({
      key: key || "unknown",
      label: key ? (options.find((o) => o.value === key)?.label ?? key) : unknownLabel,
      count,
      pct: pct(count, total),
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** Most given reasons, case and spacing insensitive, at most `limit`. */
export function topReasons(reasons: (string | null)[], limit = 5): ReasonRow[] {
  const groups = new Map<string, { reason: string; count: number }>();
  for (const raw of reasons) {
    const reason = raw?.trim().replace(/\s+/g, " ");
    const key = reason ? reason.toLowerCase().replace(/[.!]+$/, "") : "";
    const entry = groups.get(key) ?? { reason: reason || "No reason given", count: 0 };
    entry.count += 1;
    groups.set(key, entry);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)).slice(0, limit);
}

export const cvScoreBuckets = [
  { key: "0-19", label: "0 to 19", min: 0, max: 19 },
  { key: "20-39", label: "20 to 39", min: 20, max: 39 },
  { key: "40-59", label: "40 to 59", min: 40, max: 59 },
  { key: "60-79", label: "60 to 79", min: 60, max: 79 },
  { key: "80-100", label: "80 to 100", min: 80, max: 100 },
] as const;

export function cvScoreDistribution(scores: (number | null)[]) {
  const scored = scores.filter((s): s is number => typeof s === "number");
  return {
    scored: scored.length,
    average: scored.length > 0 ? Math.round(scored.reduce((sum, s) => sum + s, 0) / scored.length) : null,
    buckets: cvScoreBuckets.map((b) => {
      const count = scored.filter((s) => s >= b.min && s <= b.max).length;
      return { key: b.key, label: b.label, count, pct: pct(count, scored.length) };
    }),
  };
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

const DAY = 86_400_000;

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Days spent per flow stage, from the stage history: the time between
 * entering a stage and the next move. The stage an application is in now
 * counts until `now`. Placed has no duration.
 */
export function stageTimes(
  applications: ReportApplication[],
  eventsByApp: Map<string, ReportEvent[]>,
  now = new Date(),
): StageTime[] {
  const durations = new Map<ApplicationStage, number[]>();
  for (const application of applications) {
    const events = [...(eventsByApp.get(application.id) ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at));
    events.forEach((event, i) => {
      if (event.to_stage === "placed" || !FLOW.includes(event.to_stage)) return;
      const next = events[i + 1];
      if (!next && application.stage !== event.to_stage) return;
      const end = next ? new Date(next.created_at).getTime() : now.getTime();
      const days = Math.max(0, (end - new Date(event.created_at).getTime()) / DAY);
      durations.set(event.to_stage, [...(durations.get(event.to_stage) ?? []), days]);
    });
  }
  return FLOW.filter((stage) => durations.has(stage)).map((stage) => {
    const values = durations.get(stage)!;
    return {
      stage,
      label: applicationStages.find((s) => s.value === stage)?.label ?? stage,
      avgDays: round1(values.reduce((sum, d) => sum + d, 0) / values.length),
      medianDays: round1(median(values)),
      count: values.length,
    };
  });
}

/** Whole days a vacancy has been open: until it closed, or until today. */
export function daysOpen(vacancy: Pick<ReportVacancy, "opened_at" | "closed_at">, now = new Date()): number {
  const start = new Date(`${vacancy.opened_at.slice(0, 10)}T00:00:00Z`).getTime();
  const end = vacancy.closed_at ? new Date(`${vacancy.closed_at.slice(0, 10)}T00:00:00Z`).getTime() : now.getTime();
  return Math.max(0, Math.floor((end - start) / DAY));
}

// ---------------------------------------------------------------------------
// The whole report
// ---------------------------------------------------------------------------

export function groupEvents(events: ReportEvent[]): Map<string, ReportEvent[]> {
  const map = new Map<string, ReportEvent[]>();
  for (const event of events) map.set(event.application_id, [...(map.get(event.application_id) ?? []), event]);
  return map;
}

export function buildRecruitmentReport(
  {
    applications,
    events,
    vacancies,
  }: { applications: ReportApplication[]; events: ReportEvent[]; vacancies: ReportVacancy[] },
  now = new Date(),
): RecruitmentReport {
  const eventsByApp = groupEvents(events);
  const parked = applications.filter((a) => a.stage === "parked");
  const rejected = applications.filter((a) => a.stage === "rejected");
  const placed = applications.filter((a) => a.stage === "placed");
  const byOriginApps = (origin: CandidateOrigin) => applications.filter((a) => a.origin === origin);

  const perVacancy = new Map<string, ReportApplication[]>();
  for (const application of applications) {
    perVacancy.set(application.vacancy_id, [...(perVacancy.get(application.vacancy_id) ?? []), application]);
  }

  const vacancyRows: VacancyRow[] = vacancies
    .filter((v) => perVacancy.has(v.id) || v.status === "open")
    .map((v) => {
      const apps = perVacancy.get(v.id) ?? [];
      const funnel = buildFunnel(apps, eventsByApp);
      const step = (key: FunnelKey) => funnel.find((f) => f.key === key)?.count ?? 0;
      return {
        id: v.id,
        title: v.title,
        client: v.client,
        status: v.status,
        daysOpen: daysOpen(v, now),
        applicants: apps.length,
        headhunted: apps.filter((a) => a.origin === "headhunted").length,
        formFilled: step("form_filled"),
        interview: step("interview"),
        matched: step("matched"),
        placed: step("placed"),
      };
    })
    .sort((a, b) => b.applicants - a.applicants || b.daysOpen - a.daysOpen);

  return {
    totals: {
      applicants: applications.length,
      applied: byOriginApps("applied").length,
      headhunted: byOriginApps("headhunted").length,
      active: applications.length - parked.length - rejected.length - placed.length,
      parked: parked.length,
      rejected: rejected.length,
      placed: placed.length,
    },
    bySource: countBy(
      applications.map((a) => a.source),
      candidateSources,
    ),
    byOrigin: countBy(
      applications.map((a) => a.origin),
      candidateOrigins,
    ),
    funnel: buildFunnel(applications, eventsByApp),
    funnelByOrigin: {
      applied: buildFunnel(byOriginApps("applied"), eventsByApp),
      headhunted: buildFunnel(byOriginApps("headhunted"), eventsByApp),
    },
    stageTimes: stageTimes(applications, eventsByApp, now),
    parked: { count: parked.length, reasons: topReasons(parked.map((a) => a.park_reason)) },
    rejected: { count: rejected.length, reasons: topReasons(rejected.map((a) => a.rejection_reason)) },
    cvScores: cvScoreDistribution(applications.map((a) => a.cv_score)),
    vacancies: vacancyRows,
  };
}

// ---------------------------------------------------------------------------
// Periods and CSV
// ---------------------------------------------------------------------------

export const recruitmentPeriods = [
  { value: "30-days", label: "Last 30 days", days: 30 },
  { value: "90-days", label: "Last 90 days", days: 90 },
  { value: "12-months", label: "Last 12 months", days: 365 },
  { value: "all", label: "All time", days: null },
] as const;
export type RecruitmentPeriod = (typeof recruitmentPeriods)[number]["value"];

export function isRecruitmentPeriod(value: unknown): value is RecruitmentPeriod {
  return recruitmentPeriods.some((p) => p.value === value);
}

/** Start of the period (applications created on or after), null for all time. */
export function recruitmentPeriodStart(period: RecruitmentPeriod, now = new Date()): string | null {
  const days = recruitmentPeriods.find((p) => p.value === period)?.days ?? null;
  return days === null ? null : new Date(now.getTime() - days * DAY).toISOString();
}

export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  // Leading = + - @ would run as a formula in Excel.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function csvRow(cells: (string | number | null | undefined)[]) {
  return cells.map(csvCell).join(",");
}

/** The report as one CSV file, one block per section (for Excel). */
export function recruitmentReportCsv(report: RecruitmentReport, heading: string): string {
  const lines: string[] = [csvRow([heading]), ""];
  const t = report.totals;
  lines.push(csvRow(["Totals"]), csvRow(["Applicants", "Applied", "Headhunted", "Active", "Parked", "Rejected", "Placed"]));
  lines.push(csvRow([t.applicants, t.applied, t.headhunted, t.active, t.parked, t.rejected, t.placed]), "");

  lines.push(csvRow(["Funnel", "All", "Conversion %", "Applied", "Applied conversion %", "Headhunted", "Headhunted conversion %"]));
  report.funnel.forEach((step, i) => {
    const applied = report.funnelByOrigin.applied[i];
    const headhunted = report.funnelByOrigin.headhunted[i];
    lines.push(
      csvRow([step.label, step.count, step.conversion, applied.count, applied.conversion, headhunted.count, headhunted.conversion]),
    );
  });
  lines.push("");

  lines.push(csvRow(["Source", "Applicants", "%"]));
  for (const row of report.bySource) lines.push(csvRow([row.label, row.count, row.pct]));
  lines.push("");

  lines.push(csvRow(["Stage", "Average days", "Median days", "Applications"]));
  for (const row of report.stageTimes) lines.push(csvRow([row.label, row.avgDays, row.medianDays, row.count]));
  lines.push("");

  lines.push(csvRow(["Parked reason", "Count"]));
  for (const row of report.parked.reasons) lines.push(csvRow([row.reason, row.count]));
  lines.push("", csvRow(["Rejection reason", "Count"]));
  for (const row of report.rejected.reasons) lines.push(csvRow([row.reason, row.count]));
  lines.push("");

  lines.push(csvRow(["CV score", "Applications", "%"]));
  for (const row of report.cvScores.buckets) lines.push(csvRow([row.label, row.count, row.pct]));
  lines.push(csvRow(["Average", report.cvScores.average, null]), "");

  lines.push(
    csvRow(["Vacancy", "Client", "Status", "Days open", "Applicants", "Headhunted", "Form filled", "Interview", "Matched", "Placed"]),
  );
  for (const v of report.vacancies) {
    lines.push(csvRow([v.title, v.client, v.status, v.daysOpen, v.applicants, v.headhunted, v.formFilled, v.interview, v.matched, v.placed]));
  }
  return `${lines.join("\r\n")}\r\n`;
}
