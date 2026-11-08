import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { KanbanSquare } from "lucide-react";
import { ScreeningHeader, ScreeningSkeleton } from "@/components/screening/screening-page";
import { TechstackPanel } from "@/components/screening/techstack-panel";
import { ButtonLink } from "@/components/ui/button";
import { hasClaude } from "@/lib/ai/claude";
import { getScreeningVacancy, listTechstackRows } from "@/lib/data/screening";
import { requiredHits } from "@/lib/screening/techstack";

export const metadata: Metadata = {
  title: "Techstack check",
};

export const maxDuration = 300;

export default function Page({ params }: PageProps<"/dashboard/vacancies/[id]/techstack">) {
  return (
    <Suspense fallback={<ScreeningSkeleton />}>
      <TechstackPage params={params} />
    </Suspense>
  );
}

async function TechstackPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const vacancy = await getScreeningVacancy(id);
  if (!vacancy) notFound();
  const rows = await listTechstackRows(vacancy.id);
  return (
    <>
      <ScreeningHeader
        vacancy={vacancy}
        eyebrow="Techstack check"
        title={vacancy.title}
        description="Take out the profiles that clearly do not fit, before the form goes out. The check proposes; you confirm before anyone moves."
        actions={
          <ButtonLink href={`/dashboard/vacancies/${vacancy.id}/pipeline`} variant="secondary">
            <KanbanSquare aria-hidden="true" />
            Pipeline
          </ButtonLink>
        }
      />
      <TechstackPanel
        vacancyId={vacancy.id}
        rows={rows}
        rules={{ stack: vacancy.stack, excluded_profiles: vacancy.excluded_profiles, techstack_min_hits: vacancy.techstack_min_hits, requiredHits: requiredHits(vacancy) }}
        claude={hasClaude()}
      />
    </>
  );
}
