"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Trash2 } from "lucide-react";
import {
  clearDocumentNew,
  completeDocumentUpload,
  createDocument,
  deleteDocumentVersion,
  documentVersionLink,
  getMediaOptions,
  reserveDocumentUpload,
} from "@/app/dashboard/academy/media-actions";
import type { AcademyDocumentCategory, AcademyDocumentRow, AcademyDocumentVersionRow } from "@/lib/academy/database";
import type { ActionState } from "@/lib/action-state";
import { CATEGORY_OPTIONS, formatBytes, isNewDocument } from "@/lib/academy/media/files";
import { formatDateTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input, Select } from "@/components/ui/field";
import { UploadButton, UploadProgress } from "./upload-button";
import { uploadFile } from "./upload";

// Building blocks for documents in the editor: shared by the document and
// worksheet blocks and the document page (/dashboard/academy/documents/[id]).

export const DOCUMENT_ACCEPT = ".pdf,.doc,.docx,.xls,.xlsx,.csv,.ppt,.pptx,.odt,.ods,.txt";


/** Run an action with a message, refresh the server data afterwards. */
export function useMediaRun(after?: () => Promise<void> | void) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ActionState>({});
  async function run(action: () => Promise<ActionState>, options: { confirm?: string } = {}) {
    if (options.confirm && !window.confirm(options.confirm)) return;
    setBusy(true);
    setResult({});
    try {
      const r = await action();
      setResult(r);
      if (!r.error) {
        router.refresh();
        await after?.();
      }
    } catch {
      setResult({ error: "Something went wrong. Try again." });
    } finally {
      setBusy(false);
    }
  }
  return { busy, result, run };
}

/** Pick an existing document of a kind, or make a new one, for a block. */
export function DocumentPicker({
  kind,
  blockId,
  disabled,
  onPick,
}: {
  kind: "download" | "worksheet";
  blockId: string;
  disabled?: boolean;
  onPick: (documentId: string) => Promise<void>;
}) {
  const [options, setOptions] = useState<{ id: string; title: string; detail: string }[] | null>(null);
  const [picked, setPicked] = useState("");
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<AcademyDocumentCategory>(kind === "worksheet" ? "workbook" : "template");
  const { busy, result, run } = useMediaRun();
  const locked = disabled || busy;
  const noun = kind === "worksheet" ? "worksheet" : "document";

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-dashed border-border bg-surface px-4 py-4">
        <p className="mb-3 text-sm text-muted">
          {kind === "worksheet"
            ? "A new worksheet: give it a title, then add its fields. Worksheets are reusable in lessons of both courses."
            : "A new document: give it a title, then upload the file (PDF, Word, Excel). Documents are reusable in lessons of both courses and as module workbook."}
        </p>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem_auto] sm:items-end">
          <Field label="Title" htmlFor={`doc-title-${blockId}`}>
            <Input id={`doc-title-${blockId}`} value={title} maxLength={300} disabled={locked} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Kind" htmlFor={`doc-cat-${blockId}`}>
            <Select id={`doc-cat-${blockId}`} value={category} disabled={locked} onChange={(e) => setCategory(e.target.value as AcademyDocumentCategory)}>
              {CATEGORY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
          <Button size="sm" disabled={locked || !title.trim()} onClick={() => run(() => createDocument({ title, category, kind, blockId }))}>
            Create {noun}
          </Button>
        </div>
      </div>
      <details
        className="rounded-xl border border-border px-4 py-3"
        onToggle={(e) => {
          if ((e.target as HTMLDetailsElement).open && !options) void getMediaOptions(kind).then(setOptions);
        }}
      >
        <summary className="cursor-pointer text-sm font-medium text-brand-900">Or use a {noun} from the library</summary>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <Field label={kind === "worksheet" ? "Worksheet" : "Document"} htmlFor={`doc-pick-${blockId}`} className="min-w-0 flex-1" hint="Edit it once, it changes in every lesson.">
            <Select id={`doc-pick-${blockId}`} value={picked} onChange={(e) => setPicked(e.target.value)} disabled={locked || !options}>
              <option value="">{options ? `Choose a ${noun}` : "Loading…"}</option>
              {(options ?? []).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.title} ({o.detail})
                </option>
              ))}
            </Select>
          </Field>
          <Button size="sm" disabled={locked || !picked} onClick={() =>
              run(async () => {
                await onPick(picked);
                return { ok: true };
              })
            }>
            Use this {noun}
          </Button>
        </div>
      </details>
      <FormMessage error={result.error} success={result.message} />
    </div>
  );
}

/** Versions of a download document: upload a new one (with "new" label), download or delete old ones. */
export function DocumentVersions({
  document,
  versions,
  onChanged,
  compact = false,
}: {
  document: AcademyDocumentRow;
  versions: AcademyDocumentVersionRow[];
  onChanged?: () => Promise<void> | void;
  compact?: boolean;
}) {
  const [progress, setProgress] = useState<number | null>(null);
  const [markNew, setMarkNew] = useState(true);
  const [notes, setNotes] = useState("");
  const { busy, result, run } = useMediaRun(onChanged);

  async function upload(file: File) {
    await run(async () => {
      const target = await reserveDocumentUpload({ documentId: document.id, fileName: file.name, size: file.size });
      if (!target.ok) return { error: target.error };
      setProgress(0);
      try {
        await uploadFile({ bucket: target.bucket, path: target.path, signedUrl: target.signedUrl }, file, { onProgress: setProgress });
      } catch (error) {
        return { error: error instanceof Error ? error.message : "Upload failed." };
      } finally {
        setProgress(null);
      }
      const done = await completeDocumentUpload({
        documentId: document.id,
        version: target.version,
        path: target.path,
        fileName: file.name,
        size: file.size,
        mimeType: file.type,
        notes,
        markNew,
      });
      if (done.ok) setNotes("");
      return done;
    });
  }

  async function open(versionId: string) {
    const link = await documentVersionLink(versionId);
    if ("url" in link) window.location.assign(link.url);
  }

  const current = versions.find((v) => v.version === document.current_version);
  const shown = compact ? versions.slice(0, 3) : versions;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {current ? (
          <>
            <span className="font-medium text-brand-900">Version {current.version}</span>
            <span className="min-w-0 truncate text-muted">
              {current.file_name} · {formatBytes(current.size_bytes)}
            </span>
          </>
        ) : (
          <span className="text-muted">No file yet.</span>
        )}
        {isNewDocument(document.new_until) && (
          <>
            <Badge tone="accent">New until {formatDateTime(document.new_until!)}</Badge>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => clearDocumentNew(document.id))}>
              Remove label
            </Button>
          </>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <Field label="What changed (optional)" htmlFor={`doc-notes-${document.id}`}>
          <Input id={`doc-notes-${document.id}`} value={notes} maxLength={2000} disabled={busy} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <UploadButton label={current ? "Upload a new version" : "Upload the file"} accept={DOCUMENT_ACCEPT} disabled={busy} onFile={(f) => void upload(f)} variant="primary" />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={markNew} onChange={(e) => setMarkNew(e.target.checked)} className="size-4 accent-brand-700" />
        Label as &ldquo;new&rdquo; for two weeks
      </label>
      <UploadProgress value={progress} label="Uploading" />
      <FormMessage error={result.error} success={result.message} />
      {shown.length > 0 && (
        <ul className="divide-y divide-border rounded-xl border border-border text-sm">
          {shown.map((v) => (
            <li key={v.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <span className="w-10 font-medium">v{v.version}</span>
              <span className="min-w-0 flex-1 truncate">
                {v.file_name}
                <span className="text-muted">
                  {" "}
                  · {formatDateTime(v.created_at)}
                  {v.notes ? ` · ${v.notes}` : ""}
                </span>
              </span>
              {v.version === document.current_version && <Badge tone="success">Live</Badge>}
              <Button size="sm" variant="ghost" onClick={() => void open(v.id)} aria-label={`Download version ${v.version}`}>
                <Download aria-hidden="true" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                aria-label={`Delete version ${v.version}`}
                onClick={() => run(() => deleteDocumentVersion(v.id), { confirm: `Delete version ${v.version}?` })}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
