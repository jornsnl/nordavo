"use client";

import { startTransition, useActionState, useState } from "react";
import { CalendarDays, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input } from "@/components/ui/field";
import type { TalentActionState } from "@/lib/talent/types";

type Dates = { intake_at: string; profiles_sent_at: string; first_interview_at: string; start_at: string };

const fields: { name: keyof Dates; label: string; hint?: string }[] = [
  { name: "intake_at", label: "Intake" },
  { name: "profiles_sent_at", label: "Profielen verstuurd" },
  { name: "first_interview_at", label: "Eerste gesprek", hint: "Zet de fase op Gesprekken als die nog eerder stond." },
  { name: "start_at", label: "Start" },
];

/** T6: edit the timeline dates of a vacancy. */
export function TimelineForm({
  action,
  dates,
}: {
  action: (prev: TalentActionState, formData: FormData) => Promise<TalentActionState>;
  dates: Dates;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(async (prev: TalentActionState, formData: FormData) => {
    const result = await action(prev, formData);
    if (result.ok) setOpen(false);
    return result;
  }, {} as TalentActionState);
  const errors = state.fieldErrors ?? {};

  if (!open) {
    return (
      <div className="space-y-2">
        <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
          <CalendarDays aria-hidden="true" />
          Datums aanpassen
        </Button>
        {state.message && <FormMessage success={state.message} />}
      </div>
    );
  }

  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        startTransition(() => formAction(formData));
      }}
    >
      <FormMessage error={state.error} />
      <div className="grid gap-4 sm:grid-cols-2">
        {fields.map((f) => (
          <Field key={f.name} label={f.label} htmlFor={`tl-${f.name}`} error={errors[f.name]} hint={f.hint}>
            <Input
              id={`tl-${f.name}`}
              name={f.name}
              type="date"
              defaultValue={dates[f.name]}
              aria-invalid={errors[f.name] ? true : undefined}
              aria-describedby={errors[f.name] ? `tl-${f.name}-error` : undefined}
            />
          </Field>
        ))}
      </div>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>
          Annuleren
        </Button>
        <Button type="submit" size="sm" disabled={pending} aria-busy={pending}>
          {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />}
          {pending ? "Bezig met opslaan" : "Datums opslaan"}
        </Button>
      </div>
    </form>
  );
}
