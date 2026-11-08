"use client";

import { useId, useRef, useState, useTransition } from "react";
import { Download, FileText, LoaderCircle, Trash2, Upload } from "lucide-react";
import { createUploadTarget, deleteAttachment, getAttachmentUrl } from "@/components/entity/actions";
import { saveApplicationFile } from "@/app/dashboard/vacancies/[id]/pipeline/recruitment-actions";
import type { KindAttachment } from "@/lib/data/recruitment";
import { formatDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import { FormMessage } from "@/components/ui/field";

const MAX_BYTES = 20 * 1024 * 1024;

/**
 * Upload a private file of one kind (background check report, test result)
 * to an application, and list the files of that kind. Files go straight to
 * the private attachments bucket with a signed upload URL and open with a
 * short-lived signed link.
 */
export function KindFiles({
  applicationId,
  kind,
  files,
  label,
  onChange,
}: {
  applicationId: string;
  kind: "background_check" | "test_result";
  files: KindAttachment[];
  label: string;
  onChange: () => void;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [, startTransition] = useTransition();
  const own = files.filter((f) => f.kind === kind);

  async function upload(file: File) {
    setError(undefined);
    setMessage(undefined);
    if (file.size === 0) return setError(`${file.name} is empty.`);
    if (file.size > MAX_BYTES) return setError(`${file.name} is too large. The maximum is 20 MB.`);
    setBusy(true);
    try {
      const target = await createUploadTarget({
        entityType: "application",
        entityId: applicationId,
        fileName: file.name,
        size: file.size,
      });
      if (!target.ok) return setError(target.error);
      const { error: uploadError } = await createClient()
        .storage.from("attachments")
        .uploadToSignedUrl(target.path, target.token, file, { contentType: file.type || undefined });
      if (uploadError) return setError("Upload failed. Try again.");
      const result = await saveApplicationFile({
        applicationId,
        kind,
        path: target.path,
        fileName: file.name,
        size: file.size,
        mimeType: file.type,
      });
      if (result.error) return setError(result.error);
      setMessage(result.message);
      onChange();
    } catch {
      setError("Upload failed. Check your connection and try again.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  function open(fileId: string) {
    startTransition(async () => {
      const result = await getAttachmentUrl(fileId);
      if ("error" in result) setError(result.error);
      else window.open(result.url, "_blank", "noopener,noreferrer");
    });
  }

  function remove(fileId: string) {
    startTransition(async () => {
      const result = await deleteAttachment(fileId);
      if (result.error) setError(result.error);
      else onChange();
    });
  }

  return (
    <div className="space-y-2">
      {own.length > 0 && (
        <ul className="divide-y divide-border rounded-xl border border-border bg-white">
          {own.map((f) => (
            <li key={f.id} className="flex items-center gap-2 px-3 py-2 text-sm">
              <FileText className="size-4 shrink-0 text-brand-600" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-ink">{f.fileName}</span>
                <span className="block text-xs text-muted">
                  {f.uploaderName}, {formatDate(f.createdAt)}
                </span>
              </span>
              <button
                type="button"
                onClick={() => open(f.id)}
                aria-label={`Download ${f.fileName}`}
                className="flex size-9 items-center justify-center rounded-lg text-muted hover:bg-brand-50 hover:text-brand-700 focus-visible:outline-2 focus-visible:outline-brand-500"
              >
                <Download className="size-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => remove(f.id)}
                aria-label={`Delete ${f.fileName}`}
                className="flex size-9 items-center justify-center rounded-lg text-muted hover:bg-danger-bg hover:text-danger focus-visible:outline-2 focus-visible:outline-brand-500"
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <label
        htmlFor={`${id}-file`}
        className={`flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-brand-200 bg-surface/60 px-4 py-3 text-sm font-medium text-brand-900 transition hover:border-brand-500 hover:bg-brand-50 has-focus-visible:outline-2 has-focus-visible:outline-brand-500 ${
          busy ? "pointer-events-none opacity-70" : ""
        }`}
      >
        {busy ? (
          <LoaderCircle className="size-4 animate-spin text-brand-600" aria-hidden="true" />
        ) : (
          <Upload className="size-4 text-brand-600" aria-hidden="true" />
        )}
        {busy ? "Uploading" : label}
        <input
          ref={input}
          id={`${id}-file`}
          type="file"
          className="sr-only"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
          }}
        />
      </label>
      <p className="text-xs text-muted">Private: only the Nordavo team can open it. Max 20 MB.</p>
      <div aria-live="polite">
        <FormMessage error={error} success={message} />
      </div>
    </div>
  );
}
