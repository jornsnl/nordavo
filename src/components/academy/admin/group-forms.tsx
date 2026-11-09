"use client";

import { useActionState } from "react";
import { Trash2 } from "lucide-react";
import { createGroup, deleteGroup } from "@/app/dashboard/academy/people/actions";
import { initialActionState } from "@/lib/action-state";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input, Select, Textarea } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { useAction } from "./use-action";

export function GroupForm() {
  const [state, action] = useActionState(createGroup, initialActionState);
  const e = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-4">
      <FormMessage error={state.error} success={state.message} />
      <Field label="Name" htmlFor="g-name" error={e.name} required>
        <Input id="g-name" name="name" maxLength={200} required placeholder="Laravel developers, December 2026" />
      </Field>
      <Field label="Kind" htmlFor="g-kind">
        <Select id="g-kind" name="kind" defaultValue="vacancy">
          <option value="vacancy">Vacancy</option>
          <option value="month">Month</option>
          <option value="campaign">Campaign</option>
          <option value="other">Other</option>
        </Select>
      </Field>
      <Field label="Description" htmlFor="g-description">
        <Textarea id="g-description" name="description" rows={2} maxLength={2000} />
      </Field>
      <SubmitButton size="sm" pendingLabel="Saving…">
        Make group
      </SubmitButton>
    </form>
  );
}

export function DeleteGroupButton({ id, name }: { id: string; name: string }) {
  const action = useAction();
  return (
    <Button
      size="sm"
      variant="ghost"
      aria-label={`Delete ${name}`}
      disabled={action.pending}
      onClick={() => action.run(() => deleteGroup(id), { confirm: `Delete the group "${name}"? Members keep their own access and progress.` })}
    >
      <Trash2 aria-hidden="true" />
    </Button>
  );
}
