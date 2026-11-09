import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { WspPersonView } from "@/components/wsp/person-view";
import { requireAcademyUser } from "@/lib/academy/auth";

export const metadata: Metadata = { title: "Working Style Profile" };

/** One questionnaire or report of the signed-in person (developers and candidates in the Academy). */
export default function Page({ params }: PageProps<"/academy/working-style/[id]">) {
  return (
    <div lang="en" className="mx-auto max-w-3xl space-y-4">
      <Link href="/academy/working-style" className="inline-flex items-center gap-1.5 text-sm font-medium text-academy-blue-800 hover:underline">
        <ArrowLeft className="size-4" aria-hidden="true" />
        My working style profile
      </Link>
      <Suspense fallback={<Skeleton className="h-96 w-full rounded-2xl" />}>
        <Detail params={params} />
      </Suspense>
    </div>
  );
}

async function Detail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  await requireAcademyUser();
  return <WspPersonView access={{ assessmentId: id }} pdfHref={`/academy/working-style/${id}/pdf`} afterDeleteHref="/academy/working-style" />;
}
