import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import Form from "next/form";
import { Building2, Plus, Search } from "lucide-react";
import { EmptyState } from "@/components/dashboard/empty-state";
import { PageHeader } from "@/components/dashboard/page-header";
import { ExportCsvLink } from "@/components/custom-fields/export-link";
import { FilterChips, filterHref } from "@/components/entity/filter-chips";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { MobileList, MobileListItem } from "@/components/ui/mobile-list";
import { Skeleton, ListSkeleton } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { isClientStatus, listClients } from "@/lib/data/clients";
import { clientStatuses, optionFor } from "@/lib/labels";

export const metadata: Metadata = {
  title: "Clients",
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function readFilters(params: Record<string, string | string[] | undefined>) {
  const q = typeof params.q === "string" ? params.q.trim() : "";
  const status = isClientStatus(params.status) ? params.status : undefined;
  return { q, status };
}

export default function Page({ searchParams }: { searchParams: SearchParams }) {
  return (
    <>
      <PageHeader
        eyebrow="Recruitment"
        title="Clients"
        description="The Dutch scale-ups we find developers and data engineers for."
        actions={
          <>
            <ExportCsvLink href="/dashboard/clients/export" />
            <ButtonLink href="/dashboard/clients/new">
              <Plus aria-hidden="true" />
              New client
            </ButtonLink>
          </>
        }
      />
      <Suspense fallback={<Skeleton className="mb-6 h-11 w-full" />}>
        <Filters searchParams={searchParams} />
      </Suspense>
      <Suspense fallback={<ListSkeleton rows={6} />}>
        <ClientTable searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Filters({ searchParams }: { searchParams: SearchParams }) {
  const { q, status } = readFilters(await searchParams);
  const current = { q: q || undefined, status };
  return (
    <Form
      action="/dashboard/clients"
      role="search"
      className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center"
    >
      <div className="relative flex-1">
        <Search
          className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted"
          aria-hidden="true"
        />
        <label htmlFor="client-q" className="sr-only">
          Search by name
        </label>
        <Input
          id="client-q"
          name="q"
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          defaultValue={q}
          placeholder="Search by name"
          className="pl-10"
        />
      </div>
      {/* Phones pick the status with chips; the hidden select keeps it in the search. */}
      <FilterChips
        label="Status"
        className="sm:hidden"
        chips={[
          { label: "All", href: filterHref("/dashboard/clients", current, { status: undefined }), active: !status },
          ...clientStatuses.map((s) => ({
            label: s.label,
            href: filterHref("/dashboard/clients", current, { status: s.value }),
            active: status === s.value,
          })),
        ]}
      />
      <div className="max-sm:hidden sm:w-48">
        <label htmlFor="client-status" className="sr-only">
          Status
        </label>
        <Select id="client-status" name="status" defaultValue={status ?? ""}>
          <option value="">All statuses</option>
          {clientStatuses.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </Select>
      </div>
      <Button type="submit" variant="secondary" className="max-sm:hidden">
        Filter
      </Button>
    </Form>
  );
}

async function ClientTable({ searchParams }: { searchParams: SearchParams }) {
  const { q, status } = readFilters(await searchParams);
  const clients = await listClients({ q: q || undefined, status });

  if (clients.length === 0) {
    const filtered = Boolean(q || status);
    return (
      <EmptyState
        icon={Building2}
        title={filtered ? "No clients found" : "No clients yet"}
        description={
          filtered
            ? "Nothing matches this search or status. Adjust your filter."
            : "Add your first client to keep track of vacancies and contacts."
        }
      />
    );
  }

  return (
    <>
      <MobileList label="Clients" className="md:hidden">
        {clients.map((client) => {
          const statusOption = optionFor(clientStatuses, client.status);
          return (
            <MobileListItem
              key={client.id}
              href={`/dashboard/clients/${client.id}`}
              leading={
                <span className="flex size-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                  <Building2 className="size-5" aria-hidden="true" />
                </span>
              }
              title={client.name}
              subtitle={[client.city, client.industry].filter(Boolean).join(" · ") || "Location unknown"}
              meta={`${client.openVacancies} open ${client.openVacancies === 1 ? "vacancy" : "vacancies"} · ${client.ownerName ?? "No owner"}`}
              trailing={<Badge tone={statusOption.tone}>{statusOption.label}</Badge>}
            />
          );
        })}
      </MobileList>
      <Table className="hidden md:block">
        <THead>
          <tr>
            <TH>Name</TH>
            <TH>Status</TH>
            <TH>Location</TH>
            <TH>Industry</TH>
            <TH className="text-right">Open vacancies</TH>
            <TH>Owner</TH>
          </tr>
        </THead>
        <TBody>
          {clients.map((client) => {
            const statusOption = optionFor(clientStatuses, client.status);
            return (
              <TR key={client.id}>
                <TD>
                  <Link
                    href={`/dashboard/clients/${client.id}`}
                    className="font-medium text-brand-800 hover:underline focus-visible:outline-2 focus-visible:outline-brand-500"
                  >
                    {client.name}
                  </Link>
                </TD>
                <TD>
                  <Badge tone={statusOption.tone}>{statusOption.label}</Badge>
                </TD>
                <TD className="text-muted">{client.city ?? "Unknown"}</TD>
                <TD className="text-muted">{client.industry ?? "Unknown"}</TD>
                <TD className="text-right tabular-nums">{client.openVacancies}</TD>
                <TD className="text-muted">{client.ownerName ?? "Nobody"}</TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
    </>
  );
}
