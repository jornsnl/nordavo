import Link from "next/link";
import { AlertTriangle, BadgeCheck, BarChart3, Building2, CalendarCheck, Mail, MessageSquare, Phone, PhoneCall } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { MobileList, MobileListItem } from "@/components/ui/mobile-list";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatCurrency, formatDate } from "@/lib/format";
import type { CountRow, LeadTimeRow, WeeklyReport } from "@/lib/gtm/report";
import type { CallerFigures } from "@/lib/sales/stats";

export function WarningsBanner({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null;
  return (
    <section
      aria-labelledby="report-warnings"
      className="mb-8 rounded-2xl border border-accent-500/40 bg-accent-100 px-5 py-4"
    >
      <h2 id="report-warnings" className="flex items-center gap-2 font-display font-semibold text-brand-900">
        <AlertTriangle className="size-5 text-accent-600" aria-hidden="true" />
        Heads up: lead time
      </h2>
      <ul className="mt-2 list-disc space-y-1 pl-6 text-sm text-brand-900">
        {warnings.map((warning) => (
          <li key={warning}>{warning}</li>
        ))}
      </ul>
    </section>
  );
}

export function ReportStatCards({ report }: { report: WeeklyReport }) {
  const a = report.activity;
  const m = report.meetings;
  const cards = [
    { label: "New companies", value: report.newCompanies, icon: Building2 },
    { label: "Calls", value: a.calls, icon: Phone },
    { label: "Reached", value: a.reached, icon: PhoneCall },
    { label: "Mails", value: a.mails, icon: Mail },
    { label: "Replies", value: a.replies, icon: MessageSquare },
    { label: "Meetings planned", value: m.planned, icon: CalendarCheck },
    { label: "Meetings approved", value: m.approved, icon: BadgeCheck },
  ];
  return (
    <section aria-labelledby="report-stats" className="mb-8">
      <h2 id="report-stats" className="sr-only">
        Key figures
      </h2>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-7">
        {cards.map(({ label, value, icon: Icon }) => (
          <li
            key={label}
            className="flex flex-col rounded-2xl border border-border bg-card p-4 shadow-xs max-sm:p-3 max-sm:last:col-span-2"
          >
            <span className="mb-3 flex size-9 items-center justify-center rounded-xl bg-brand-50 text-brand-600 max-sm:hidden">
              <Icon className="size-4" aria-hidden="true" />
            </span>
            <span className="text-sm text-muted">{label}</span>
            <span className="mt-1 font-display text-2xl font-bold text-brand-900 tabular-nums">{value}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-sm text-muted">
        {a.positiveReplies} positive {a.positiveReplies === 1 ? "reply" : "replies"}
        {a.pendingReplies > 0 ? `, ${a.pendingReplies} still to review` : ""}. LinkedIn messages: {a.linkedin}. Meetings:{" "}
        {m.held} held, {m.rejected} rejected, {m.noShow} no show, {m.cancelled} cancelled. Fees of approved meetings:{" "}
        {formatCurrency(m.fees)}.
      </p>
    </section>
  );
}

/** Companies per pipeline stage right now, and what moved in the period. */
export function PipelineCard({ report }: { report: WeeklyReport }) {
  const p = report.pipeline;
  const max = Math.max(1, ...p.perStage.map((s) => s.count));
  return (
    <section aria-labelledby="report-pipeline" className="mb-8">
      <Card>
        <CardHeader
          title={<span id="report-pipeline">Pipeline</span>}
          description={`Companies per stage right now. This period: ${p.enteredInPeriod} into the pipeline, ${p.wonInPeriod} won, ${p.lostInPeriod} lost.`}
          actions={
            <Link href="/dashboard/pipeline" className="text-sm font-semibold text-brand-600 hover:text-brand-800 pointer-coarse:min-h-11 pointer-coarse:inline-flex pointer-coarse:items-center">
              Open the pipeline
            </Link>
          }
        />
        <dl className="grid gap-2.5 px-5 py-4 sm:grid-cols-2">
          {p.perStage.map((s) => (
            <div key={s.stage} className="grid grid-cols-[minmax(0,9rem)_1fr_2.5rem] items-center gap-3">
              <dt className="truncate text-sm text-muted">{s.label}</dt>
              <dd className="h-2.5 overflow-hidden rounded-full bg-brand-50" aria-hidden="true">
                <div
                  className={`h-full rounded-full ${s.stage === "won" ? "bg-emerald-500" : s.stage === "lost" ? "bg-slate-400" : "bg-brand-600"}`}
                  style={{ width: `${(s.count / max) * 100}%` }}
                />
              </dd>
              <dd className="text-right text-sm font-semibold text-ink tabular-nums">{s.count}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </section>
  );
}

/** Calls, reach and meetings per caller and team member in the period. */
export function PerCallerTable({ rows }: { rows: CallerFigures[] }) {
  return (
    <section aria-labelledby="report-callers" className="mb-8">
      <h2 id="report-callers" className="mb-1 font-display text-lg font-semibold text-brand-900">
        Per caller
      </h2>
      <p className="mb-4 text-sm text-muted">External callers and team members who called or booked meetings in this period.</p>
      {rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-brand-200 bg-card px-5 py-8 text-center text-sm text-muted">
          Nobody called in this period.
        </p>
      ) : (
        <>
          <MobileList label="Per caller" className="md:hidden">
            {rows.map((r) => (
              <MobileListItem
                key={r.key}
                title={r.name}
                subtitle={`${r.calls} calls, ${r.reached} reached`}
                meta={`${r.meetingsPlanned} meetings, ${r.meetingsApproved} approved, ${formatCurrency(r.fees)}`}
                trailing={<Badge tone={r.kind === "caller" ? "accent" : "brand"}>{r.kind === "caller" ? "Caller" : "Team"}</Badge>}
              />
            ))}
          </MobileList>
          <Table className="hidden md:block">
            <THead>
              <tr>
                <TH>Name</TH>
                <TH className="text-right">Calls</TH>
                <TH className="text-right">Reached</TH>
                <TH className="text-right">Meetings</TH>
                <TH className="text-right">Approved</TH>
                <TH className="text-right">Fees</TH>
              </tr>
            </THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.key}>
                  <TD>
                    <span className="font-medium">{r.name}</span>{" "}
                    <Badge tone={r.kind === "caller" ? "accent" : "brand"}>{r.kind === "caller" ? "Caller" : "Team"}</Badge>
                  </TD>
                  <TD className="text-right tabular-nums">{r.calls}</TD>
                  <TD className="text-right tabular-nums">{r.reached}</TD>
                  <TD className="text-right tabular-nums">{r.meetingsPlanned}</TD>
                  <TD className="text-right tabular-nums">{r.meetingsApproved}</TD>
                  <TD className="text-right tabular-nums">{formatCurrency(r.fees)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </>
      )}
    </section>
  );
}

export function GoPerSegmentCard({ report }: { report: WeeklyReport }) {
  return (
    <Card>
      <CardHeader title="GO percentage per segment" description="Companies reviewed in this period." />
      {report.goPerSegment.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted">No companies were reviewed in this period.</p>
      ) : (
        <dl className="space-y-4 px-5 py-4">
          {report.goPerSegment.map((row) => (
            <div key={row.segment}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <dt className="font-medium text-ink">{row.label}</dt>
                <dd className="text-muted tabular-nums">
                  <span className="font-semibold text-brand-900">{row.goPct ?? 0}%</span> GO, {row.go} of {row.total}
                </dd>
              </div>
              <div className="mt-1.5 flex h-2.5 overflow-hidden rounded-full bg-brand-50" aria-hidden="true">
                <div className="h-full bg-emerald-500" style={{ width: `${(row.go / row.total) * 100}%` }} />
                <div className="h-full bg-amber-400" style={{ width: `${(row.review / row.total) * 100}%` }} />
              </div>
              {row.review > 0 && <p className="mt-1 text-xs text-muted">{row.review} awaiting review</p>}
            </div>
          ))}
        </dl>
      )}
    </Card>
  );
}

export function FunnelCard({ funnel }: { funnel: CountRow[] }) {
  const max = Math.max(1, ...funnel.map((f) => f.count));
  return (
    <Card>
      <CardHeader title="Funnel" description="Unique contacts approached and reached, all replies and meetings." />
      <dl className="space-y-2.5 px-5 py-4">
        {funnel.map((step, i) => (
          <div key={step.key} className="grid grid-cols-[minmax(0,6.5rem)_1fr_2.5rem] items-center gap-3">
            <dt className="truncate text-sm text-muted">{step.label}</dt>
            <dd className="h-2.5 overflow-hidden rounded-full bg-brand-50" aria-hidden="true">
              <div
                className={`h-full rounded-full ${i === funnel.length - 1 ? "bg-accent-500" : "bg-brand-600"}`}
                style={{ width: `${(step.count / max) * 100}%` }}
              />
            </dd>
            <dd className="text-right text-sm font-semibold text-ink tabular-nums">{step.count}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

function AttributionTable({ title, column, rows }: { title: string; column: string; rows: CountRow[] }) {
  const total = rows.reduce((sum, r) => sum + r.count, 0);
  return (
    <Card>
      <CardHeader title={title} />
      {rows.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted">No meetings in this period.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border bg-surface/60 text-xs font-semibold tracking-wide text-muted uppercase">
            <tr>
              <th scope="col" className="px-5 py-2.5 font-semibold">
                {column}
              </th>
              <th scope="col" className="px-5 py-2.5 text-right font-semibold">
                Meetings
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => (
              <tr key={row.key}>
                <td className="px-5 py-2.5 text-ink">{row.label}</td>
                <td className="px-5 py-2.5 text-right text-ink tabular-nums">
                  <span className="font-semibold">{row.count}</span>
                  <span className="ml-2 text-xs text-muted">{Math.round((row.count / total) * 100)}%</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

export function AttributionTables({ report }: { report: WeeklyReport }) {
  return (
    <section aria-labelledby="report-attribution" className="mb-8">
      <h2 id="report-attribution" className="mb-1 font-display text-lg font-semibold text-brand-900">
        Where the meetings come from
      </h2>
      <p className="mb-4 text-sm text-muted">
        For each meeting the signal, segment and channel that produced it. Channel is the last touch before the meeting.
      </p>
      <div className="grid gap-6 lg:grid-cols-3">
        <AttributionTable title="By signal" column="Signal" rows={report.attribution.bySignal} />
        <AttributionTable title="By segment" column="Segment" rows={report.attribution.bySegment} />
        <AttributionTable title="By channel" column="Channel" rows={report.attribution.byChannel} />
      </div>
    </section>
  );
}

const levelBadge = {
  ok: { tone: "success" as const, label: "On track" },
  bijna: { tone: "warning" as const, label: "Nearing 3 weeks" },
  over: { tone: "danger" as const, label: "Over 3 weeks" },
};

function Milestone({ value }: { value: string | null }) {
  return value ? <>{formatDate(value)}</> : <span className="text-muted">Not yet</span>;
}

export function LeadTimeTable({ rows }: { rows: LeadTimeRow[] }) {
  return (
    <section aria-labelledby="report-leadtime">
      <h2 id="report-leadtime" className="mb-1 font-display text-lg font-semibold text-brand-900">
        Lead time of open vacancies
      </h2>
      <p className="mb-4 text-sm text-muted">
        Days since the intake, or since the vacancy opened. The promise: profiles within 3 weeks.
      </p>
      {rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-brand-200 bg-card px-5 py-8 text-center text-sm text-muted">
          There are no open vacancies right now.
        </p>
      ) : (
        <>
          <MobileList label="Open vacancies" className="md:hidden">
            {rows.map((row) => (
              <MobileListItem
                key={row.vacancyId}
                href={`/dashboard/vacancies/${row.vacancyId}`}
                title={row.title}
                subtitle={[row.company, row.stageLabel].filter(Boolean).join(", ")}
                meta={
                  row.profilesSentAt
                    ? `Profiles on ${formatDate(row.profilesSentAt)}${row.daysToProfiles !== null ? `, after ${row.daysToProfiles} days` : ""}`
                    : `Intake ${formatDate(row.startedAt)}, no profiles yet`
                }
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-ink tabular-nums">{row.days} days</span>
                  {!row.profilesSentAt && <Badge tone={levelBadge[row.level].tone}>{levelBadge[row.level].label}</Badge>}
                </span>
              </MobileListItem>
            ))}
          </MobileList>
          <Table className="hidden md:block">
            <THead>
              <tr>
                <TH>Vacancy</TH>
                <TH>Stage</TH>
                <TH className="text-right">Days</TH>
                <TH>Intake</TH>
                <TH>Profiles</TH>
                <TH>First interview</TH>
                <TH>Start</TH>
              </tr>
            </THead>
            <TBody>
              {rows.map((row) => (
                <TR key={row.vacancyId}>
                  <TD>
                    <Link
                      href={`/dashboard/vacancies/${row.vacancyId}`}
                      className="font-medium text-brand-900 hover:text-brand-600 hover:underline"
                    >
                      {row.title}
                    </Link>
                    {row.company && <span className="block text-xs text-muted">{row.company}</span>}
                  </TD>
                  <TD>{row.stageLabel}</TD>
                  <TD className="text-right">
                    <span className="flex flex-col items-end gap-1">
                      <span className="font-semibold tabular-nums">{row.days}</span>
                      {!row.profilesSentAt && <Badge tone={levelBadge[row.level].tone}>{levelBadge[row.level].label}</Badge>}
                    </span>
                  </TD>
                  <TD className="whitespace-nowrap">{formatDate(row.startedAt)}</TD>
                  <TD className="whitespace-nowrap">
                    <Milestone value={row.profilesSentAt} />
                    {row.daysToProfiles !== null && (
                      <span className="block text-xs text-muted">after {row.daysToProfiles} days</span>
                    )}
                  </TD>
                  <TD className="whitespace-nowrap">
                    <Milestone value={row.firstInterviewAt} />
                  </TD>
                  <TD className="whitespace-nowrap">
                    <Milestone value={row.startAt} />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </>
      )}
    </section>
  );
}

export function EmptyReportHint() {
  return (
    <p className="mb-8 flex items-center gap-2 rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-900">
      <BarChart3 className="size-4 shrink-0 text-brand-600" aria-hidden="true" />
      No activity in this period yet. The figures fill in as soon as calls, emails or meetings are logged.
    </p>
  );
}

export function ReportSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading report">
      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-7">
        {Array.from({ length: 7 }, (_, i) => (
          <Skeleton key={i} className="h-28 w-full rounded-2xl" />
        ))}
      </div>
      <div className="mb-8 grid gap-6 lg:grid-cols-2">
        <Skeleton className="h-56 w-full rounded-2xl" />
        <Skeleton className="h-56 w-full rounded-2xl" />
      </div>
      <Skeleton className="h-64 w-full rounded-2xl" />
    </div>
  );
}
