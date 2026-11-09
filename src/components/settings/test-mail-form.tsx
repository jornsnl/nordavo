"use client";

import { useActionState } from "react";
import { type ActionState, initialActionState } from "@/lib/action-state";
import { Field, FormMessage, Input, Select } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";

/** Send a test mail in the Nordavo template to any address (admins only). */
export function TestMailForm({
  action,
  defaultTo,
  senders,
  enabled,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  defaultTo: string;
  /** The senders that are configured, so both domains can be checked. */
  senders: { value: "default" | "recruitment"; label: string }[];
  enabled: boolean;
}) {
  const [state, formAction] = useActionState(action, initialActionState);
  const errors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <FormMessage error={state.error} success={state.ok ? state.message : undefined} />
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Send to" htmlFor="test_mail_to" error={errors.to}>
          <Input
            id="test_mail_to"
            name="to"
            type="email"
            inputMode="email"
            autoComplete="email"
            required
            defaultValue={defaultTo}
            aria-invalid={Boolean(errors.to)}
            aria-describedby={errors.to ? "test_mail_to-error" : undefined}
          />
        </Field>
        <Field label="Sender" htmlFor="test_mail_sender" hint="Test each sender domain once.">
          <Select id="test_mail_sender" name="sender" defaultValue="default" disabled={senders.length < 2}>
            {senders.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="flex justify-end max-sm:*:w-full">
        <SubmitButton pendingLabel="Sending" {...(enabled ? {} : { disabled: true })}>
          Send test mail
        </SubmitButton>
      </div>
    </form>
  );
}
