"use client";

import { useActionState } from "react";
import { type ActionState, initialActionState } from "@/lib/action-state";
import { Field, FormMessage, Input } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";

export function PasswordForm({
  action,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
}) {
  const [state, formAction] = useActionState(action, initialActionState);
  const errors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <FormMessage error={state.error} success={state.ok ? state.message : undefined} />
      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label="Nieuw wachtwoord"
          htmlFor="new_password"
          required
          error={errors.password}
          hint="Minimaal 8 tekens."
        >
          <Input
            id="new_password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            aria-invalid={Boolean(errors.password)}
            aria-describedby={errors.password ? "new_password-error" : undefined}
          />
        </Field>
        <Field label="Herhaal wachtwoord" htmlFor="confirm_password" required error={errors.confirm}>
          <Input
            id="confirm_password"
            name="confirm"
            type="password"
            autoComplete="new-password"
            required
            aria-invalid={Boolean(errors.confirm)}
            aria-describedby={errors.confirm ? "confirm_password-error" : undefined}
          />
        </Field>
      </div>
      <div className="flex justify-end">
        <SubmitButton pendingLabel="Bezig met wijzigen">Wachtwoord wijzigen</SubmitButton>
      </div>
    </form>
  );
}
