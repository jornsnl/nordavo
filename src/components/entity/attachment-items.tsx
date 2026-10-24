"use client";

import { useId, useRef, useState, useTransition } from "react";
import { Download, FileText, LoaderCircle, Trash2, Upload } from "lucide-react";
import type { EntityType } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/field";
import { createUploadTarget, deleteAttachment, getAttachmentUrl, saveAttachment } from "./actions";

const BUCKET = "attachments";

/** Upload straight to storage with a signed URL, then record it on the server. */
export function AttachmentUploader({
  entityType,
  entityId,
  maxBytes,
}: {
  entityType: EntityType;
  entityId: string;
  maxBytes: number;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const maxMb = Math.round(maxBytes / 1024 / 1024);

  async function upload(file: File) {
    setError(undefined);
    setMessage(undefined);
    if (file.size > maxBytes) {
      setError(`${file.name} is te groot. Het maximum is ${maxMb} MB.`);
      return;
    }
    if (file.size === 0) {
      setError(`${file.name} is leeg.`);
      return;
    }

    setBusy(true);
    try {
      const target = await createUploadTarget({ entityType, entityId, fileName: file.name, size: file.size });
      if (!target.ok) {
        setError(target.error);
        return;
      }
      const supabase = createClient();
      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .uploadToSignedUrl(target.path, target.token, file, { contentType: file.type || undefined });
      if (uploadError) {
        setError("Uploaden is niet gelukt. Probeer het opnieuw.");
        return;
      }
      const result = await saveAttachment({
        entityType,
        entityId,
        path: target.path,
        fileName: file.name,
        size: file.size,
        mimeType: file.type,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      setMessage(`${file.name} is toegevoegd.`);
    } catch {
      setError("Uploaden is niet gelukt. Controleer je verbinding en probeer het opnieuw.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="space-y-2">
      <label
        htmlFor={`${id}-file`}
        className={`flex cursor-pointer flex-col items-center gap-1 rounded-xl border border-dashed border-brand-200 bg-surface/60 px-4 py-5 text-center transition hover:border-brand-500 hover:bg-brand-50 has-focus-visible:outline-2 has-focus-visible:outline-brand-500 ${
          busy ? "pointer-events-none opacity-70" : ""
        }`}
      >
        {busy ? (
          <LoaderCircle className="size-5 animate-spin text-brand-600" aria-hidden="true" />
        ) : (
          <Upload className="size-5 text-brand-600" aria-hidden="true" />
        )}
        <span className="text-sm font-medium text-brand-900">{busy ? "Bezig met uploaden" : "Bestand uploaden"}</span>
        <span className="text-xs text-muted">Maximaal {maxMb} MB</span>
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
      <div aria-live="polite">
        <FormMessage error={error} success={message} />
      </div>
    </div>
  );
}

export function AttachmentRow({
  attachment,
}: {
  attachment: { id: string; fileName: string; size: string; uploaderName: string; timeAgo: string };
}) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string>();
  const [downloading, startDownload] = useTransition();
  const [deleting, startDelete] = useTransition();

  return (
    <li className="py-2.5 first:pt-0 last:pb-0">
      <div className="flex items-start gap-2">
        <FileText className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <button
            type="button"
            disabled={downloading}
            onClick={() =>
              startDownload(async () => {
                setError(undefined);
                const result = await getAttachmentUrl(attachment.id);
                if ("error" in result) setError(result.error);
                else window.location.assign(result.url);
              })
            }
            className="max-w-full text-left text-sm font-medium break-all text-brand-700 hover:underline focus-visible:outline-2 focus-visible:outline-brand-500"
          >
            {attachment.fileName}
          </button>
          <p className="text-xs text-muted">
            {attachment.size}, {attachment.uploaderName}, {attachment.timeAgo}
          </p>
        </div>
        <span className="flex shrink-0">
          {downloading ? (
            <span className="flex size-8 items-center justify-center">
              <LoaderCircle className="size-3.5 animate-spin text-muted" aria-label="Bezig met downloaden" />
            </span>
          ) : (
            <span className="flex size-8 items-center justify-center text-muted" aria-hidden="true">
              <Download className="size-3.5" />
            </span>
          )}
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="flex size-8 items-center justify-center rounded-lg text-muted hover:bg-danger-bg hover:text-danger focus-visible:outline-2 focus-visible:outline-brand-500"
            aria-label={`${attachment.fileName} verwijderen`}
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
          </button>
        </span>
      </div>
      {confirming && (
        <div className="mt-2 ml-6 flex flex-wrap items-center gap-2 rounded-xl bg-danger-bg px-3 py-2 text-sm" role="group" aria-label="Verwijderen bevestigen">
          <span className="text-danger">Bestand definitief verwijderen?</span>
          <Button
            variant="danger"
            size="sm"
            disabled={deleting}
            onClick={() =>
              startDelete(async () => {
                const result = await deleteAttachment(attachment.id);
                if (result.error) setError(result.error);
                else setConfirming(false);
              })
            }
          >
            Verwijderen
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
            Annuleren
          </Button>
        </div>
      )}
      {error && (
        <div className="mt-2 ml-6">
          <FormMessage error={error} />
        </div>
      )}
    </li>
  );
}
