import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/dashboard/page-header";
import { CandidateForm } from "@/components/candidates/candidate-form";
import { ListSkeleton } from "@/components/ui/skeleton";
import { requireStaff } from "@/lib/auth";
import { isUuid, listStaffOptions } from "@/lib/data/candidates";
import { MAX_UPLOAD_BYTES } from "@/lib/storage";

export const metadata: Metadata = {
  title: "Nieuwe kandidaat",
};

export default function Page({ searchParams }: PageProps<"/dashboard/kandidaten/nieuw">) {
  return (
    <>
      <PageHeader
        eyebrow="Kandidaten"
        title="Nieuwe kandidaat"
        description="Leg het profiel vast. Skills, cv en video-intro helpen de klant straks kiezen."
      />
      <Suspense fallback={<ListSkeleton rows={8} />}>
        <NewCandidate searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function NewCandidate({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [user, owners, params] = await Promise.all([requireStaff(), listStaffOptions(), searchParams]);
  const vacancy = typeof params.vacature === "string" && isUuid(params.vacature) ? params.vacature : undefined;

  return (
    <div className="max-w-3xl">
      <CandidateForm
        owners={owners}
        defaultOwnerId={user.id}
        maxUploadMb={Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}
        vacancyId={vacancy}
      />
    </div>
  );
}
