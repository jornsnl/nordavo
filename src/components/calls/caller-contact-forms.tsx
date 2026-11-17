"use client";

import { useActionState, useEffect, useRef } from "react";
import { type ActionState, initialActionState } from "@/lib/action-state";
import { Field, FormMessage, Select, Textarea } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { callOutcomes } from "@/lib/sales/labels";

type FormAction = (state: ActionState, formData: FormData) => Promise<ActionState>;

/** Corrections a caller may make; the others (meeting planned, referred, call back) go through Nordavo. */
const correctable = callOutcomes.filter((o) =>
  ["no_answer", "reached_interested", "reached_not_interested", "wrong_person", "wrong_number"].includes(o.value),
);

/** Adds to the note of a contact. */
export function AddNoteForm({ contactId, action }: { contactId: string; action: FormAction }) {
  const [state, formAction] = useActionState(action, initialActionState);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state]);
  return (
    <form ref={ref} action={formAction} className="space-y-3" noValidate>
      <input type="hidden" name="contactId" value={contactId} />
      <FormMessage error={state.error} success={state.ok ? state.message : undefined} />
      <Field label="New note" htmlFor="caller_note" error={state.fieldErrors?.note}>
        <Textarea id="caller_note" name="note" rows={3} maxLength={5000} aria-invalid={Boolean(state.fieldErrors?.note)} />
      </Field>
      <div className="flex justify-end max-sm:*:w-full">
        <SubmitButton pendingLabel="Saving">Save note</SubmitButton>
      </div>
    </form>
  );
}

/** Corrects the outcome of one call. The reason goes in the log. */
export function CorrectCallForm({
  activityId,
  contactId,
  current,
  action,
}: {
  activityId: string;
  contactId: string;
  current: string | null;
  action: FormAction;
}) {
  const [state, formAction] = useActionState(action, initialActionState);
  const errors = state.fieldErrors ?? {};
  return (
    <form action={formAction} className="space-y-3 rounded-xl bg-surface p-4" noValidate>
      <input type="hidden" name="activityId" value={activityId} />
      <input type="hidden" name="contactId" value={contactId} />
      <FormMessage error={state.error} success={state.ok ? state.message : undefined} />
      <Field label="Correct outcome" htmlFor={`outcome_${activityId}`} error={errors.outcome}>
        <Select id={`outcome_${activityId}`} name="outcome" defaultValue="" aria-invalid={Boolean(errors.outcome)}>
          <option value="" disabled>
            Pick the right outcome
          </option>
          {correctable
            .filter((o) => o.value !== current)
            .map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
        </Select>
      </Field>
      <Field label="Reason" htmlFor={`reason_${activityId}`} required error={errors.reason} hint="Why was the first outcome wrong? Nordavo can read this.">
        <Textarea id={`reason_${activityId}`} name="reason" rows={2} maxLength={1000} aria-invalid={Boolean(errors.reason)} />
      </Field>
      <div className="flex justify-end max-sm:*:w-full">
        <SubmitButton size="sm" pendingLabel="Saving">
          Correct outcome
        </SubmitButton>
      </div>
    </form>
  );
}
