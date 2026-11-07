import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import Form from "next/form";
import { Briefcase, Plus, Search } from "lucide-react";
import { EmptyState } from "@/components/dashboard/empty-state";
import { PageHeader } from "@/components/dashboard/page-header";
import { AutoSubmitSelects } from "@/components/entity/auto-submit";
import { FilterChips, filterHref } from "@/components/entity/filter-chips";
import { LeadTimeSignal } from "@/components/talent/lead-time-signal";
import { DaysOpen } from "@/components/vacancies/days-open";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { MobileList, MobileListItem } from "@/components/ui/mobile-list";
import { ListSkeleton, Skeleton } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import type { TalentStage, VacancyStatus } from "@/lib/database.types";
import { isUuid, listClientOptions } from "@/lib/data/clients";
import { isTalentStage, isVacancyStatus, listVacancies } from "@/lib/data/vacancies";
import { optionFor, seniorities, talentStages, vacancyStatuses } from "@/lib/labels";
import { TALENT_POOL_LABEL } from "@/lib/talent/talent-pool";

export const metadata: Metadata = {
  title: "Vacancies",
};

/** Value of the client filter that shows only talent pool vacancies. */
const TALENT_POOL_FILTER = "talent-pool";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const DEFAULT_STATUSES: VacancyStatus[] = ["open", "on_hold"];

function readFilters(params: Record<string, string | string[] | undefined>) {
  const q = typeof params.q === "string" ? params.q.trim() : "";
  const rawStatus = typeof params.status === "string" ? params.status : "";
  const status = rawStatus === "all" || isVacancyStatus(rawStatus) ? rawStatus : "";
  const rawClient = typeof params.client === "string" ? params.client : "";
  const client = rawClient === TALENT_POOL_FILTER || isUuid(rawClient) ? rawClient : "";
  const rawStage = params.stage;
  const stage: TalentStage | "" = isTalentStage(rawStage) ? rawStage : "";
  const statuses: VacancyStatus[] | undefined =
    status === "all" ? undefined : status ? [status] : DEFAULT_STATUSES;
  return { q, status, client, stage, statuses };
}

export default function Page({ searchParams }: { searchParams: SearchParams }) {
  return (
    <>
      <PageHeader
        eyebrow="Recruitment"
        title="Vacancies"
        description="Open job profiles, from first request to three candidates within three weeks. Talent pool vacancies have no client yet and no clock."
        actions={
          <ButtonLink href="/dashboard/vacancies/new">
            <Plus aria-hidden="true" />
            New vacancy
          </ButtonLink>
        }
      />
      <Suspense fallback={<Skeleton className="mb-6 h-11 w-full" />}>
        <Filters searchParams={searchParams} />
      </Suspense>
      <Suspense fallback={<ListSkeleton rows={6} />}>
        <VacancyTable searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Filters({ searchParams }: { searchParams: SearchParams }) {
  const [params, clients] = await Promise.all([searchParams, listClientOptions()]);
  const { q, status, client, stage } = readFilters(params);
  const current = { q: q || undefined, status: status || undefined, client: client || undefined, stage: stage || undefined };
  const statusChip = (label: string, value: string) => ({
    label,
    href: filterHref("/dashboard/vacancies", current, { status: value || undefined }),
    active: status === value,
  });

  return (
    <Form
      action="/dashboard/vacancies"
      role="search"
      className="mb-6 grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2 lg:flex lg:items-center"
    >
      <div className="relative sm:col-span-2 lg:flex-1">
        <Search
          className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted"
          aria-hidden="true"
        />
        <label htmlFor="vacancy-q" className="sr-only">
          Search by job title
        </label>
        <Input
          id="vacancy-q"
          name="q"
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          defaultValue={q}
          placeholder="Search by job title"
          className="pl-10"
        />
      </div>
      {/* Phones: status as chips, client and stage apply as soon as they change. */}
      <FilterChips
        label="Status"
        className="sm:hidden"
        chips={[
          statusChip("Open and on hold", ""),
          ...vacancyStatuses.map((s) => statusChip(s.label, s.value)),
          statusChip("All", "all"),
        ]}
      />
      <div className="max-sm:hidden lg:w-48">
        <label htmlFor="vacancy-status" className="sr-only">
          Status
        </label>
        <Select id="vacancy-status" name="status" defaultValue={status}>
          <option value="">Open and on hold</option>
          <option value="all">All statuses</option>
          {vacancyStatuses.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </Select>
      </div>
      <AutoSubmitSelects className="grid grid-cols-2 gap-3 *:min-w-0 sm:contents">
        <label htmlFor="vacancy-client" className="sr-only">
          Client
        </label>
        <Select id="vacancy-client" name="client" defaultValue={client} className="lg:w-56">
          <option value="">All clients</option>
          <option value={TALENT_POOL_FILTER}>{TALENT_POOL_LABEL}</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </Select>
        <label htmlFor="vacancy-stage" className="sr-only">
          Talent stage
        </label>
        <Select id="vacancy-stage" name="stage" defaultValue={stage} className="lg:w-48">
          <option value="">All stages</option>
          {talentStages.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </Select>
      </AutoSubmitSelects>
      <Button type="submit" variant="secondary" className="max-sm:hidden sm:col-span-2 lg:col-span-1">
        Filter
      </Button>
    </Form>
  );
}

async function VacancyTable({ searchParams }: { searchParams: SearchParams }) {
  const { q, status, client, stage, statuses } = readFilters(await searchParams);
  const vacancies = await listVacancies({
    q: q || undefined,
    statuses,
    clientId: client && client !== TALENT_POOL_FILTER ? client : undefined,
    talentStage: stage || undefined,
    talentPool: client === TALENT_POOL_FILTER ? true : undefined,
  });

  if (vacancies.length === 0) {
    const filtered = Boolean(q || status || client || stage);
    return (
      <EmptyState
        icon={Briefcase}
        title={filtered ? "No vacancies found" : "No running vacancies"}
        description={
          filtered
            ? "Nothing found with these filters. Change your search, status, client or stage."
            : "No vacancies are open or on hold. Add a new vacancy or look at all statuses."
        }
      />
    );
  }

  return (
    <>
      <MobileList label="Vacancies" className="md:hidden">
        {vacancies.map((v) => {
          const statusOption = optionFor(vacancyStatuses, v.status);
          const stageOption = optionFor(talentStages, v.talentStage);
          const owner = v.isTalentPool
            ? TALENT_POOL_LABEL
            : (v.clientName ?? (v.companyName ? `${v.companyName} (prospect)` : "Unknown"));
          return (
            <MobileListItem
              key={v.id}
              href={`/dashboard/vacancies/${v.id}`}
              title={v.title}
              subtitle={owner}
              meta={`${optionFor(seniorities, v.seniority).label} · ${v.inPipeline} in pipeline`}
            >
              {/* Badges under the text, so long titles keep the full width. */}
              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1.5 text-xs">
                {v.isTalentPool && <Badge tone="accent">{TALENT_POOL_LABEL}</Badge>}
                <Badge tone={statusOption.tone}>{statusOption.label}</Badge>
                <Badge tone={stageOption.tone}>{stageOption.label}</Badge>
                <span className="w-1" aria-hidden="true" />
                <DaysOpen days={v.daysOpen} status={v.status} talentPool={v.isTalentPool} />
              </div>
            </MobileListItem>
          );
        })}
      </MobileList>
      <Table className="hidden md:block">
        <THead>
          <tr>
            <TH>Role</TH>
            <TH>Client or prospect</TH>
            <TH>Seniority</TH>
            <TH>Status</TH>
            <TH>Stage</TH>
            <TH>Stack</TH>
            <TH className="text-right">In pipeline</TH>
            <TH>Days open</TH>
            <TH>Lead time</TH>
          </tr>
        </THead>
        <TBody>
          {vacancies.map((v) => {
            const statusOption = optionFor(vacancyStatuses, v.status);
            const stageOption = optionFor(talentStages, v.talentStage);
            const seniority = optionFor(seniorities, v.seniority);
            const extra = v.stack.length - 3;
            return (
              <TR key={v.id}>
                <TD>
                  <Link
                    href={`/dashboard/vacancies/${v.id}`}
                    className="font-medium text-brand-800 hover:underline focus-visible:outline-2 focus-visible:outline-brand-500"
                  >
                    {v.title}
                  </Link>
                </TD>
                <TD>
                  {v.isTalentPool ? (
                    <Badge tone="accent">{TALENT_POOL_LABEL}</Badge>
                  ) : v.clientId ? (
                    <Link href={`/dashboard/clients/${v.clientId}`} className="text-ink hover:text-brand-700 hover:underline">
                      {v.clientName ?? "Client"}
                    </Link>
                  ) : v.companyId ? (
                    <span className="inline-flex flex-wrap items-center gap-1.5">
                      <Link href={`/dashboard/leads/${v.companyId}`} className="text-ink hover:text-brand-700 hover:underline">
                        {v.companyName ?? "Prospect"}
                      </Link>
                      <Badge tone="accent">Prospect</Badge>
                    </span>
                  ) : (
                    <span className="text-muted">Unknown</span>
                  )}
                </TD>
                <TD className="text-muted">{seniority.label}</TD>
                <TD>
                  <Badge tone={statusOption.tone}>{statusOption.label}</Badge>
                </TD>
                <TD>
                  <Badge tone={stageOption.tone}>{stageOption.label}</Badge>
                </TD>
                <TD>
                  {v.stack.length === 0 ? (
                    <span className="text-muted">Not filled in</span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {v.stack.slice(0, 3).map((item, i) => (
                        <Badge key={`${item}-${i}`}>{item}</Badge>
                      ))}
                      {extra > 0 && <span className="text-xs text-muted">+{extra}</span>}
                    </div>
                  )}
                </TD>
                <TD className="text-right tabular-nums">{v.inPipeline}</TD>
                <TD>
                  <DaysOpen days={v.daysOpen} status={v.status} talentPool={v.isTalentPool} />
                </TD>
                <TD>
                  <LeadTimeSignal leadTime={v.leadTime} />
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
      <p className="mt-3 text-xs text-muted">
        Days open for status Open: green under 14 days, amber from 14 to 21 days, red over 21 days. Lead time counts from the
        intake to the first profiles sent, with the same colours. Talent pool vacancies have no clock and do not count on the
        dashboard or in the report.
      </p>
    </>
  );
}
