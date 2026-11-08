import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { Skeleton, ListSkeleton } from "@/components/ui/skeleton";

/** Back link and header shared by the screening pages of a vacancy. */
export function ScreeningHeader({
  vacancy,
  eyebrow,
  title,
  description,
  actions,
}: {
  vacancy: { id: string; title: string };
  eyebrow: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <>
      <Link
        href={`/dashboard/vacancies/${vacancy.id}`}
        className="mb-4 inline-flex items-center gap-1.5 rounded-lg text-sm font-medium text-muted hover:text-brand-700 focus-visible:outline-2 focus-visible:outline-brand-500"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to {vacancy.title}
      </Link>
      <PageHeader eyebrow={eyebrow} title={title} description={description} actions={actions} />
    </>
  );
}

export function ScreeningSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <Skeleton className="mb-4 h-4 w-40" />
      <Skeleton className="mb-8 h-10 w-80 max-w-full" />
      <ListSkeleton rows={5} />
    </div>
  );
}
