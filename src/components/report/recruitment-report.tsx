import Link from "next/link";
import { Download } from "lucide-react";
import { buttonClasses } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { SearchSelect } from "@/components/ui/search-select";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { optionFor, vacancyStatuses } from "@/lib/labels";
import type { VacancyStatus } from "@/lib/database.types";
import {
  recruitmentPeriods,
  type CountRow,
  type FunnelStep,
  type ReasonRow,
  type RecruitmentPeriod,
  type RecruitmentReport,
  type ReportVacancy,
} from "@/lib/recruitment/report";

type Filters = { period: RecruitmentPeriod; vacancyId: string | null; salesPeriod?: string };

/** Query string of the report page for these filters (keeps the sales period). */
export function recruitmentQuery({ period, vacancyId, salesPeriod }: Filters) {
  const params = new URLSearchParams();
  if (salesPeriod) params.set("periode", salesPeriod);
  params.set("rperiod", period);
  if (vacancyId) params.set("vacancy", vacancyId);
  return params.toString();
}

function percent(value: number | null) {
  return value === null ? "n/a" : `${value}%`;
}

/** Recruitment section of the report page (2.16): the hiring report from the pipeline. */
export function RecruitmentReportSection({
  report,
  vacancies,
  filters,
}: {
  report: RecruitmentReport;
  vacancies: ReportVacancy[];
  filters: Filters;
}) {
  const selected = filters.vacancyId ? vacancies.find((v) => v.id === filters.vacancyId) : null;
  const t = report.totals;

  return (
    <section aria-labelledby="report-recruitment" className="mt-10">
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 id="report-recruitment" className="font-display text-lg font-semibold text-brand-900">
            Recruitment{selected ? `: ${selected.title}` : ""}
          </h2>
          <p className="text-sm text-muted">
            Applications that came in during the period, how far they got and where they came from. Talent pool
            vacancies are left out.
          </p>
        </div>
        <a
          href={`/dashboard/report/recruitment-csv?${recruitmentQuery(filters)}`}
          className={buttonClasses({ variant: "secondary", size: "sm" })}
        >
          <Download aria-hidden="true" />
          Download CSV
        </a>
      </div>

      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <nav aria-label="Recruitment period" className="inline-flex rounded-xl border border-border bg-card p-1 shadow-xs max-sm:flex max-sm:w-full">
          {recruitmentPeriods.map((p) => {
            const active = p.value === filters.period;
            return (
              <Link
                key={p.value}
                href={`/dashboard/report?${recruitmentQuery({ ...filters, period: p.value })}#report-recruitment`}
                aria-current={active ? "page" : undefined}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap transition max-sm:flex max-sm:min-h-10 max-sm:flex-1 max-sm:items-center max-sm:justify-center max-sm:px-1.5 max-sm:text-xs ${
                  active ? "bg-brand-900 text-white" : "text-muted hover:bg-brand-50 hover:text-brand-900"
                }`}
              >
                {p.label}
              </Link>
            );
          })}
        </nav>
        <form action="/dashboard/report" className="flex items-center gap-2 max-sm:w-full">
          {filters.salesPeriod && <input type="hidden" name="periode" value={filters.salesPeriod} />}
          <input type="hidden" name="rperiod" value={filters.period} />
          <label htmlFor="report-vacancy" className="sr-only">
            Vacancy
          </label>
          <SearchSelect
            id="report-vacancy"
            name="vacancy"
            defaultValue={filters.vacancyId ?? null}
            className="w-64 max-sm:w-full"
            placeholder="All vacancies"
            searchPlaceholder="Search vacancies"
            submitOnChange
            options={vacancies.map((v) => ({ value: v.id, label: v.title, hint: v.client ?? undefined }))}
          />
          <button type="submit" className={buttonClasses({ variant: "secondary", size: "sm" })}>
            Show
          </button>
        </form>
      </div>

      <ul className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
        {[
          { label: "Applicants", value: t.applicants },
          { label: "Applied", value: t.applied },
          { label: "Headhunted", value: t.headhunted },
          { label: "In process", value: t.active },
          { label: "Parked", value: t.parked },
          { label: "Rejected", value: t.rejected },
          { label: "Placed", value: t.placed },
        ].map((card) => (
          <li key={card.label} className="rounded-2xl border border-border bg-card p-4 shadow-xs">
            <span className="text-sm text-muted">{card.label}</span>
            <span className="mt-1 block font-display text-2xl font-bold text-brand-900 tabular-nums">{card.value}</span>
          </li>
        ))}
      </ul>

      {t.applicants === 0 ? (
        <p className="rounded-2xl border border-dashed border-brand-200 bg-card px-5 py-8 text-center text-sm text-muted">
          No applications in this period{selected ? " for this vacancy" : ""}.
        </p>
      ) : (
        <>
          <div className="mb-6 grid gap-6 lg:grid-cols-2">
            <FunnelBars title="Funnel" description="Stage reached, with the conversion from the step before." steps={report.funnel} />
            <OriginFunnels report={report} />
          </div>

          <div className="mb-6 grid gap-6 lg:grid-cols-3">
            <CountTable title="Per source" column="Source" rows={report.bySource} />
            <ReasonTable title="Parked" total={report.parked.count} rows={report.parked.reasons} />
            <ReasonTable title="Rejected" total={report.rejected.count} rows={report.rejected.reasons} />
          </div>

          <div className="mb-6 grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader title="Time in stage" description="Days between entering a stage and the next move." />
              {report.stageTimes.length === 0 ? (
                <p className="px-5 py-6 text-sm text-muted">No stage history yet.</p>
              ) : (
                <SimpleTable
                  head={["Stage", "Average", "Median", "Cards"]}
                  rows={report.stageTimes.map((s) => [s.label, `${s.avgDays} d`, `${s.medianDays} d`, s.count])}
                />
              )}
            </Card>
            <Card>
              <CardHeader
                title="CV score"
                description={
                  report.cvScores.scored > 0
                    ? `${report.cvScores.scored} scored, average ${report.cvScores.average}.`
                    : "No CV scores yet in this period."
                }
              />
              {report.cvScores.scored > 0 && (
                <SimpleTable
                  head={["Score", "Applications", "%"]}
                  rows={report.cvScores.buckets.map((b) => [b.label, b.count, percent(b.pct)])}
                />
              )}
            </Card>
          </div>
        </>
      )}

      {!selected && (
        <>
          <h3 className="mb-3 font-display text-base font-semibold text-brand-900">Per vacancy</h3>
          {report.vacancies.length === 0 ? (
            <p className="text-sm text-muted">No vacancies with applications in this period.</p>
          ) : (
            <Table>
              <THead>
                <tr>
                  <TH>Vacancy</TH>
                  <TH className="text-right">Days open</TH>
                  <TH className="text-right">Applicants</TH>
                  <TH className="text-right">Headhunted</TH>
                  <TH className="text-right">Form filled</TH>
                  <TH className="text-right">Interview</TH>
                  <TH className="text-right">Matched</TH>
                  <TH className="text-right">Placed</TH>
                </tr>
              </THead>
              <TBody>
                {report.vacancies.map((v) => (
                  <TR key={v.id}>
                    <TD>
                      <Link
                        href={`/dashboard/report?${recruitmentQuery({ ...filters, vacancyId: v.id })}#report-recruitment`}
                        className="font-medium text-brand-900 hover:text-brand-600 hover:underline"
                      >
                        {v.title}
                      </Link>
                      <span className="block text-xs text-muted">
                        {[v.client, optionFor(vacancyStatuses, v.status as VacancyStatus).label].filter(Boolean).join(", ")}
                      </span>
                    </TD>
                    <TD className="text-right tabular-nums">{v.daysOpen}</TD>
                    <TD className="text-right font-semibold tabular-nums">{v.applicants}</TD>
                    <TD className="text-right tabular-nums">{v.headhunted}</TD>
                    <TD className="text-right tabular-nums">{v.formFilled}</TD>
                    <TD className="text-right tabular-nums">{v.interview}</TD>
                    <TD className="text-right tabular-nums">{v.matched}</TD>
                    <TD className="text-right tabular-nums">{v.placed}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </>
      )}
    </section>
  );
}

function FunnelBars({ title, description, steps }: { title: string; description: string; steps: FunnelStep[] }) {
  const max = Math.max(1, ...steps.map((s) => s.count));
  return (
    <Card>
      <CardHeader title={title} description={description} />
      <dl className="space-y-2.5 px-5 py-4">
        {steps.map((step, i) => (
          <div key={step.key} className="grid grid-cols-[minmax(0,7.5rem)_1fr_2.5rem_3.5rem] items-center gap-3">
            <dt className="truncate text-sm text-muted">{step.label}</dt>
            <dd className="h-2.5 overflow-hidden rounded-full bg-brand-50" aria-hidden="true">
              <div
                className={`h-full rounded-full ${i === steps.length - 1 ? "bg-emerald-500" : "bg-brand-600"}`}
                style={{ width: `${(step.count / max) * 100}%` }}
              />
            </dd>
            <dd className="text-right text-sm font-semibold text-ink tabular-nums">{step.count}</dd>
            <dd className="text-right text-xs text-muted tabular-nums">{i === 0 ? "" : percent(step.conversion)}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

/** Applied against headhunted (2.6.4.3): each group with its own funnel. */
function OriginFunnels({ report }: { report: RecruitmentReport }) {
  const { applied, headhunted } = report.funnelByOrigin;
  return (
    <Card>
      <CardHeader title="Applied and headhunted" description="How far each group gets, with the share of the group." />
      <SimpleTable
        head={["Step", "Applied", "%", "Headhunted", "%"]}
        rows={applied.map((step, i) => [
          step.label,
          step.count,
          percent(step.pctOfTotal),
          headhunted[i].count,
          percent(headhunted[i].pctOfTotal),
        ])}
      />
    </Card>
  );
}

function CountTable({ title, column, rows }: { title: string; column: string; rows: CountRow[] }) {
  return (
    <Card>
      <CardHeader title={title} />
      <SimpleTable head={[column, "Applicants", "%"]} rows={rows.map((r) => [r.label, r.count, percent(r.pct)])} />
    </Card>
  );
}

function ReasonTable({ title, total, rows }: { title: string; total: number; rows: ReasonRow[] }) {
  return (
    <Card>
      <CardHeader title={`${title}: ${total}`} description={total > 0 ? "Most given reasons." : undefined} />
      {total === 0 ? (
        <p className="px-5 py-6 text-sm text-muted">None in this period.</p>
      ) : (
        <SimpleTable head={["Reason", "Count"]} rows={rows.map((r) => [r.reason, r.count])} />
      )}
    </Card>
  );
}

function SimpleTable({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <div className="relative overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-border bg-surface/60 text-xs font-semibold tracking-wide text-muted uppercase">
          <tr>
            {head.map((h, i) => (
              <th key={h + i} scope="col" className={`px-5 py-2.5 font-semibold ${i > 0 ? "text-right" : ""}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, i) => (
                <td key={i} className={`px-5 py-2.5 text-ink ${i > 0 ? "text-right tabular-nums" : ""}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
