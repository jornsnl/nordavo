import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import Form from "next/form";
import { Briefcase, Plus, Search } from "lucide-react";
import { EmptyState } from "@/components/dashboard/empty-state";
import { PageHeader } from "@/components/dashboard/page-header";
import { DaysOpen } from "@/components/vacancies/days-open";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { ListSkeleton, Skeleton } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import type { VacancyStatus } from "@/lib/database.types";
import { isUuid, listClientOptions } from "@/lib/data/clients";
import { isVacancyStatus, listVacancies } from "@/lib/data/vacancies";
import { optionFor, seniorities, vacancyStatuses } from "@/lib/labels";

export const metadata: Metadata = {
  title: "Vacatures",
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const DEFAULT_STATUSES: VacancyStatus[] = ["open", "on_hold"];

function readFilters(params: Record<string, string | string[] | undefined>) {
  const q = typeof params.q === "string" ? params.q.trim() : "";
  const rawStatus = typeof params.status === "string" ? params.status : "";
  const status = rawStatus === "all" || isVacancyStatus(rawStatus) ? rawStatus : "";
  const client = isUuid(params.client) ? params.client : "";
  const statuses: VacancyStatus[] | undefined =
    status === "all" ? undefined : status ? [status] : DEFAULT_STATUSES;
  return { q, status, client, statuses };
}

export default function Page({ searchParams }: { searchParams: SearchParams }) {
  return (
    <>
      <PageHeader
        eyebrow="Werving"
        title="Vacatures"
        description="Openstaande functieprofielen, van eerste vraag tot drie kandidaten binnen drie weken."
        actions={
          <ButtonLink href="/dashboard/vacatures/nieuw">
            <Plus aria-hidden="true" />
            Nieuwe vacature
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
  const { q, status, client } = readFilters(params);

  return (
    <Form
      action="/dashboard/vacatures"
      role="search"
      className="mb-6 grid gap-3 sm:grid-cols-2 lg:flex lg:items-center"
    >
      <div className="relative sm:col-span-2 lg:flex-1">
        <Search
          className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted"
          aria-hidden="true"
        />
        <label htmlFor="vacancy-q" className="sr-only">
          Zoek op functietitel
        </label>
        <Input id="vacancy-q" name="q" type="search" defaultValue={q} placeholder="Zoek op functietitel" className="pl-10" />
      </div>
      <label htmlFor="vacancy-status" className="sr-only">
        Status
      </label>
      <Select id="vacancy-status" name="status" defaultValue={status} className="lg:w-48">
        <option value="">Open en on hold</option>
        <option value="all">Alle statussen</option>
        {vacancyStatuses.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </Select>
      <label htmlFor="vacancy-client" className="sr-only">
        Klant
      </label>
      <Select id="vacancy-client" name="client" defaultValue={client} className="lg:w-56">
        <option value="">Alle klanten</option>
        {clients.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </Select>
      <Button type="submit" variant="secondary" className="sm:col-span-2 lg:col-span-1">
        Filteren
      </Button>
    </Form>
  );
}

async function VacancyTable({ searchParams }: { searchParams: SearchParams }) {
  const { q, status, client, statuses } = readFilters(await searchParams);
  const vacancies = await listVacancies({ q: q || undefined, statuses, clientId: client || undefined });

  if (vacancies.length === 0) {
    const filtered = Boolean(q || status || client);
    return (
      <EmptyState
        icon={Briefcase}
        title={filtered ? "Geen vacatures gevonden" : "Geen lopende vacatures"}
        description={
          filtered
            ? "Niets gevonden met deze filters. Pas je zoekterm, status of klant aan."
            : "Er staan geen vacatures open of on hold. Voeg een nieuwe vacature toe of bekijk alle statussen."
        }
      />
    );
  }

  return (
    <>
      <Table>
        <THead>
          <tr>
            <TH>Functie</TH>
            <TH>Klant</TH>
            <TH>Senioriteit</TH>
            <TH>Status</TH>
            <TH>Stack</TH>
            <TH className="text-right">In pipeline</TH>
            <TH>Dagen open</TH>
          </tr>
        </THead>
        <TBody>
          {vacancies.map((v) => {
            const statusOption = optionFor(vacancyStatuses, v.status);
            const seniority = optionFor(seniorities, v.seniority);
            const extra = v.stack.length - 3;
            return (
              <TR key={v.id}>
                <TD>
                  <Link
                    href={`/dashboard/vacatures/${v.id}`}
                    className="font-medium text-brand-800 hover:underline focus-visible:outline-2 focus-visible:outline-brand-500"
                  >
                    {v.title}
                  </Link>
                </TD>
                <TD>
                  <Link href={`/dashboard/klanten/${v.clientId}`} className="text-ink hover:text-brand-700 hover:underline">
                    {v.clientName}
                  </Link>
                </TD>
                <TD className="text-muted">{seniority.label}</TD>
                <TD>
                  <Badge tone={statusOption.tone}>{statusOption.label}</Badge>
                </TD>
                <TD>
                  {v.stack.length === 0 ? (
                    <span className="text-muted">Niet ingevuld</span>
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
                  <DaysOpen days={v.daysOpen} status={v.status} />
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
      <p className="mt-3 text-xs text-muted">
        Dagen open bij status Open: groen onder 14 dagen, oranje van 14 tot 21 dagen, rood boven 21 dagen.
      </p>
    </>
  );
}
