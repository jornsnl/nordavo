import Link from "next/link";
import { AlertTriangle, BarChart3, Building2, CalendarCheck, Mail, MessageSquare, Phone, PhoneCall, ThumbsUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatDate } from "@/lib/format";
import type { CountRow, LeadTimeRow, WeeklyReport } from "@/lib/gtm/report";

export function WarningsBanner({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null;
  return (
    <section
      aria-labelledby="report-warnings"
      className="mb-8 rounded-2xl border border-accent-500/40 bg-accent-100 px-5 py-4"
    >
      <h2 id="report-warnings" className="flex items-center gap-2 font-display font-semibold text-brand-900">
        <AlertTriangle className="size-5 text-accent-600" aria-hidden="true" />
        Let op: doorlooptijd
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
  const cards = [
    { label: "Nieuwe bedrijven", value: report.newCompanies, icon: Building2 },
    { label: "Gebeld", value: a.called, icon: Phone },
    { label: "Bereikt", value: a.reached, icon: PhoneCall },
    { label: "Gemaild", value: a.mailed, icon: Mail },
    { label: "Replies", value: a.replies, icon: MessageSquare },
    { label: "Positieve replies", value: a.positiveReplies, icon: ThumbsUp },
    { label: "Afspraken", value: report.meetings, icon: CalendarCheck },
  ];
  return (
    <section aria-labelledby="report-stats" className="mb-8">
      <h2 id="report-stats" className="sr-only">
        Kerncijfers
      </h2>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-7">
        {cards.map(({ label, value, icon: Icon }) => (
          <li key={label} className="flex flex-col rounded-2xl border border-border bg-card p-4 shadow-xs">
            <span className="mb-3 flex size-9 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
              <Icon className="size-4" aria-hidden="true" />
            </span>
            <span className="text-sm text-muted">{label}</span>
            <span className="mt-1 font-display text-2xl font-bold text-brand-900 tabular-nums">{value}</span>
          </li>
        ))}
      </ul>
      {(a.meetingsApproved > 0 || a.meetingsRejected > 0) && (
        <p className="mt-3 text-sm text-muted">
          Afspraken na de call beoordeeld: {a.meetingsApproved} goedgekeurd, {a.meetingsRejected} afgekeurd.
        </p>
      )}
    </section>
  );
}

export function GoPerSegmentCard({ report }: { report: WeeklyReport }) {
  return (
    <Card>
      <CardHeader title="GO percentage per segment" description="Bedrijven die in deze periode zijn beoordeeld." />
      {report.goPerSegment.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted">In deze periode zijn geen bedrijven beoordeeld.</p>
      ) : (
        <dl className="space-y-4 px-5 py-4">
          {report.goPerSegment.map((row) => (
            <div key={row.segment}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <dt className="font-medium text-ink">{row.label}</dt>
                <dd className="text-muted tabular-nums">
                  <span className="font-semibold text-brand-900">{row.goPct ?? 0}%</span> GO, {row.go} van {row.total}
                </dd>
              </div>
              <div className="mt-1.5 flex h-2.5 overflow-hidden rounded-full bg-brand-50" aria-hidden="true">
                <div className="h-full bg-emerald-500" style={{ width: `${(row.go / row.total) * 100}%` }} />
                <div className="h-full bg-amber-400" style={{ width: `${(row.review / row.total) * 100}%` }} />
              </div>
              {row.review > 0 && <p className="mt-1 text-xs text-muted">{row.review} wachten op review</p>}
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
      <CardHeader title="Funnel" description="Unieke contacten benaderd en bereikt, alle replies en afspraken." />
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
        <p className="px-5 py-6 text-sm text-muted">Geen afspraken in deze periode.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border bg-surface/60 text-xs font-semibold tracking-wide text-muted uppercase">
            <tr>
              <th scope="col" className="px-5 py-2.5 font-semibold">
                {column}
              </th>
              <th scope="col" className="px-5 py-2.5 text-right font-semibold">
                Afspraken
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
        Waar komen de afspraken vandaan
      </h2>
      <p className="mb-4 text-sm text-muted">
        Per afspraak het signaal, segment en kanaal dat hem opleverde. Kanaal is de laatste benadering voor de afspraak.
      </p>
      <div className="grid gap-6 lg:grid-cols-3">
        <AttributionTable title="Per signaal" column="Signaal" rows={report.attribution.bySignal} />
        <AttributionTable title="Per segment" column="Segment" rows={report.attribution.bySegment} />
        <AttributionTable title="Per kanaal" column="Kanaal" rows={report.attribution.byChannel} />
      </div>
    </section>
  );
}

const levelBadge = {
  ok: { tone: "success" as const, label: "Op schema" },
  bijna: { tone: "warning" as const, label: "Richting 3 weken" },
  over: { tone: "danger" as const, label: "Over 3 weken" },
};

function Milestone({ value }: { value: string | null }) {
  return value ? <>{formatDate(value)}</> : <span className="text-muted">Nog niet</span>;
}

export function LeadTimeTable({ rows }: { rows: LeadTimeRow[] }) {
  return (
    <section aria-labelledby="report-leadtime">
      <h2 id="report-leadtime" className="mb-1 font-display text-lg font-semibold text-brand-900">
        Doorlooptijd open vacatures
      </h2>
      <p className="mb-4 text-sm text-muted">
        Dagen sinds de intake, of sinds de vacature openging. De belofte: profielen binnen 3 weken.
      </p>
      {rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-brand-200 bg-card px-5 py-8 text-center text-sm text-muted">
          Er staan nu geen open vacatures.
        </p>
      ) : (
        <Table>
          <THead>
            <tr>
              <TH>Vacature</TH>
              <TH>Fase</TH>
              <TH className="text-right">Dagen</TH>
              <TH>Intake</TH>
              <TH>Profielen</TH>
              <TH>Eerste gesprek</TH>
              <TH>Start</TH>
            </tr>
          </THead>
          <TBody>
            {rows.map((row) => (
              <TR key={row.vacancyId}>
                <TD>
                  <Link
                    href={`/dashboard/vacatures/${row.vacancyId}`}
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
                    <span className="block text-xs text-muted">na {row.daysToProfiles} dagen</span>
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
      )}
    </section>
  );
}

export function EmptyReportHint() {
  return (
    <p className="mb-8 flex items-center gap-2 rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-900">
      <BarChart3 className="size-4 shrink-0 text-brand-600" aria-hidden="true" />
      Nog geen activiteit in deze periode. De cijfers vullen zich zodra er gebeld, gemaild of afspraken geboekt worden.
    </p>
  );
}

export function ReportSkeleton() {
  return (
    <div aria-busy="true" aria-label="Rapport laden">
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
