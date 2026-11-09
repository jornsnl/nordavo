"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download, ExternalLink, FileSpreadsheet, FileText, LoaderCircle, Presentation, Unlink } from "lucide-react";
import { getDocumentEditor, setBlockDocument } from "@/app/dashboard/academy/media-actions";
import type { AcademyDocumentRow, AcademyDocumentVersionRow } from "@/lib/academy/database";
import { t } from "@/lib/academy/i18n";
import { documentFormat, formatBytes } from "@/lib/academy/media/files";
import { readDocumentState } from "@/lib/academy/media/state";
import { formatAcademyDate } from "@/lib/academy/time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { actionClasses } from "@/components/academy/ui";
import { DocumentPicker, DocumentVersions } from "@/components/academy/media/document-parts";
import type { BlockEditorProps, BlockViewerProps } from "./types";

type EditorDoc = { document: AcademyDocumentRow; versions: AcademyDocumentVersionRow[]; uses: number };

/** Load the block's document for an editor; null while there is none. */
export function useBlockDocument(documentId: string | null) {
  const [loaded, setLoaded] = useState<{ id: string; value: EditorDoc | null } | null>(null);
  const reload = useCallback(async () => {
    if (!documentId) return;
    const value = await getDocumentEditor(documentId);
    setLoaded({ id: documentId, value });
  }, [documentId]);
  useEffect(() => {
    let live = true;
    if (documentId) {
      void getDocumentEditor(documentId).then((value) => {
        if (live) setLoaded({ id: documentId, value });
      });
    }
    return () => {
      live = false;
    };
  }, [documentId]);
  const loading = Boolean(documentId) && loaded?.id !== documentId;
  const doc = documentId && loaded?.id === documentId ? loaded.value : null;
  return { doc, loading, reload };
}

export function EditorLoading() {
  return (
    <p className="flex items-center gap-2 text-sm text-muted">
      <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> Loading…
    </p>
  );
}

/** Document block editor: pick or create a document, upload versions. */
export function DocumentEditor({ block, disabled }: BlockEditorProps) {
  const router = useRouter();
  const { doc, loading, reload } = useBlockDocument(block.documentId);
  if (loading) return <EditorLoading />;
  if (!doc) {
    return (
      <DocumentPicker
        kind="download"
        blockId={block.id}
        disabled={disabled}
        onPick={async (id) => {
          await setBlockDocument(block.id, id);
        }}
      />
    );
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <FileText className="size-4 text-brand-600" aria-hidden="true" />
        <span className="font-medium text-brand-900">{doc.document.title}</span>
        {doc.uses > 1 && <Badge tone="brand">Used {doc.uses}×</Badge>}
        <Link href={`/dashboard/academy/documents/${doc.document.id}`} className="ml-auto inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
          Edit document <ExternalLink className="size-3.5" aria-hidden="true" />
        </Link>
      </div>
      <DocumentVersions document={doc.document} versions={doc.versions} onChanged={reload} compact />
      <Button
        size="sm"
        variant="ghost"
        disabled={disabled}
        onClick={async () => {
          await setBlockDocument(block.id, null);
          router.refresh();
        }}
      >
        <Unlink aria-hidden="true" />
        Use another document
      </Button>
    </div>
  );
}

const formatIcons = { pdf: FileText, word: FileText, excel: FileSpreadsheet, powerpoint: Presentation, other: FileText } as const;

/** Document block for the learner: what it is, version, "new", download (counts as opened). */
export function DocumentViewer({ block, state, locale, timeZone, preview }: BlockViewerProps) {
  const router = useRouter();
  const { document: doc } = readDocumentState(state);
  const tr = (key: Parameters<typeof t>[1], vars?: Record<string, string | number>) => t(locale, key, vars);
  if (!doc || !doc.fileName) return <p className="rounded-xl bg-academy-blue-50 px-4 py-3 text-sm text-academy-blue-800">{tr("document.missing")}</p>;
  const format = documentFormat(doc.fileName);
  const Icon = formatIcons[format];
  const href = `/academy/files/document/${doc.id}${preview ? "" : `?block=${block.id}`}`;
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3 rounded-xl border border-academy-blue-200 bg-academy-blue-50/60 px-4 py-3">
        <Icon className="mt-0.5 size-8 shrink-0 text-academy-blue-600" aria-hidden="true" />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="flex flex-wrap items-center gap-2 font-semibold text-academy-blue-900">
            {doc.title}
            {doc.isNew && <span className="rounded-full bg-academy-orange-600 px-2 py-0.5 text-xs font-bold text-white">{tr("document.new")}</span>}
          </p>
          <p className="text-xs text-muted">
            {[
              tr(`document.category.${doc.category}`),
              tr(`document.format.${format}`),
              formatBytes(doc.sizeBytes),
              tr("document.version", { version: doc.version }),
              doc.updatedAt ? tr("document.updated", { date: formatAcademyDate(doc.updatedAt, locale, timeZone) }) : "",
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {doc.description && <p className="pt-1 text-sm whitespace-pre-line text-ink">{doc.description}</p>}
        </div>
      </div>
      {/* A plain link: the route records the view and redirects to a signed download. */}
      <a
        href={href}
        className={actionClasses("primary")}
        onClick={() => {
          if (!preview) window.setTimeout(() => router.refresh(), 1500);
        }}
      >
        <Download aria-hidden="true" />
        {tr("document.download")}
      </a>
    </div>
  );
}
