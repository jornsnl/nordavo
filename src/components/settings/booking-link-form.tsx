"use client";

import { useActionState } from "react";
import { type ActionState, initialActionState } from "@/lib/action-state";
import { Field, FormMessage, Input } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";

/** The Cal.com booking link of the signed-in interviewer (2.14). */
export function BookingLinkForm({
  action,
  bookingUrl,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  bookingUrl: string;
}) {
  const [state, formAction] = useActionState(action, initialActionState);
  const errors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <FormMessage error={state.error} success={state.ok ? state.message : undefined} />
      <Field
        label="Cal.com booking link"
        htmlFor="booking_url"
        error={errors.booking_url}
        hint="The event candidates book an interview with you on, for example https://cal.com/judith/interview. Leave it empty if you do not do interviews."
      >
        <Input
          id="booking_url"
          name="booking_url"
          type="url"
          inputMode="url"
          autoComplete="url"
          placeholder="https://cal.com/your-name/interview"
          key={bookingUrl}
          defaultValue={bookingUrl}
          aria-invalid={Boolean(errors.booking_url)}
          aria-describedby={errors.booking_url ? "booking_url-error" : undefined}
        />
      </Field>
      <div className="flex justify-end max-sm:*:w-full">
        <SubmitButton pendingLabel="Saving">Save booking link</SubmitButton>
      </div>
    </form>
  );
}
