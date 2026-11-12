import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/dashboard/page-header";
import { AgendaView } from "@/components/agenda/agenda-view";
import { PageSkeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = {
  title: "Agenda",
};

/**
 * Recruitment agenda: every date of vacancies, placements, candidates and
 * interviews in one calendar, plus the public holidays that touch a running
 * placement, and one overview of all roles. Nothing is entered here; every
 * item opens its record. Filters live in the URL:
 *   ?view=day|week|month|list|roles&date=YYYY-MM-DD&scope=mine|team&kinds=vacancies,interviews
 */
export default function Page({ searchParams }: PageProps<"/dashboard/agenda">) {
  return (
    <>
      <PageHeader
        eyebrow="Recruitment"
        title="Agenda"
        description="Deadlines, intakes, interviews, starts, check-ins and holidays, straight from the records."
      />
      <Suspense fallback={<PageSkeleton />}>
        <AgendaView searchParams={searchParams} />
      </Suspense>
    </>
  );
}
