import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { z } from "zod";
import {
  findPlacementForApplication,
  getApplicationForPlacement,
  getPlacementFormOptions,
} from "@/lib/data/placements";
import { todayIso } from "@/lib/format";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { FormMessage } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { addDays } from "@/components/placements/dates";
import { PlacementForm, type PlacementFormValues } from "@/components/placements/placement-form";
import { createPlacement } from "../actions";

export const metadata: Metadata = {
  title: "New placement",
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function Page({ searchParams }: { searchParams: SearchParams }) {
  return (
    <>
      <PageHeader
        eyebrow="Placements"
        title="New placement"
        description="Record who starts where. We mark the vacancy as filled and schedule the first check-in and the guarantee period review."
      />
      <Card className="max-w-3xl">
        <CardBody className="py-6">
          <Suspense fallback={<FormSkeleton />}>
            <NewPlacement searchParams={searchParams} />
          </Suspense>
        </CardBody>
      </Card>
    </>
  );
}

async function NewPlacement({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const applicationParam = typeof params.application === "string" ? params.application : "";
  const applicationId = z.guid().safeParse(applicationParam).success ? applicationParam : null;

  const [options, application, existing] = await Promise.all([
    getPlacementFormOptions(),
    applicationId ? getApplicationForPlacement(applicationId) : null,
    applicationId ? findPlacementForApplication(applicationId) : null,
  ]);

  if (existing) {
    return (
      <div className="space-y-4">
        <FormMessage error="A placement already exists for this candidate on this vacancy." />
        <Link
          href={`/dashboard/placements/${existing.id}`}
          className="inline-block text-sm font-semibold text-brand-600 hover:underline"
        >
          View the placement
        </Link>
      </div>
    );
  }

  const startDate = application?.vacancy?.desired_start_date ?? todayIso();
  const defaults: PlacementFormValues = application?.vacancy
    ? {
        application_id: application.id,
        client_id: application.vacancy.client_id ?? undefined,
        candidate_id: application.candidate_id,
        vacancy_id: application.vacancy.id,
        monthly_rate: application.vacancy.monthly_budget,
        start_date: startDate,
        next_checkin_at: addDays(startDate, 14),
      }
    : {
        start_date: todayIso(),
        next_checkin_at: addDays(todayIso(), 14),
      };

  return (
    <>
      {applicationId && !application && (
        <div className="mb-6">
          <FormMessage error="We could not find this application. Choose the client and candidate yourself." />
        </div>
      )}
      {application?.vacancy && (
        <p className="mb-6 text-sm text-muted">
          From the pipeline:{" "}
          <span className="font-medium text-ink">{application.candidate?.full_name}</span> at{" "}
          <span className="font-medium text-ink">{application.vacancy.client?.name}</span> for{" "}
          <span className="font-medium text-ink">{application.vacancy.title}</span>.
        </p>
      )}
      <PlacementForm
        action={createPlacement}
        mode="create"
        options={{
          clients: options.clients,
          candidates: options.candidates,
          vacancies: options.vacancies,
        }}
        defaults={defaults}
        locked={Boolean(application?.vacancy)}
        cancelHref="/dashboard/placements"
      />
    </>
  );
}

function FormSkeleton() {
  return (
    <div className="grid gap-5 sm:grid-cols-2" aria-busy="true" aria-label="Loading">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-11 w-full" />
        </div>
      ))}
    </div>
  );
}
