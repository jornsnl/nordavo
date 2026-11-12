import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getCurrentUser, hasModule } from "@/lib/auth";
import { getPlacement, listCheckins } from "@/lib/data/placements";
import { formatCurrency, formatDate, todayIso } from "@/lib/format";
import { EntityExtras } from "@/components/entity/entity-extras";
import { RecordLayout } from "@/components/custom-fields/record-layout";
import { getRecordLayout } from "@/lib/custom-fields/data";
import {
  applyFieldLayout,
  blockLabel,
  coreField,
  findBlock,
} from "@/lib/custom-fields/layout";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardBody, CardHeader, DetailList } from "@/components/ui/card";
import { FormMessage } from "@/components/ui/field";
import { ListSkeleton, Skeleton } from "@/components/ui/skeleton";
import { PlacementAcademyTab } from "@/components/academy/admin/placement/tab";
import { PlacementTabs } from "@/components/academy/admin/placement/placement-tabs";
import { AddCheckin } from "@/components/placements/checkin-form";
import { CheckinList } from "@/components/placements/checkin-list";
import { addMonths, monthsBetween } from "@/components/placements/dates";
import { GuaranteeProgress } from "@/components/placements/guarantee-progress";
import { PlacementActions } from "@/components/placements/placement-actions";
import { PlacementAcademyCard } from "@/components/academy/ats/placement-card";
import { WspCandidateCard } from "@/components/wsp/candidate-card";
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
  title: "Placement",
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

  const [placement, user, layout] = await Promise.all([
    getPlacement(id),
    getCurrentUser(),
    getRecordLayout("placement"),
  ]);
  if (!placement) notFound();
  // The Academy tab (docs/academy.md, Plaatsingspagina) for team members with module academy.
  const academy = hasModule(user, "academy");
  const tab = academy && query.tab === "academy" ? "academy" : "overview";

  const details = findBlock(layout, "details");
  const notesField = coreField(details, "notes", "Notes");
  const today = todayIso();
  const candidateName = placement.candidate?.full_name ?? "Unknown candidate";
  const clientName = placement.client?.name ?? "unknown client";
  const months = monthsBetween(
    placement.start_date,
    placement.status === "ended" && placement.end_date
      ? placement.end_date
      : today,
  );

  return (
    <>
      <PageHeader
        eyebrow="Placement"
        title={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span>
              {candidateName}{" "}
              <span className="font-semibold text-muted">at</span> {clientName}
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

      {/* "melding=deels" is the old Dutch form of the same notice. */}
      {(query.notice === "partial" || query.melding === "deels") && (
        <div className="mb-6">
          <FormMessage error="The placement was saved, but not everything was updated. Check the status of the vacancy, the candidate and the tasks." />
        </div>
      )}

      {academy && <PlacementTabs placementId={placement.id} active={tab} />}

      {tab === "academy" ? (
        <Suspense fallback={<ListSkeleton rows={6} />}>
          <PlacementAcademyTab placementId={placement.id} />
        </Suspense>
      ) : (
        <RecordLayout
          entity="placement"
          recordId={placement.id}
          layout={layout}
          gridClassName="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_380px]"
          mainClassName="min-w-0 space-y-6"
          sideClassName="min-w-0 space-y-6"
          blocks={{
            details: (
              <Card>
                <CardHeader title={blockLabel(layout, "details")} />
                <CardBody>
                  <DetailList
                    items={applyFieldLayout(details, [
                      {
                        key: "candidate",
                        label: "Candidate",
                        value: placement.candidate ? (
                          <Link
                            href={`/dashboard/candidates/${placement.candidate.id}`}
                            className="font-medium text-brand-700 hover:underline"
                          >
                            {placement.candidate.full_name}
                          </Link>
                        ) : null,
                      },
                      {
                        key: "client",
                        label: "Client",
                        value: placement.client ? (
                          <Link
                            href={`/dashboard/clients/${placement.client.id}`}
                            className="font-medium text-brand-700 hover:underline"
                          >
                            {placement.client.name}
                          </Link>
                        ) : null,
                      },
                      {
                        key: "vacancy",
                        label: "Vacancy",
                        value: placement.vacancy ? (
                          <Link
                            href={`/dashboard/vacancies/${placement.vacancy.id}`}
                            className="font-medium text-brand-700 hover:underline"
                          >
                            {placement.vacancy.title}
                          </Link>
                        ) : null,
                      },
                      {
                        key: "monthly_rate",
                        label: "Monthly rate",
                        value:
                          placement.monthly_rate !== null
                            ? formatCurrency(placement.monthly_rate)
                            : null,
                      },
                      {
                        key: "start_date",
                        label: "Start date",
                        value: formatDate(placement.start_date),
                      },
                      {
                        key: "duration",
                        label: "Duration",
                        value:
                          placement.start_date > today
                            ? "Not started yet"
                            : `${months} ${months === 1 ? "month" : "months"}`,
                      },
                      {
                        key: "next_checkin",
                        label: "Next check-in",
                        value: (
                          <CheckinDate
                            date={placement.next_checkin_at}
                            status={placement.status}
                            today={today}
                          />
                        ),
                      },
                      {
                        key: "notice",
                        label:
                          placement.status === "active"
                            ? "Notice period"
                            : "Notice given on",
                        value:
                          placement.status === "active"
                            ? `One month. With notice given today, the last day is ${formatDate(addMonths(today, 1))}.`
                            : placement.notice_given_at
                              ? formatDate(placement.notice_given_at)
                              : null,
                      },
                      {
                        key: "end_date",
                        label: "End date",
                        value: placement.end_date
                          ? formatDate(placement.end_date)
                          : "None, ongoing",
                      },
                    ])}
                  />
                  {placement.notes && !notesField.hidden && (
                    <div className="mt-6 border-t border-border pt-4">
                      <p className="text-xs font-medium tracking-wide text-muted uppercase">
                        {notesField.label}
                      </p>
                      <p className="mt-1 text-sm leading-relaxed whitespace-pre-line text-ink">
                        {placement.notes}
                      </p>
                    </div>
                  )}
                </CardBody>
              </Card>
            ),
            checkins: (
              <Card>
                <CardHeader
                  title={blockLabel(layout, "checkins")}
                  description="Regular contact with the client about how things are going."
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
            ),
            guarantee: (
              <Card>
                <CardHeader title={blockLabel(layout, "guarantee")} />
                <CardBody>
                  <GuaranteeProgress
                    startDate={placement.start_date}
                    guaranteeUntil={placement.guarantee_until}
                    status={placement.status}
                    today={today}
                  />
                </CardBody>
              </Card>
            ),
            academy: (
              <Suspense fallback={<ListSkeleton rows={3} />}>
                <PlacementAcademyCard placementId={placement.id} />
              </Suspense>
            ),
            wsp: placement.candidate && (
              <Suspense fallback={<ListSkeleton rows={2} />}>
                <WspCandidateCard
                  candidateId={placement.candidate.id}
                  title={blockLabel(layout, "wsp")}
                />
              </Suspense>
            ),
            extras: (
              <Suspense fallback={<ListSkeleton rows={3} />}>
                <EntityExtras entityType="placement" entityId={placement.id} />
              </Suspense>
            ),
          }}
        />
      )}
    </>
  );
}

async function Checkins({ placementId }: { placementId: string }) {
  const checkins = await listCheckins(placementId);
  return <CheckinList checkins={checkins} />;
}

function DetailSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading">
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
