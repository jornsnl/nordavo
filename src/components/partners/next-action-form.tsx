"use client";

import { useActionState } from "react";
import { type ActionState, initialActionState } from "@/lib/action-state";
import { Field, FormMessage, Input } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";

/** Next action and its date on a partner, the same pair as on a lead. */
export function NextActionForm({
  action,
  nextAction,
  nextActionDate,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  nextAction: string | null;
  nextActionDate: string | null;
}) {
  const [state, formAction] = useActionState(action, initialActionState);
  const errors = state.fieldErrors ?? {};
  return (
    <form action={formAction} className="space-y-4" noValidate>
      <FormMessage error={state.error} success={state.ok ? state.message : undefined} />
      <Field label="Next action" htmlFor="next_action" error={errors.next_action}>
        <Input id="next_action" name="next_action" maxLength={500} defaultValue={nextAction ?? ""} placeholder="Call about the new leads" />
      </Field>
      <Field label="Date" htmlFor="next_action_date" error={errors.next_action_date}>
        <Input id="next_action_date" name="next_action_date" type="date" defaultValue={nextActionDate ?? ""} />
      </Field>
      <div className="flex justify-end max-sm:*:w-full">
        <SubmitButton pendingLabel="Saving">Save next action</SubmitButton>
      </div>
    </form>
  );
}
