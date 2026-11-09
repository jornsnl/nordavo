"use client";

import { useActionState, useEffect, useRef } from "react";
import { Download } from "lucide-react";
import { exportEnrichAction, type ExportActionState } from "@/app/dashboard/contacts/enrich/actions";
import { FormMessage } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";

function downloadCsv(csv: string, filename: string) {
  // BOM so Excel opens accents correctly.
  const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The CSV for Max of everyone in Enrich; downloads once per export. */
export function MaxExportForm({ disabled }: { disabled: boolean }) {
  const [state, formAction] = useActionState(exportEnrichAction, {} as ExportActionState);
  const done = useRef<string | null>(null);
  useEffect(() => {
    if (!state.csv || !state.filename) return;
    const key = state.token ?? state.filename;
    if (done.current === key) return;
    done.current = key;
    downloadCsv(state.csv, state.filename);
  }, [state]);

  return (
    <form action={formAction} className="space-y-3">
      <SubmitButton size="sm" className="max-sm:w-full pointer-coarse:min-h-11" disabled={disabled} pendingLabel="Working">
        <Download aria-hidden="true" />
        CSV for Max
      </SubmitButton>
      <FormMessage error={state.error} success={state.ok ? state.message : undefined} />
      {state.ok && state.csv && state.filename && (
        <button
          type="button"
          onClick={() => downloadCsv(state.csv!, state.filename!)}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 hover:underline max-md:min-h-11"
        >
          Download again
          <Download className="size-4" aria-hidden="true" />
        </button>
      )}
    </form>
  );
}
