"use client";

import { startTransition, useActionState, useId, useTransition } from "react";
import { Download, FileText, LoaderCircle, Upload } from "lucide-react";
import { uploadJobFileAction } from "@/app/dashboard/vacancies/actions";
import { getAttachmentUrl } from "@/components/entity/actions";
import { initialActionState } from "@/lib/action-state";
import { formatDate } from "@/lib/format";
import { FormMessage } from "@/components/ui/field";

/**
 * The client's own vacancy (PDF or Word) on the vacancy page: stored with
 * the vacancy and read into the job profile and requirements.
 */
export function JobFileUpload({
  vacancyId,
  files,
  failed = false,
}: {
  vacancyId: string;
  files: { id: string; fileName: string; createdAt: string }[];
  /** The upload from the vacancy form did not work. */
  failed?: boolean;
}) {
  const id = useId();
  const [state, formAction, pending] = useActionState(uploadJobFileAction.bind(null, vacancyId), initialActionState);
  const [, startOpen] = useTransition();

  function open(fileId: string) {
    startOpen(async () => {
      const result = await getAttachmentUrl(fileId);
      if (!("error" in result)) window.open(result.url, "_blank", "noopener,noreferrer");
    });
  }

  return (
    <div className="space-y-3">
      {files.length > 0 && (
        <ul className="divide-y divide-border rounded-xl border border-border bg-white">
          {files.map((f) => (
            <li key={f.id} className="flex items-center gap-2 px-3 py-2 text-sm">
              <FileText className="size-4 shrink-0 text-brand-600" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-ink">{f.fileName}</span>
                <span className="block text-xs text-muted">Client vacancy, {formatDate(f.createdAt)}</span>
              </span>
              <button
                type="button"
                onClick={() => open(f.id)}
                aria-label={`Download ${f.fileName}`}
                className="flex size-9 items-center justify-center rounded-lg text-muted hover:bg-brand-50 hover:text-brand-700 focus-visible:outline-2 focus-visible:outline-brand-500"
              >
                <Download className="size-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <label
        htmlFor={id}
        className={`flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-brand-200 bg-surface/60 px-4 py-3 text-sm font-medium text-brand-900 transition hover:border-brand-500 hover:bg-brand-50 has-focus-visible:outline-2 has-focus-visible:outline-brand-500 ${
          pending ? "pointer-events-none opacity-70" : ""
        }`}
      >
        {pending ? <LoaderCircle className="size-4 animate-spin text-brand-600" aria-hidden="true" /> : <Upload className="size-4 text-brand-600" aria-hidden="true" />}
        {pending ? "Reading the vacancy" : files.length > 0 ? "Upload another client vacancy (PDF or Word)" : "Upload the client's vacancy (PDF or Word)"}
        <input
          id={id}
          type="file"
          name="job_file"
          accept=".pdf,.docx,.doc,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword"
          className="sr-only"
          disabled={pending}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            const data = new FormData();
            data.set("job_file", file);
            startTransition(() => formAction(data));
            event.target.value = "";
          }}
        />
      </label>
      <p className="text-xs text-muted">Read into the job profile and the requirements when those are still empty. Nothing you wrote is overwritten.</p>
      <div aria-live="polite">
        <FormMessage
          error={state.error ?? (failed && !state.ok ? "The vacancy file from the form could not be read. Upload it again here." : undefined)}
          success={state.ok ? state.message : undefined}
        />
      </div>
    </div>
  );
}
