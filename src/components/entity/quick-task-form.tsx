"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { Plus } from "lucide-react";
import type { EntityType } from "@/lib/database.types";
import type { StaffMember } from "@/lib/data/staff";
import { initialActionState } from "@/lib/action-state";
import { workPriorities } from "@/lib/work/labels";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input, Select } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { createRecordTaskAction } from "@/app/work/record-actions";

/** Add a Work task to this record without leaving the page. It lands in the project "Portal records". */
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
  const formRef = useRef<HTMLFormElement>(null);
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(createRecordTaskAction.bind(null, entityType, entityId), initialActionState);
  const errors = state.fieldErrors ?? {};

  // After adding, the form stays open and empty for the next task.
  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);

  if (!open) {
    return (
      <Button variant="secondary" size="sm" className="w-full" onClick={() => setOpen(true)}>
        <Plus aria-hidden="true" />
        Add task
      </Button>
    );
  }

  return (
    <form ref={formRef} action={formAction} noValidate className="space-y-3 rounded-xl border border-border bg-surface/60 p-3">
      <FormMessage
        error={state.error && !state.fieldErrors ? state.error : undefined}
        success={state.ok ? state.message : undefined}
      />

      <Field label="Task" htmlFor={`${id}-title`} required error={errors.title}>
        <Input
          id={`${id}-title`}
          name="title"
          required
          maxLength={300}
          autoFocus
          autoComplete="off"
          enterKeyHint="done"
          placeholder="What needs to happen?"
          aria-invalid={errors.title ? true : undefined}
        />
      </Field>
      <Field label="Owner" htmlFor={`${id}-assignee`}>
        <Select id={`${id}-assignee`} name="assignee_id" defaultValue={currentUserId}>
          <option value="">Nobody</option>
          {staff.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
              {member.id === currentUserId ? " (you)" : ""}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Deadline" htmlFor={`${id}-due`} hint="17:00 on that day" error={errors.due_date}>
          <Input id={`${id}-due`} name="due_date" type="date" className="px-2.5" />
        </Field>
        <Field label="Priority" htmlFor={`${id}-priority`}>
          <Select id={`${id}-priority`} name="priority" defaultValue="normal">
            {workPriorities.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="flex justify-end gap-2 max-sm:*:flex-1">
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Done
        </Button>
        <SubmitButton size="sm" pendingLabel="Adding">
          Add
        </SubmitButton>
      </div>
    </form>
  );
}
