"use client";

import { useActionState, useState } from "react";
import { Play } from "lucide-react";
import { CompanyPicker } from "@/components/sales/company-picker";
import { Field, FormMessage, Input } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import type { StartState } from "@/app/dashboard/sequences/actions";
import type { CompanyOption } from "@/lib/data/sequences";

/** Start the sequence for one or more companies. */
export function StartSequenceForm({
  action,
  search,
  disabledReason,
}: {
  action: (prev: StartState, formData: FormData) => Promise<StartState>;
  search: (query: string) => Promise<CompanyOption[]>;
  disabledReason: string | null;
}) {
  const [round, setRound] = useState(0);
  const [state, formAction] = useActionState(async (prev: StartState, formData: FormData) => {
    const result = await action(prev, formData);
    if (result.ok) setRound((r) => r + 1);
    return result;
  }, {} as StartState);
  const failed = state.results?.filter((r) => r.error) ?? [];

  if (disabledReason) {
    return <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">{disabledReason}</p>;
  }
  return (
    <form action={formAction} className="space-y-4">
      <CompanyPicker key={round} search={search} />
      <Field label="Start date" htmlFor="sequence-start" hint="Day 0 of the sequence. Default today.">
        <Input id="sequence-start" name="start" type="date" className="sm:w-48" />
      </Field>
      <SubmitButton pendingLabel="Starting" className="max-sm:w-full">
        <Play aria-hidden="true" />
        Start sequence
      </SubmitButton>
      <FormMessage error={state.error} success={state.ok ? state.message : undefined} />
      {failed.length > 0 && (
        <ul className="list-inside list-disc text-sm text-muted">
          {failed.map((r) => (
            <li key={r.name}>
              {r.name}: {r.error}
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}
