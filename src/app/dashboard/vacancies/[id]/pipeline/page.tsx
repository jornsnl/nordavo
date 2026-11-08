import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ListOrdered, Sheet } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { PipelineBoard } from "@/components/pipeline/pipeline-board";
import { FormPipelineLinks } from "@/components/forms/vacancy-form-card";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getPipeline } from "@/lib/data/applications";
import { isUuid, listCandidateOptions } from "@/lib/data/candidates";
import { listStaff } from "@/lib/data/tasks";
import { formatDate } from "@/lib/format";
import { optionFor, vacancyStatuses } from "@/lib/labels";

export const metadata: Metadata = {
  title: "Pipeline",
};

export default function Page({ params, searchParams }: PageProps<"/dashboard/vacancies/[id]/pipeline">) {
  return (
    <Suspense fallback={<BoardSkeleton />}>
      <Pipeline params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Pipeline({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const [pipeline, candidates, staff, query] = await Promise.all([
    getPipeline(id),
    listCandidateOptions(),
    listStaff(),
    searchParams,
  ]);
  if (!pipeline) notFound();

  const { vacancy, applications } = pipeline;
  const status = optionFor(vacancyStatuses, vacancy.status);
  const requested = typeof query.application === "string" ? query.application : undefined;
  const initialOpenId =
    isUuid(requested) && applications.some((a) => a.id === requested) ? requested : undefined;

  return (
    <>
      <Link
        href={`/dashboard/vacancies/${vacancy.id}`}
        className="mb-4 inline-flex items-center gap-1.5 rounded-lg text-sm font-medium text-muted hover:text-brand-700 focus-visible:outline-2 focus-visible:outline-brand-500"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to vacancy
      </Link>
      <PageHeader
        eyebrow={vacancy.client?.name ?? "Pipeline"}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {vacancy.title}
            <Badge tone={status.tone}>{status.label}</Badge>
          </span>
        }
        description={
          vacancy.client ? (
            <>
              Pipeline for{" "}
              <Link href={`/dashboard/clients/${vacancy.client.id}`} className="text-brand-700 hover:underline">
                {vacancy.client.name}
              </Link>
              . Drag cards to the next stage, or tick several and move them at once.
            </>
          ) : (
            "Drag cards to the next stage, or tick several and move them at once."
          )
        }
        actions={
          <>
            <FormPipelineLinks vacancyId={vacancy.id} />
            <ButtonLink href={`/dashboard/vacancies/${vacancy.id}/import`} variant="secondary" size="sm">
              <Sheet aria-hidden="true" />
              Import
            </ButtonLink>
            <ButtonLink href={`/dashboard/vacancies/${vacancy.id}/ranking`} variant="secondary" size="sm">
              <ListOrdered aria-hidden="true" />
              CV ranking
            </ButtonLink>
          </>
        }
      />
      {vacancy.status === "on_hold" && (
        <p role="status" className="mb-4 rounded-2xl border border-amber-600/20 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          This vacancy is parked{vacancy.parked_at ? ` since ${formatDate(vacancy.parked_at)}` : ""}
          {vacancy.park_reason ? `: ${vacancy.park_reason}` : "."} Unpark it on the vacancy page.
        </p>
      )}
      <PipelineBoard
        // Remount when switching vacancies so local board state never leaks.
        key={vacancy.id}
        vacancyId={vacancy.id}
        applications={applications}
        candidates={candidates}
        staff={staff}
        initialOpenId={initialOpenId}
      />
    </>
  );
}

function BoardSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading pipeline">
      <Skeleton className="mb-4 h-4 w-40" />
      <Skeleton className="mb-8 h-10 w-80 max-w-full" />
      <Skeleton className="mb-4 h-6 w-48" />
      <div className="flex gap-3 overflow-hidden">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="w-[17rem] shrink-0 space-y-2 rounded-2xl border border-border bg-surface/60 p-3">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-28 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
