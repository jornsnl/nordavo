import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/dashboard/page-header";
import { CandidateForm } from "@/components/candidates/candidate-form";
import { ListSkeleton, Skeleton } from "@/components/ui/skeleton";
import { getCandidate, listStaffOptions } from "@/lib/data/candidates";
import { MAX_UPLOAD_BYTES } from "@/lib/storage";

export const metadata: Metadata = {
  title: "Kandidaat bewerken",
};

export default function Page({ params, searchParams }: PageProps<"/dashboard/kandidaten/[id]/bewerken">) {
  return (
    <Suspense
      fallback={
        <>
          <Skeleton className="mb-8 h-10 w-64" />
          <ListSkeleton rows={8} />
        </>
      }
    >
      <EditCandidate params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function EditCandidate({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const [candidate, owners, query] = await Promise.all([getCandidate(id), listStaffOptions(), searchParams]);
  if (!candidate) notFound();

  return (
    <>
      <PageHeader eyebrow="Kandidaat bewerken" title={candidate.full_name} />
      <div className="max-w-3xl">
        <CandidateForm
          candidate={candidate}
          owners={owners}
          maxUploadMb={Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}
          notice={
            query.cv === "mislukt"
              ? "De kandidaat is opgeslagen, maar het cv uploaden is mislukt. Probeer het hier opnieuw."
              : undefined
          }
        />
      </div>
    </>
  );
}
