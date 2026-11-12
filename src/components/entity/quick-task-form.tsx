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

/**
 * Add a Work task to this record without leaving the page. It lands in the
 * project "Portal records". You are the owner unless you change it, and you
 * can pick several owners (feedback Julius).
 */
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
      <OwnersPicker staff={staff} currentUserId={currentUserId} legendId={`${id}-owners`} />
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

/**
 * Owners as checkboxes, the signed-in user first and ticked. The rest of the
 * team in alphabetical order; with a long team the list scrolls.
 */
function OwnersPicker({ staff, currentUserId, legendId }: { staff: StaffMember[]; currentUserId: string; legendId: string }) {
  const me = staff.find((m) => m.id === currentUserId);
  const ordered = [...(me ? [me] : []), ...staff.filter((m) => m.id !== currentUserId)];
  return (
    <fieldset aria-labelledby={legendId}>
      <legend id={legendId} className="mb-1.5 block text-sm font-medium text-ink">
        Owners
      </legend>
      <div className="max-h-36 space-y-0.5 overflow-y-auto rounded-xl border border-border bg-white p-1.5">
        {ordered.map((member) => (
          <label
            key={member.id}
            className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1 text-sm hover:bg-brand-50 pointer-coarse:min-h-10"
          >
            <input
              type="checkbox"
              name="assignee_ids"
              value={member.id}
              defaultChecked={member.id === currentUserId}
              className="size-4 rounded border-border text-brand-700"
            />
            <span className="flex-1 truncate">
              {member.name}
              {member.id === currentUserId ? " (you)" : ""}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
