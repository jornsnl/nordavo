import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { CvUpload } from "@/components/screening/cv-upload";
import { ScreeningHeader, ScreeningSkeleton } from "@/components/screening/screening-page";
import { hasClaude } from "@/lib/ai/claude";
import { getScreeningVacancy } from "@/lib/data/screening";

export const metadata: Metadata = {
  title: "Upload CVs",
};

// Each CV is one server action call; Claude may read a PDF.
export const maxDuration = 120;

export default function Page({ params }: PageProps<"/dashboard/vacancies/[id]/cvs">) {
  return (
    <Suspense fallback={<ScreeningSkeleton />}>
      <CvPage params={params} />
    </Suspense>
  );
}

async function CvPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const vacancy = await getScreeningVacancy(id);
  if (!vacancy) notFound();
  return (
    <>
      <ScreeningHeader
        vacancy={vacancy}
        eyebrow="Upload CVs"
        title={vacancy.title}
        description="Drop many CVs at once. Each CV is read, matched to an existing candidate by the email or phone in it, or becomes a new candidate, and lands in this vacancy as Sourced."
      />
      <CvUpload vacancyId={vacancy.id} claude={hasClaude()} />
    </>
  );
}
