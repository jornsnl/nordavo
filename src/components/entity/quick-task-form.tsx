"use client";

import { useActionState, useId, useState } from "react";
import { Plus } from "lucide-react";
import type { EntityType } from "@/lib/database.types";
import type { StaffMember } from "@/lib/data/tasks";
import { initialActionState } from "@/lib/action-state";
import { taskPriorities } from "@/lib/labels";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input, Select } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { saveTask } from "@/components/tasks/actions";

/** Add a task to this record without leaving the page. */
export function QuickTaskForm({
  entityType,
  entityId,
  staff,
  currentUserId,
}: {
  entityType: EntityType;
  entityId: string;
  staff: StaffMember[];
  currentUserId: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(saveTask, initialActionState);
  const errors = state.fieldErrors ?? {};

  if (!open) {
    return (
      <Button variant="secondary" size="sm" className="w-full" onClick={() => setOpen(true)}>
        <Plus aria-hidden="true" />
        Taak toevoegen
      </Button>
    );
  }

  return (
    <form action={formAction} noValidate className="space-y-3 rounded-xl border border-border bg-surface/60 p-3">
      <input type="hidden" name="entity_type" value={entityType} />
      <input type="hidden" name="entity_id" value={entityId} />
      <FormMessage error={state.error && !state.fieldErrors ? state.error : undefined} />

      <Field label="Taak" htmlFor={`${id}-title`} required error={errors.title}>
        <Input
          id={`${id}-title`}
          name="title"
          required
          maxLength={200}
          autoFocus
          placeholder="Wat moet er gebeuren?"
          aria-invalid={errors.title ? true : undefined}
        />
      </Field>
      <Field label="Voor" htmlFor={`${id}-assignee`}>
        <Select id={`${id}-assignee`} name="assignee_id" defaultValue={currentUserId}>
          <option value="">Niemand</option>
          {staff.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
              {member.id === currentUserId ? " (jij)" : ""}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Deadline" htmlFor={`${id}-due`} error={errors.due_date}>
          <Input id={`${id}-due`} name="due_date" type="date" className="px-2.5" />
        </Field>
        <Field label="Prioriteit" htmlFor={`${id}-priority`}>
          <Select id={`${id}-priority`} name="priority" defaultValue="normal">
            {taskPriorities.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Klaar
        </Button>
        <SubmitButton size="sm" pendingLabel="Toevoegen">
          Toevoegen
        </SubmitButton>
      </div>
    </form>
  );
}
