import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { CandidateImportWizard } from "@/components/screening/candidate-import-wizard";
import { ScreeningHeader, ScreeningSkeleton } from "@/components/screening/screening-page";
import { getScreeningVacancy } from "@/lib/data/screening";

export const metadata: Metadata = {
  title: "Import candidates",
};

export const maxDuration = 300;

export default function Page({ params }: PageProps<"/dashboard/vacancies/[id]/import">) {
  return (
    <Suspense fallback={<ScreeningSkeleton />}>
      <ImportPage params={params} />
    </Suspense>
  );
}

async function ImportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const vacancy = await getScreeningVacancy(id);
  if (!vacancy) notFound();
  return (
    <>
      <ScreeningHeader
        vacancy={vacancy}
        eyebrow="Import candidates"
        title={vacancy.title}
        description="Load an export from LinkedIn, Naukri or Manatal, or an existing hiring sheet. Every row becomes a candidate in stage Sourced; duplicates are matched on email, phone and LinkedIn."
      />
      <CandidateImportWizard vacancyId={vacancy.id} />
    </>
  );
}
