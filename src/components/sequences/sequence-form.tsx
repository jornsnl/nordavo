"use client";

import { useActionState } from "react";
import { Field, FormMessage, Input, Textarea } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialActionState, type ActionState } from "@/lib/action-state";

/** Name and description of a sequence, for creating and editing. */
export function SequenceForm({
  action,
  defaults,
  submitLabel,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  defaults?: { name: string; description: string | null };
  submitLabel: string;
}) {
  const [state, formAction] = useActionState(action, initialActionState);
  const id = defaults ? "edit" : "new";
  return (
    <form action={formAction} className="space-y-4">
      <Field label="Name" htmlFor={`${id}-sequence-name`} required error={state.fieldErrors?.name}>
        <Input
          id={`${id}-sequence-name`}
          name="name"
          required
          maxLength={200}
          defaultValue={defaults?.name}
          placeholder="For example: Python vacancy, 3 weeks"
          aria-invalid={Boolean(state.fieldErrors?.name)}
        />
      </Field>
      <Field
        label="Description"
        htmlFor={`${id}-sequence-description`}
        hint="Who it is for and what it is about. Claude reads this when it writes concept texts."
        error={state.fieldErrors?.description}
      >
        <Textarea id={`${id}-sequence-description`} name="description" rows={3} maxLength={5000} defaultValue={defaults?.description ?? ""} />
      </Field>
      <SubmitButton size="sm" className="max-sm:w-full pointer-coarse:min-h-11" pendingLabel="Saving">
        {submitLabel}
      </SubmitButton>
      <FormMessage error={state.error} success={state.ok ? state.message : undefined} />
    </form>
  );
}
