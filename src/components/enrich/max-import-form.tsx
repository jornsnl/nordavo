"use client";

import { useActionState } from "react";
import { Upload } from "lucide-react";
import { importEnrichAction, type MaxImportState } from "@/app/dashboard/contacts/enrich/actions";
import { Field, FormMessage, Input } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";

export function MaxImportForm() {
  const [state, formAction] = useActionState(importEnrichAction, {} as MaxImportState);
  const result = state.result;
  return (
    <form action={formAction} className="space-y-4">
      <Field
        label="CSV from Max"
        htmlFor="max-file"
        required
        error={state.fieldErrors?.file}
        hint="We match on the LinkedIn URL of the person. A column with the number type (mobile or landline) is used when present. Contacts that get a number go to Enriched."
      >
        <Input
          id="max-file"
          name="file"
          type="file"
          accept=".csv,text/csv"
          required
          aria-invalid={Boolean(state.fieldErrors?.file)}
          aria-describedby={state.fieldErrors?.file ? "max-file-error" : undefined}
        />
      </Field>
      <SubmitButton size="sm" className="max-sm:w-full pointer-coarse:min-h-11" pendingLabel="Importing">
        <Upload aria-hidden="true" />
        Import
      </SubmitButton>
      <FormMessage error={state.error} success={state.ok ? state.message : undefined} />
      {result && (
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          {[
            ["Rows", result.rows],
            ["Matched", result.matched],
            ["Number saved", result.updated],
            ["Already had a number", result.alreadyHadPhone],
            ["No number in file", result.noPhone],
            ["Not found", result.unmatched],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl border border-border bg-surface/60 px-3 py-2">
              <dt className="text-xs text-muted">{label}</dt>
              <dd className="font-display text-lg font-semibold text-brand-900 tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {result && result.unmatchedSamples.length > 0 && (
        <div className="text-sm">
          <p className="font-medium text-ink">Not found, for example:</p>
          <ul className="mt-1 list-inside list-disc text-muted">
            {result.unmatchedSamples.map((s) => (
              <li key={s} className="break-all">
                {s}
              </li>
            ))}
          </ul>
        </div>
      )}
    </form>
  );
}
