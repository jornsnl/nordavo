import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { WspReportView } from "@/components/wsp/report-view";
import { requireClient } from "@/lib/auth";
import { loadReport } from "@/lib/wsp/data";

export const metadata: Metadata = { title: "Working style profile" };

/**
 * A shared Working Style Profile in the client portal. Only with an active
 * share of the person for this client; every view is logged. Never answers
 * or flags. After withdrawal the page is gone at once (404).
 */
export default function Page({ params }: PageProps<"/portal/working-style/[id]">) {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link href="/portal/working-style" className="inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-brand-700">
        <ArrowLeft className="size-4" aria-hidden="true" />
        Working style profiles
      </Link>
      <Suspense fallback={<Skeleton className="h-96 w-full rounded-2xl" />}>
        <Report params={params} />
      </Suspense>
    </div>
  );
}

async function Report({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  await requireClient();
  const report = await loadReport({ assessmentId: id });
  if (!report || report.audience !== "client") notFound();
  return <WspReportView report={report} audience="client" pdfHref={`/portal/working-style/${id}/pdf`} />;
}
