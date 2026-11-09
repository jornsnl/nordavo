import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { ArrowLeft, GraduationCap } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/dashboard/page-header";
import { TalentPoolSearch } from "@/components/screening/talent-pool-search";
import { ListSkeleton } from "@/components/ui/skeleton";
import { hasClaude } from "@/lib/ai/claude";
import { listOpenVacancyOptions } from "@/lib/data/applications";

export const metadata: Metadata = {
  title: "Talent pool",
};

// Claude ranks the shortlist and may write an anonymous profile.
export const maxDuration = 300;

export default function Page() {
  return (
    <>
      <Link
        href="/dashboard/candidates"
        className="mb-4 inline-flex items-center gap-1.5 rounded-lg text-sm font-medium text-muted hover:text-brand-700 focus-visible:outline-2 focus-visible:outline-brand-500"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        All candidates
      </Link>
      <PageHeader
        eyebrow="Recruitment"
        title="Talent pool"
        description="Ask who the best candidates are for a profile, with the reason, skills, project experience and location, and make an anonymous profile in one click."
        actions={
          <ButtonLink href="/dashboard/candidates/academy" variant="secondary">
            <GraduationCap aria-hidden="true" />
            Academy results
          </ButtonLink>
        }
      />
      <Suspense fallback={<ListSkeleton rows={4} />}>
        <Search />
      </Suspense>
    </>
  );
}

async function Search() {
  const vacancies = await listOpenVacancyOptions();
  return <TalentPoolSearch vacancies={vacancies.map((v) => ({ id: v.id, title: v.title, clientName: v.clientName }))} claude={hasClaude()} />;
}
