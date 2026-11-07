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
          label="New password"
          htmlFor="new_password"
          required
          error={errors.password}
          hint="At least 8 characters."
        >
          <Input
            id="new_password"
            name="password"
            type="password"
            autoComplete="new-password"
            autoCapitalize="none"
            enterKeyHint="next"
            required
            minLength={8}
            aria-invalid={Boolean(errors.password)}
            aria-describedby={errors.password ? "new_password-error" : undefined}
          />
        </Field>
        <Field label="Repeat password" htmlFor="confirm_password" required error={errors.confirm}>
          <Input
            id="confirm_password"
            name="confirm"
            type="password"
            autoComplete="new-password"
            autoCapitalize="none"
            enterKeyHint="done"
            required
            aria-invalid={Boolean(errors.confirm)}
            aria-describedby={errors.confirm ? "confirm_password-error" : undefined}
          />
        </Field>
      </div>
      <div className="flex justify-end max-sm:*:w-full">
        <SubmitButton pendingLabel="Changing">Change password</SubmitButton>
      </div>
    </form>
  );
}
