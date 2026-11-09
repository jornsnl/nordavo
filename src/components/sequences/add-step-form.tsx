"use client";

import { useActionState, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialActionState, type ActionState } from "@/lib/action-state";
import { StepFields } from "./step-card";

export function AddStepForm({
  action,
  nextDay,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  nextDay: number;
}) {
  const [open, setOpen] = useState(false);
  // A new key per success empties the form for the next step.
  const [round, setRound] = useState(0);
  const [state, formAction] = useActionState(async (prev: ActionState, formData: FormData) => {
    const result = await action(prev, formData);
    if (result.ok) setRound((r) => r + 1);
    return result;
  }, initialActionState);

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)} className="max-sm:w-full">
        <Plus aria-hidden="true" />
        Add step
      </Button>
    );
  }
  return (
    <form action={formAction} className="space-y-4 rounded-2xl border border-border bg-card p-4 shadow-xs sm:p-5">
      <h3 className="font-display font-semibold text-brand-900">New step</h3>
      <StepFields key={round} prefix={`new-step-${round}`} defaults={{ channel: "mail", dayOffset: nextDay, subject: null, body: null }} errors={state.fieldErrors} />
      <div className="flex flex-wrap gap-2">
        <SubmitButton size="sm" pendingLabel="Adding" className="pointer-coarse:min-h-11">
          Add step
        </SubmitButton>
        <Button variant="secondary" size="sm" onClick={() => setOpen(false)} className="pointer-coarse:min-h-11">
          Close
        </Button>
      </div>
      <FormMessage error={state.error} success={state.ok ? state.message : undefined} />
    </form>
  );
}
