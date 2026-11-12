"use client";

import { useActionState } from "react";
import { updateDialTemplate } from "@/app/dashboard/settings/dial-actions";
import { initialActionState } from "@/lib/action-state";
import { Field, FormMessage, Input } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";

/** Click to call: tel: by default, or the link of your own phone system (Dubline or another) with {number}. */
export function DialSettingForm({ template }: { template: string | null }) {
  const [state, formAction] = useActionState(updateDialTemplate, initialActionState);
  const errors = state.fieldErrors ?? {};
  return (
    <form action={formAction} className="space-y-4" noValidate>
      <FormMessage error={state.error} success={state.ok ? state.message : undefined} />
      <Field
        label="Call link of your phone system"
        htmlFor="dial_template"
        error={errors.dial_template}
        hint="Leave empty to call with the phone app of your device (tel: link). For Dubline or another system, paste its click to call link with {number} where the number goes, for example https://phone.example.com/call?to={number}. {number} is +31612345678, {local} is 0612345678."
      >
        <Input
          id="dial_template"
          name="dial_template"
          inputMode="url"
          placeholder="https://.../call?number={number}"
          key={template ?? ""}
          defaultValue={template ?? ""}
          aria-invalid={Boolean(errors.dial_template)}
        />
      </Field>
      <div className="flex justify-end max-sm:*:w-full">
        <SubmitButton pendingLabel="Saving">Save call link</SubmitButton>
      </div>
    </form>
  );
}
