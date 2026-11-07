"use client";

import { useActionState, useEffect, useRef } from "react";
import { Download, ExternalLink, FileSpreadsheet, Send } from "lucide-react";
import {
  exportCallListAction,
  exportMaxAction,
  pushMailCampaignAction,
  type ExportActionState,
} from "@/app/dashboard/lists/actions";
import { Field, FormMessage, Input, Select } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialActionState, type ActionState } from "@/lib/action-state";
import type { ListFilter } from "@/lib/gtm/lists";
import type { SignalType } from "@/lib/database.types";
import { FilterFields } from "./filter-fields";

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

/** Start the download once per export. */
function useCsvDownload(state: ExportActionState) {
  const done = useRef<string | null>(null);
  useEffect(() => {
    if (!state.csv || !state.filename) return;
    const key = state.token ?? state.filename;
    if (done.current === key) return;
    done.current = key;
    downloadCsv(state.csv, state.filename);
  }, [state]);
}

function ExportResult({ state }: { state: ExportActionState }) {
  return (
    <div className="space-y-2">
      <FormMessage error={state.error} success={state.ok ? state.message : undefined} />
      {state.ok && state.url && (
        <a
          href={state.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 hover:underline max-md:min-h-11"
        >
          Open the Google Sheet
          <ExternalLink className="size-4" aria-hidden="true" />
        </a>
      )}
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
    </div>
  );
}

export function CallListExportForm({ filter, sheetsEnabled, disabled }: { filter: ListFilter; sheetsEnabled: boolean; disabled: boolean }) {
  const [state, formAction] = useActionState(exportCallListAction, initialActionState as ExportActionState);
  useCsvDownload(state);
  return (
    <form action={formAction} className="space-y-3">
      <FilterFields filter={filter} />
      <div className="flex flex-wrap gap-2">
        {sheetsEnabled && (
          <SubmitButton name="deliver" value="sheet" size="sm" className="max-sm:w-full pointer-coarse:min-h-11" disabled={disabled} pendingLabel="Working">
            <FileSpreadsheet aria-hidden="true" />
            Google Sheet for Web Partners
          </SubmitButton>
        )}
        <SubmitButton name="deliver" value="csv" size="sm" className="max-sm:w-full pointer-coarse:min-h-11" variant={sheetsEnabled ? "secondary" : "primary"} disabled={disabled}>
          <Download aria-hidden="true" />
          Download CSV
        </SubmitButton>
      </div>
      {!sheetsEnabled && <p className="text-xs text-muted">Google Sheets is not set up, so CSV only.</p>}
      <ExportResult state={state} />
    </form>
  );
}

export function MaxExportForm({ filter, disabled }: { filter: ListFilter; disabled: boolean }) {
  const [state, formAction] = useActionState(exportMaxAction, initialActionState as ExportActionState);
  useCsvDownload(state);
  return (
    <form action={formAction} className="space-y-3">
      <FilterFields filter={filter} omit={["signal"]} />
      <SubmitButton size="sm" className="max-sm:w-full pointer-coarse:min-h-11" disabled={disabled} pendingLabel="Working">
        <Download aria-hidden="true" />
        CSV for Max
      </SubmitButton>
      <ExportResult state={state} />
    </form>
  );
}

export function MailPushForm({
  filter,
  instantlyEnabled,
  disabled,
  signalOptions,
}: {
  filter: ListFilter;
  instantlyEnabled: boolean;
  disabled: boolean;
  signalOptions: { value: SignalType; label: string }[];
}) {
  const [state, formAction] = useActionState(pushMailCampaignAction, initialActionState as ActionState);
  return (
    <form action={formAction} className="space-y-3">
      <FilterFields filter={filter} omit={["signal", "limit"]} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Campaign" htmlFor="mail-signal" hint="One campaign per signal.">
          <Select id="mail-signal" name="signal" defaultValue={filter.signalType ?? ""} disabled={!instantlyEnabled}>
            <option value="">All signals, each its own campaign</option>
            {signalOptions.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Number of contacts" htmlFor="mail-limit" hint="At most 200 at a time.">
          <Input id="mail-limit" name="limit" type="number" min={1} max={200} inputMode="numeric" enterKeyHint="done" defaultValue={Math.min(filter.limit, 50)} disabled={!instantlyEnabled} />
        </Field>
      </div>
      <SubmitButton size="sm" className="max-sm:w-full pointer-coarse:min-h-11" disabled={disabled || !instantlyEnabled} pendingLabel="Writing opening lines and sending to Instantly">
        <Send aria-hidden="true" />
        Send to Instantly
      </SubmitButton>
      {!instantlyEnabled && <p className="text-xs text-muted">Instantly is not set up: set INSTANTLY_API_KEY in the environment.</p>}
      <FormMessage error={state.error} success={state.ok ? state.message : undefined} />
    </form>
  );
}
