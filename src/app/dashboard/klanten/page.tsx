import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import Form from "next/form";
import { Building2, Plus, Search } from "lucide-react";
import { EmptyState } from "@/components/dashboard/empty-state";
import { PageHeader } from "@/components/dashboard/page-header";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { Skeleton, ListSkeleton } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { isClientStatus, listClients } from "@/lib/data/clients";
import { clientStatuses, optionFor } from "@/lib/labels";

export const metadata: Metadata = {
  title: "Klanten",
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
        eyebrow="Werving"
        title="Klanten"
        description="De Nederlandse groeibedrijven waarvoor we developers en data engineers zoeken."
        actions={
          <ButtonLink href="/dashboard/klanten/nieuw">
            <Plus aria-hidden="true" />
            Nieuwe klant
          </ButtonLink>
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
  return (
    <Form
      action="/dashboard/klanten"
      role="search"
      className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center"
    >
      <div className="relative flex-1">
        <Search
          className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted"
          aria-hidden="true"
        />
        <label htmlFor="client-q" className="sr-only">
          Zoek op naam
        </label>
        <Input id="client-q" name="q" type="search" defaultValue={q} placeholder="Zoek op naam" className="pl-10" />
      </div>
      <label htmlFor="client-status" className="sr-only">
        Status
      </label>
      <Select id="client-status" name="status" defaultValue={status ?? ""} className="sm:w-48">
        <option value="">Alle statussen</option>
        {clientStatuses.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </Select>
      <Button type="submit" variant="secondary">
        Filteren
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
        title={filtered ? "Geen klanten gevonden" : "Nog geen klanten"}
        description={
          filtered
            ? "Niets gevonden met deze zoekterm of status. Pas je filter aan."
            : "Voeg je eerste klant toe om vacatures en contactpersonen bij te houden."
        }
      />
    );
  }

  return (
    <Table>
      <THead>
        <tr>
          <TH>Naam</TH>
          <TH>Status</TH>
          <TH>Plaats</TH>
          <TH>Branche</TH>
          <TH className="text-right">Open vacatures</TH>
          <TH>Eigenaar</TH>
        </tr>
      </THead>
      <TBody>
        {clients.map((client) => {
          const statusOption = optionFor(clientStatuses, client.status);
          return (
            <TR key={client.id}>
              <TD>
                <Link
                  href={`/dashboard/klanten/${client.id}`}
                  className="font-medium text-brand-800 hover:underline focus-visible:outline-2 focus-visible:outline-brand-500"
                >
                  {client.name}
                </Link>
              </TD>
              <TD>
                <Badge tone={statusOption.tone}>{statusOption.label}</Badge>
              </TD>
              <TD className="text-muted">{client.city ?? "Onbekend"}</TD>
              <TD className="text-muted">{client.industry ?? "Onbekend"}</TD>
              <TD className="text-right tabular-nums">{client.openVacancies}</TD>
              <TD className="text-muted">{client.ownerName ?? "Niemand"}</TD>
            </TR>
          );
        })}
      </TBody>
    </Table>
  );
}
