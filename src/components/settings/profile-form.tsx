"use client";

import { useActionState } from "react";
import { type ActionState, initialActionState } from "@/lib/action-state";
import { Field, FormMessage, Input } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";

export function ProfileForm({
  action,
  fullName,
  email,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  fullName: string;
  email: string;
}) {
  const [state, formAction] = useActionState(action, initialActionState);
  const errors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <FormMessage error={state.error} success={state.ok ? state.message : undefined} />
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Naam" htmlFor="full_name" required error={errors.full_name}>
          <Input
            id="full_name"
            name="full_name"
            autoComplete="name"
            required
            // Remount with the saved value after a successful save.
            key={fullName}
            defaultValue={fullName}
            aria-invalid={Boolean(errors.full_name)}
            aria-describedby={errors.full_name ? "full_name-error" : undefined}
          />
        </Field>
        <Field
          label="E-mailadres"
          htmlFor="profile_email"
          hint="Wil je een ander e-mailadres? Vraag het een beheerder."
        >
          <Input id="profile_email" type="email" value={email} readOnly disabled />
        </Field>
      </div>
      <div className="flex justify-end">
        <SubmitButton pendingLabel="Bezig met opslaan">Naam opslaan</SubmitButton>
      </div>
    </form>
  );
}
