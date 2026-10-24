import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { Handshake, Plus } from "lucide-react";
import { z } from "zod";
import { listPlacementClientOptions, listPlacements } from "@/lib/data/placements";
import type { PlacementStatus } from "@/lib/database.types";
import { formatCurrency, formatDate, todayIso } from "@/lib/format";
import { EmptyState } from "@/components/dashboard/empty-state";
import { PageHeader } from "@/components/dashboard/page-header";
import { ButtonLink } from "@/components/ui/button";
import { ListSkeleton, Skeleton } from "@/components/ui/skeleton";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { monthsBetween } from "@/components/placements/dates";
import {
  CheckinDate,
  GuaranteeBadge,
  PlacementStatusBadge,
} from "@/components/placements/placement-badges";
import { PlacementFilters } from "@/components/placements/placement-filters";
import {
  STATUS_FILTERS,
  type StatusFilter,
} from "@/components/placements/status-filters";

export const metadata: Metadata = {
  title: "Plaatsingen",
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function Page({ searchParams }: { searchParams: SearchParams }) {
  return (
    <>
      <PageHeader
        eyebrow="Werving"
        title="Plaatsingen"
        description="Developers die fulltime in het team van een klant werken. Geen minimale looptijd, één maand opzegtermijn."
        actions={
          <ButtonLink href="/dashboard/plaatsingen/nieuw">
            <Plus aria-hidden="true" />
            Nieuwe plaatsing
          </ButtonLink>
        }
      />
      <Suspense fallback={<PlacementsSkeleton />}>
        <Placements searchParams={searchParams} />
      </Suspense>
    </>
  );
}

const STATUS_MAP: Record<StatusFilter, PlacementStatus[]> = {
  lopend: ["active", "notice"],
  active: ["active"],
  notice: ["notice"],
  ended: ["ended"],
  alle: [],
};

function parseFilters(params: Record<string, string | string[] | undefined>) {
  const rawStatus = typeof params.status === "string" ? params.status : "lopend";
  const status: StatusFilter = STATUS_FILTERS.some((s) => s.value === rawStatus)
    ? (rawStatus as StatusFilter)
    : "lopend";
  const rawClient = typeof params.klant === "string" ? params.klant : "";
  const clientId = z.guid().safeParse(rawClient).success ? rawClient : "";
  return { status, clientId };
}

async function Placements({ searchParams }: { searchParams: SearchParams }) {
  const { status, clientId } = parseFilters(await searchParams);
  const [placements, clients] = await Promise.all([
    listPlacements({ statuses: STATUS_MAP[status], clientId: clientId || undefined }),
    listPlacementClientOptions(),
  ]);
  const today = todayIso();
  const filtered = status !== "lopend" || clientId !== "";

  return (
    <>
      <PlacementFilters status={status} clientId={clientId} clients={clients} />

      {placements.length === 0 ? (
        filtered ? (
          <EmptyState
            icon={Handshake}
            title="Geen plaatsingen gevonden"
            description="Er zijn geen plaatsingen die bij dit filter passen. Kies een andere status of klant."
          />
        ) : (
          <EmptyState
            icon={Handshake}
            title="Nog geen lopende plaatsingen"
            description="Zodra een kandidaat bij een klant begint, leg je dat hier vast. Dan houden we garantie, check-ins en opzegtermijn voor je bij."
          />
        )
      ) : (
        <Table>
          <THead>
            <tr>
              <TH>Kandidaat</TH>
              <TH>Klant</TH>
              <TH>Vacature</TH>
              <TH>Start</TH>
              <TH>Looptijd</TH>
              <TH className="text-right">Maandtarief</TH>
              <TH>Status</TH>
              <TH>Volgende check-in</TH>
            </tr>
          </THead>
          <TBody>
            {placements.map((p) => {
              const runningUntil = p.status === "ended" && p.end_date ? p.end_date : today;
              const started = p.start_date <= today;
              const months = monthsBetween(p.start_date, runningUntil);
              return (
                <TR key={p.id}>
                  <TD>
                    <Link
                      href={`/dashboard/plaatsingen/${p.id}`}
                      className="font-semibold text-brand-800 hover:text-brand-600 hover:underline"
                    >
                      {p.candidate?.full_name ?? "Onbekende kandidaat"}
                    </Link>
                  </TD>
                  <TD>{p.client?.name ?? "Onbekend"}</TD>
                  <TD className="text-muted">{p.vacancy?.title ?? "Geen vacature"}</TD>
                  <TD className="whitespace-nowrap">{formatDate(p.start_date)}</TD>
                  <TD className="whitespace-nowrap">
                    {started ? `${months} ${months === 1 ? "maand" : "maanden"}` : "Nog niet gestart"}
                  </TD>
                  <TD className="text-right whitespace-nowrap tabular-nums">
                    {formatCurrency(p.monthly_rate, "Niet ingevuld")}
                  </TD>
                  <TD>
                    <div className="flex flex-wrap gap-1.5">
                      <PlacementStatusBadge status={p.status} />
                      <GuaranteeBadge
                        startDate={p.start_date}
                        guaranteeUntil={p.guarantee_until}
                        status={p.status}
                        today={today}
                      />
                    </div>
                  </TD>
                  <TD className="whitespace-nowrap">
                    <CheckinDate date={p.next_checkin_at} status={p.status} today={today} />
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}
    </>
  );
}

function PlacementsSkeleton() {
  return (
    <>
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:max-w-2xl" aria-hidden="true">
        <Skeleton className="h-11" />
        <Skeleton className="h-11" />
      </div>
      <ListSkeleton rows={6} />
    </>
  );
}
