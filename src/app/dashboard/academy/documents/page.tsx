import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { ClipboardList, FileText } from "lucide-react";
import { listDocuments } from "@/lib/academy/media/server";
import { EmptyState } from "@/components/dashboard/empty-state";
import { PageHeader } from "@/components/dashboard/page-header";
import { NewDocumentForm } from "@/components/academy/admin/document-forms";
import { CATEGORY_OPTIONS, isNewDocument } from "@/lib/academy/media/files";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ListSkeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Academy documents" };

export default function Page() {
  return (
    <>
      <PageHeader
        eyebrow="Academy"
        title="Documents and worksheets"
        description="Workbooks, templates and checklists to download, and worksheets to fill in. One document can be used in lessons of both courses and as module workbook; edit it once, it changes everywhere."
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Suspense fallback={<ListSkeleton rows={6} />}>
            <Documents />
          </Suspense>
        </div>
        <Card>
          <CardHeader title="New document" />
          <CardBody>
            <NewDocumentForm />
          </CardBody>
        </Card>
      </div>
    </>
  );
}

async function Documents() {
  const documents = await listDocuments();
  if (documents.length === 0) {
    return <EmptyState icon={FileText} title="No documents yet" description="Create one here, or add a document or worksheet block to a lesson." />;
  }
  return (
    <ul className="space-y-2">
      {documents.map((d) => {
        const Icon = d.kind === "worksheet" ? ClipboardList : FileText;
        return (
          <li key={d.id} className="rounded-xl border border-border bg-card px-4 py-3 shadow-xs">
            <div className="flex flex-wrap items-center gap-2">
              <Icon className="size-4 shrink-0 text-brand-600" aria-hidden="true" />
              <Link href={`/dashboard/academy/documents/${d.id}`} className="font-semibold text-brand-800 hover:underline">
                {d.title}
              </Link>
              <Badge tone="neutral">{CATEGORY_OPTIONS.find((c) => c.value === d.category)?.label ?? d.category}</Badge>
              {d.kind === "worksheet" ? (
                <Badge tone="brand">Worksheet · {Array.isArray(d.worksheet_fields) ? d.worksheet_fields.length : 0} fields</Badge>
              ) : (
                <Badge tone={d.current_version ? "neutral" : "warning"}>{d.current_version ? `v${d.current_version}` : "No file"}</Badge>
              )}
              {isNewDocument(d.new_until) && <Badge tone="accent">New</Badge>}
            </div>
            <p className="mt-1 text-xs text-muted">
              {d.uses === 0 ? "Not used yet" : `Used ${d.uses}×`}
              {d.kind === "worksheet" ? ` · ${d.answers} submitted` : ""}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
