"use client";

import { useActionState } from "react";
import { addExchangeRate } from "@/components/forms/compensation-actions";
import { initialActionState } from "@/lib/action-state";
import { Field, FormMessage, Input } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";

export function ExchangeRateForm({ today }: { today: string }) {
  const [state, formAction] = useActionState(addExchangeRate, initialActionState);
  const errors = state.fieldErrors ?? {};
  return (
    <form action={formAction} className="space-y-4">
      <FormMessage error={state.error} success={state.ok ? state.message : undefined} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="INR per EUR" htmlFor="inr_per_eur" hint="For example 97.25: one euro is ₹97.25." error={errors.inr_per_eur} required>
          <Input id="inr_per_eur" name="inr_per_eur" inputMode="decimal" required aria-invalid={!!errors.inr_per_eur} />
        </Field>
        <Field label="Date of the rate" htmlFor="rate_date" error={errors.rate_date} required>
          <Input id="rate_date" name="rate_date" type="date" defaultValue={today} required />
        </Field>
        <Field label="Note" htmlFor="note" hint="Optional, for example the source.">
          <Input id="note" name="note" maxLength={500} />
        </Field>
      </div>
      <div className="flex justify-end">
        <SubmitButton pendingLabel="Saving…">Save rate</SubmitButton>
      </div>
    </form>
  );
}
