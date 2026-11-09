import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { FileText, Library } from "lucide-react";
import { listLibraryDocuments, listLibraryLessons } from "@/lib/academy/admin";
import { EmptyState } from "@/components/dashboard/empty-state";
import { PageHeader } from "@/components/dashboard/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ListSkeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Academy library" };

export default function Page() {
  return (
    <>
      <PageHeader
        eyebrow="Academy"
        title="Library"
        description="Every lesson and document, and where it is used. Reuse a lesson in another module from the course editor (Reuse a lesson); an edit applies everywhere."
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Suspense fallback={<ListSkeleton rows={6} />}>
            <Lessons />
          </Suspense>
        </div>
        <Suspense fallback={<ListSkeleton rows={3} />}>
          <Documents />
        </Suspense>
      </div>
    </>
  );
}

async function Lessons() {
  const lessons = await listLibraryLessons();
  if (lessons.length === 0) {
    return <EmptyState icon={Library} title="No lessons yet" description="Add a lesson to a module in a course; it shows up here." />;
  }
  return (
    <ul className="space-y-2">
      {lessons.map((l) => (
        <li key={l.id} className="rounded-xl border border-border bg-card px-4 py-3 shadow-xs">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/dashboard/academy/lessons/${l.id}`} className="font-semibold text-brand-800 hover:underline">
              {l.title}
            </Link>
            <Badge tone={l.status === "published" ? "success" : "neutral"}>{l.status === "published" ? "Published" : "Draft"}</Badge>
            <Badge tone="neutral">{l.language.toUpperCase()}</Badge>
            {l.usedIn.length > 1 && <Badge tone="brand">Reused {l.usedIn.length}×</Badge>}
          </div>
          <p className="mt-1 text-xs text-muted">
            {l.usedIn.length === 0 ? "Not in a module" : l.usedIn.map((u) => `${u.courseTitle} · ${u.moduleTitle}`).join("  |  ")}
          </p>
        </li>
      ))}
    </ul>
  );
}

async function Documents() {
  const documents = await listLibraryDocuments();
  return (
    <Card>
      <CardHeader title="Documents" description="Downloads and worksheets, usable in lessons of both courses and as module workbook." />
      <CardBody>
        {documents.length === 0 ? (
          <p className="text-sm text-muted">No documents yet. Uploading documents and worksheets comes with the document block.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {documents.map((d) => (
              <li key={d.id} className="flex items-center gap-2">
                <FileText className="size-4 shrink-0 text-brand-600" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{d.title}</span>
                <Badge tone="neutral">{d.kind === "worksheet" ? "Worksheet" : `v${d.current_version}`}</Badge>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
