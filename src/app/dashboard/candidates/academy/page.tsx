import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import Form from "next/form";
import { ArrowDown, ArrowLeft, ArrowUp, GraduationCap, SearchX, Star } from "lucide-react";
import { EmptyState } from "@/components/dashboard/empty-state";
import { PageHeader } from "@/components/dashboard/page-header";
import { POOL_BULK_FORM, PoolBulkBar } from "@/components/academy/ats/pool-bulk";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { ListSkeleton } from "@/components/ui/skeleton";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { listAcademyPool, listPoolOptions } from "@/lib/academy/ats/data";
import {
  type PoolFilters,
  type PoolSort,
  POOL_PAGE_SIZE,
  POOL_STATES,
  formatDays,
  formatPercent,
  hasPoolFilter,
  pageCount,
  parsePoolParams,
  poolHref,
  poolQuery,
  sortHref,
} from "@/lib/academy/ats/pool";
import { formatDate } from "@/lib/format";
import { candidateStatuses, optionFor } from "@/lib/labels";

export const metadata: Metadata = { title: "Talent pool: Academy" };

const BASE = "/dashboard/candidates/academy";

export default function Page({ searchParams }: PageProps<"/dashboard/candidates/academy">) {
  return (
    <>
      <Link
        href="/dashboard/candidates"
        className="mb-4 inline-flex items-center gap-1.5 rounded-lg text-sm font-medium text-muted hover:text-brand-700 focus-visible:outline-2 focus-visible:outline-brand-500"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        All candidates
      </Link>
      <PageHeader
        eyebrow="Recruitment · Talent pool"
        title="Academy results"
        description="Every candidate with their results in the developer course, live from the Academy. Sort and filter on them, add candidates to the course or mark top candidates, one by one or in bulk. Background only: nobody is rejected automatically."
      />
      <Suspense fallback={<ListSkeleton rows={8} />}>
        <Pool searchParams={searchParams} />
      </Suspense>
    </>
  );
}

function SortHeader({ filters, column, children, className = "" }: { filters: PoolFilters; column: PoolSort; children: React.ReactNode; className?: string }) {
  const active = filters.sort === column;
  return (
    <TH className={className} aria-sort={active ? (filters.desc ? "descending" : "ascending") : "none"}>
      <Link href={sortHref(BASE, filters, column)} className="inline-flex items-center gap-1 hover:text-brand-900">
        {children}
        {active && (filters.desc ? <ArrowDown className="size-3" aria-hidden="true" /> : <ArrowUp className="size-3" aria-hidden="true" />)}
      </Link>
    </TH>
  );
}

async function Pool({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const filters = parsePoolParams(await searchParams);
  const [{ rows, total }, options] = await Promise.all([listAcademyPool(filters), listPoolOptions()]);
  const pages = pageCount(Math.max(total, 0));
  const filterQuery = poolQuery({ ...filters, page: 1 }).toString();
  const bool = (value: boolean | undefined) => (value === undefined ? "" : value ? "yes" : "no");

  return (
    <div className="space-y-4">
      <Form action={BASE} role="search" aria-label="Filter the talent pool" className="grid gap-3 rounded-2xl border border-border bg-card p-3 shadow-xs sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
        <Input name="q" type="search" defaultValue={filters.q} placeholder="Name, email, role or skill" aria-label="Search" className="sm:col-span-2" />
        <Select name="enrolled" defaultValue={bool(filters.enrolled)} aria-label="In the Academy">
          <option value="">In the Academy or not</option>
          <option value="yes">In the Academy</option>
          <option value="no">Not in the Academy</option>
        </Select>
        <Select name="state" defaultValue={filters.state ?? ""} aria-label="Progress">
          <option value="">Any progress</option>
          {POOL_STATES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </Select>
        <Select name="certificate" defaultValue={bool(filters.certificate)} aria-label="Certificate">
          <option value="">Certificate or not</option>
          <option value="yes">With certificate</option>
          <option value="no">Without certificate</option>
        </Select>
        <Select name="top" defaultValue={bool(filters.top)} aria-label="Top candidate">
          <option value="">Top candidate or not</option>
          <option value="yes">Top candidates</option>
          <option value="no">Not top candidate</option>
        </Select>
        <Select name="vacancy" defaultValue={filters.vacancy ?? ""} aria-label="Vacancy">
          <option value="">Every vacancy</option>
          {options.vacancies.map((v) => (
            <option key={v.id} value={v.id}>
              {v.title}
              {v.clientName ? ` · ${v.clientName}` : ""}
            </option>
          ))}
        </Select>
        {options.groups.length > 0 && (
          <Select name="group" defaultValue={filters.group ?? ""} aria-label="Group">
            <option value="">Every group</option>
            {options.groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </Select>
        )}
        <Input name="min_progress" type="number" min={0} max={100} defaultValue={filters.minProgress} placeholder="Progress at least %" aria-label="Progress at least (percent)" />
        <Input name="min_check" type="number" min={0} max={100} defaultValue={filters.minCheck} placeholder="Check score at least %" aria-label="Knowledge check at least (percent)" />
        <label className="flex items-center gap-2 rounded-xl border border-border bg-white px-3 text-sm font-medium text-ink has-checked:border-danger has-checked:bg-danger-bg">
          <input type="checkbox" name="inactive" value="yes" defaultChecked={filters.inactive} className="size-4 accent-danger" />
          Inactive 14 days
        </label>
        {filters.sort !== "name" && <input type="hidden" name="sort" value={filters.sort} />}
        {filters.desc && <input type="hidden" name="dir" value="desc" />}
        <div className="flex gap-2">
          <Button type="submit" variant="secondary" className="flex-1">
            Filter
          </Button>
          {hasPoolFilter(filters) && (
            <ButtonLink href={BASE} variant="ghost">
              Clear
            </ButtonLink>
          )}
        </div>
      </Form>

      <PoolBulkBar
        total={Math.max(total, 0)}
        filters={filterQuery}
        canManage={options.canManage}
        groups={options.groups}
        modules={options.modules}
      />

      {rows.length === 0 ? (
        <EmptyState icon={SearchX} title="No candidates found" description="Nobody matches these filters. Adjust or clear them." />
      ) : (
        <>
          <p className="text-sm text-muted" aria-live="polite">
            {total === 1 ? "1 candidate" : `${total} candidates`}
            {pages > 1 && ` · page ${filters.page} of ${pages}`}
          </p>
          <Table>
            <THead>
              <tr>
                <TH className="w-8">
                  <span className="sr-only">Select</span>
                </TH>
                <SortHeader filters={filters} column="name">
                  Candidate
                </SortHeader>
                <SortHeader filters={filters} column="progress" className="text-right">
                  Progress
                </SortHeader>
                <SortHeader filters={filters} column="check" className="text-right">
                  Check
                </SortHeader>
                <SortHeader filters={filters} column="ai" className="text-right">
                  AI
                </SortHeader>
                <SortHeader filters={filters} column="final" className="text-right">
                  Final
                </SortHeader>
                <SortHeader filters={filters} column="watch" className="text-right">
                  Watched
                </SortHeader>
                <SortHeader filters={filters} column="started">
                  Started
                </SortHeader>
                <SortHeader filters={filters} column="lead_time" className="text-right">
                  Lead time
                </SortHeader>
                <SortHeader filters={filters} column="last_activity">
                  Last activity
                </SortHeader>
                <SortHeader filters={filters} column="certificate">
                  Certificate
                </SortHeader>
              </tr>
            </THead>
            <TBody>
              {rows.map((r) => {
                const status = optionFor(candidateStatuses, r.candidate_status);
                return (
                  <TR key={r.candidate_id}>
                    <TD>
                      <input
                        type="checkbox"
                        name="candidate_ids"
                        value={r.candidate_id}
                        form={POOL_BULK_FORM}
                        aria-label={`Select ${r.full_name}`}
                        className="size-4 accent-brand-700"
                      />
                    </TD>
                    <TD>
                      <Link href={`/dashboard/candidates/${r.candidate_id}`} className="font-medium text-brand-900 hover:underline">
                        <span className="flex items-center gap-1">
                          {r.top_candidate && <Star className="size-3.5 shrink-0 fill-amber-400 text-amber-500" aria-label="Top candidate" />}
                          {r.full_name}
                        </span>
                      </Link>
                      <span className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-muted">
                        <Badge tone={status.tone}>{status.label}</Badge>
                        {r.enrolled ? (
                          r.academy_role === "developer" ? (
                            <Badge tone="success">Developer</Badge>
                          ) : (
                            <Badge tone="brand">
                              <GraduationCap className="size-3" aria-hidden="true" />
                              Academy
                            </Badge>
                          )
                        ) : (
                          <span>not in the Academy</span>
                        )}
                        {r.assignments_waiting > 0 && <Badge tone="warning">{r.assignments_waiting} waiting</Badge>}
                      </span>
                    </TD>
                    <TD className="text-right whitespace-nowrap tabular-nums">
                      {r.enrolled ? (
                        <>
                          {r.progress_percent}%
                          <span className="block text-xs text-muted">
                            {r.lessons_done}/{r.lessons_total} lessons
                          </span>
                        </>
                      ) : (
                        <span className="text-muted">–</span>
                      )}
                    </TD>
                    <TD className="text-right tabular-nums">{formatPercent(r.check_avg_percent) || <span className="text-muted">–</span>}</TD>
                    <TD className="text-right tabular-nums">{r.ai_avg_score ?? <span className="text-muted">–</span>}</TD>
                    <TD className="text-right tabular-nums">{r.final_avg_score ?? <span className="text-muted">–</span>}</TD>
                    <TD className="text-right tabular-nums">{formatPercent(r.watch_avg_percent) || <span className="text-muted">–</span>}</TD>
                    <TD className="whitespace-nowrap text-muted">{r.started_at ? formatDate(r.started_at) : "–"}</TD>
                    <TD className="text-right whitespace-nowrap tabular-nums">
                      {r.lead_time_days !== null ? formatDays(r.lead_time_days) : <span className="text-muted">–</span>}
                    </TD>
                    <TD className="whitespace-nowrap">
                      {r.last_activity_at ? (
                        <span className={r.inactive_14d ? "font-medium text-danger" : "text-muted"}>{formatDate(r.last_activity_at)}</span>
                      ) : (
                        <span className={r.inactive_14d ? "font-medium text-danger" : "text-muted"}>{r.enrolled ? "never" : "–"}</span>
                      )}
                    </TD>
                    <TD className="whitespace-nowrap">
                      {r.certificate_issued_at ? <Badge tone="success">Yes</Badge> : <span className="text-muted">No</span>}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
          {pages > 1 && (
            <nav aria-label="Pages" className="flex items-center justify-between gap-3 text-sm">
              {filters.page > 1 ? (
                <ButtonLink href={poolHref(BASE, filters, { page: filters.page - 1 })} variant="secondary" size="sm">
                  Previous
                </ButtonLink>
              ) : (
                <span />
              )}
              <span className="text-muted">
                {POOL_PAGE_SIZE * (filters.page - 1) + 1} to {Math.min(total, POOL_PAGE_SIZE * filters.page)} of {total}
              </span>
              {filters.page < pages ? (
                <ButtonLink href={poolHref(BASE, filters, { page: filters.page + 1 })} variant="secondary" size="sm">
                  Next
                </ButtonLink>
              ) : (
                <span />
              )}
            </nav>
          )}
        </>
      )}
    </div>
  );
}
