import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getPlacement, listCheckins } from "@/lib/data/placements";
import { formatCurrency, formatDate, todayIso } from "@/lib/format";
import { EntityExtras } from "@/components/entity/entity-extras";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardBody, CardHeader, DetailList } from "@/components/ui/card";
import { FormMessage } from "@/components/ui/field";
import { ListSkeleton, Skeleton } from "@/components/ui/skeleton";
import { AddCheckin } from "@/components/placements/checkin-form";
import { CheckinList } from "@/components/placements/checkin-list";
import { addMonths, monthsBetween } from "@/components/placements/dates";
import { GuaranteeProgress } from "@/components/placements/guarantee-progress";
import { PlacementActions } from "@/components/placements/placement-actions";
import {
  CheckinDate,
  PlacementStatusBadge,
} from "@/components/placements/placement-badges";
import {
  addCheckin,
  deletePlacement,
  endPlacement,
  givePlacementNotice,
  setNextCheckin,
} from "../actions";

export const metadata: Metadata = {
  title: "Plaatsing",
};

type Params = Promise<{ id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function Page({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  return (
    <Suspense fallback={<DetailSkeleton />}>
      <PlacementDetail params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function PlacementDetail({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  if (!z.guid().safeParse(id).success) notFound();

  const placement = await getPlacement(id);
  if (!placement) notFound();

  const today = todayIso();
  const candidateName = placement.candidate?.full_name ?? "Onbekende kandidaat";
  const clientName = placement.client?.name ?? "onbekende klant";
  const months = monthsBetween(
    placement.start_date,
    placement.status === "ended" && placement.end_date ? placement.end_date : today,
  );

  return (
    <>
      <PageHeader
        eyebrow="Plaatsing"
        title={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span>
              {candidateName} <span className="font-semibold text-muted">bij</span> {clientName}
            </span>
            <PlacementStatusBadge status={placement.status} />
          </span>
        }
        description={placement.vacancy?.title}
        actions={
          <PlacementActions
            placementId={placement.id}
            status={placement.status}
            endDate={placement.end_date}
            giveNotice={givePlacementNotice.bind(null, placement.id)}
            end={endPlacement.bind(null, placement.id)}
            remove={deletePlacement.bind(null, placement.id)}
          />
        }
      />

      {query.melding === "deels" && (
        <div className="mb-6">
          <FormMessage error="De plaatsing is opgeslagen, maar niet alles is bijgewerkt. Controleer de status van de vacature, de kandidaat en de taken." />
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader title="Details" />
            <CardBody>
              <DetailList
                items={[
                  {
                    label: "Kandidaat",
                    value: placement.candidate ? (
                      <Link
                        href={`/dashboard/kandidaten/${placement.candidate.id}`}
                        className="font-medium text-brand-700 hover:underline"
                      >
                        {placement.candidate.full_name}
                      </Link>
                    ) : null,
                  },
                  {
                    label: "Klant",
                    value: placement.client ? (
                      <Link
                        href={`/dashboard/klanten/${placement.client.id}`}
                        className="font-medium text-brand-700 hover:underline"
                      >
                        {placement.client.name}
                      </Link>
                    ) : null,
                  },
                  {
                    label: "Vacature",
                    value: placement.vacancy ? (
                      <Link
                        href={`/dashboard/vacatures/${placement.vacancy.id}`}
                        className="font-medium text-brand-700 hover:underline"
                      >
                        {placement.vacancy.title}
                      </Link>
                    ) : null,
                  },
                  {
                    label: "Maandtarief",
                    value:
                      placement.monthly_rate !== null ? formatCurrency(placement.monthly_rate) : null,
                  },
                  { label: "Startdatum", value: formatDate(placement.start_date) },
                  {
                    label: "Looptijd",
                    value:
                      placement.start_date > today
                        ? "Nog niet gestart"
                        : `${months} ${months === 1 ? "maand" : "maanden"}`,
                  },
                  {
                    label: "Volgende check-in",
                    value: (
                      <CheckinDate
                        date={placement.next_checkin_at}
                        status={placement.status}
                        today={today}
                      />
                    ),
                  },
                  {
                    label: placement.status === "active" ? "Opzegtermijn" : "Opgezegd op",
                    value:
                      placement.status === "active"
                        ? `Eén maand. Bij opzegging vandaag is de laatste dag ${formatDate(addMonths(today, 1))}.`
                        : placement.notice_given_at
                          ? formatDate(placement.notice_given_at)
                          : null,
                  },
                  {
                    label: "Einddatum",
                    value: placement.end_date ? formatDate(placement.end_date) : "Geen, loopt door",
                  },
                ]}
              />
              {placement.notes && (
                <div className="mt-6 border-t border-border pt-4">
                  <p className="text-xs font-medium tracking-wide text-muted uppercase">Notities</p>
                  <p className="mt-1 text-sm leading-relaxed whitespace-pre-line text-ink">
                    {placement.notes}
                  </p>
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Check-ins"
              description="Regelmatig contact met de klant over hoe het gaat."
              actions={
                <AddCheckin
                  addCheckin={addCheckin.bind(null, placement.id)}
                  setNextCheckin={setNextCheckin.bind(null, placement.id)}
                />
              }
            />
            <CardBody>
              <Suspense fallback={<ListSkeleton rows={3} />}>
                <Checkins placementId={placement.id} />
              </Suspense>
            </CardBody>
          </Card>
        </div>

        <aside className="min-w-0 space-y-6">
          <Card>
            <CardHeader title="Garantieperiode" />
            <CardBody>
              <GuaranteeProgress
                startDate={placement.start_date}
                guaranteeUntil={placement.guarantee_until}
                status={placement.status}
                today={today}
              />
            </CardBody>
          </Card>
          <Suspense fallback={<ListSkeleton rows={3} />}>
            <EntityExtras entityType="placement" entityId={placement.id} />
          </Suspense>
        </aside>
      </div>
    </>
  );
}

async function Checkins({ placementId }: { placementId: string }) {
  const checkins = await listCheckins(placementId);
  return <CheckinList checkins={checkins} />;
}

function DetailSkeleton() {
  return (
    <div aria-busy="true" aria-label="Laden">
      <div className="mb-8 space-y-3">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-8 w-80 max-w-full" />
        <Skeleton className="h-4 w-48" />
      </div>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Skeleton className="h-80" />
        <Skeleton className="h-48" />
      </div>
    </div>
  );
}
