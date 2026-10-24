"use client";

import { useActionState } from "react";
import { Upload } from "lucide-react";
import { importMaxAction, type MaxImportState } from "@/app/dashboard/lijsten/actions";
import { Field, FormMessage, Input } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";

export function MaxImportForm() {
  const [state, formAction] = useActionState(importMaxAction, {} as MaxImportState);
  const result = state.result;
  return (
    <form action={formAction} className="space-y-4">
      <Field
        label="CSV van Max"
        htmlFor="max-file"
        required
        error={state.fieldErrors?.file}
        hint="We koppelen op de LinkedIn URL van de persoon. Een kolom met het type nummer (mobiel of vast) gebruiken we als die er is."
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
      <SubmitButton size="sm" pendingLabel="Bezig met importeren">
        <Upload aria-hidden="true" />
        Importeren
      </SubmitButton>
      <FormMessage error={state.error} success={state.ok ? state.message : undefined} />
      {result && (
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          {[
            ["Regels", result.rows],
            ["Gekoppeld", result.matched],
            ["Nummer opgeslagen", result.updated],
            ["Had al een nummer", result.alreadyHadPhone],
            ["Geen nummer in bestand", result.noPhone],
            ["Niet gevonden", result.unmatched],
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
          <p className="font-medium text-ink">Niet gevonden, bijvoorbeeld:</p>
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
