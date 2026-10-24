"use client";

import { startTransition, useActionState, useId, useState, useTransition } from "react";
import { LoaderCircle, Plus, Trash2 } from "lucide-react";
import type { StaffMember, TaskItem } from "@/lib/data/tasks";
import { initialActionState, type ActionState } from "@/lib/action-state";
import { taskPriorities, taskStatuses } from "@/lib/labels";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input, Select, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { deleteTask, saveTask } from "./actions";
import { RecordPicker } from "./record-picker";

type FormProps = {
  task: TaskItem | null;
  staff: StaffMember[];
  currentUserId: string;
  onDone: () => void;
};

/** Create or edit a task. Shared by the Taken page and its board. */
export function TaskForm({ task, staff, currentUserId, onDone }: FormProps) {
  const id = useId();
  const [state, formAction, pending] = useActionState(async (prev: ActionState, formData: FormData) => {
    const result = await saveTask(prev, formData);
    if (result.ok) onDone();
    return result;
  }, initialActionState);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string>();
  const [deleting, startDelete] = useTransition();
  const errors = state.fieldErrors ?? {};

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(event) => {
        // Submit by hand so the fields keep their values when validation fails.
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        startTransition(() => formAction(formData));
      }}
    >
      {task && <input type="hidden" name="id" value={task.id} />}
      <FormMessage error={state.error ?? deleteError} />

      <Field label="Titel" htmlFor={`${id}-title`} required error={errors.title}>
        <Input
          id={`${id}-title`}
          name="title"
          required
          maxLength={200}
          autoComplete="off"
          enterKeyHint="done"
          defaultValue={task?.title}
          placeholder="Bijvoorbeeld: Julius belt klant over profielen"
          aria-invalid={errors.title ? true : undefined}
          aria-describedby={errors.title ? `${id}-title-error` : undefined}
        />
      </Field>

      <Field label="Omschrijving" htmlFor={`${id}-description`} error={errors.description}>
        <Textarea id={`${id}-description`} name="description" rows={3} defaultValue={task?.description ?? ""} />
      </Field>

      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        <Field label="Status" htmlFor={`${id}-status`} error={errors.status}>
          <Select id={`${id}-status`} name="status" defaultValue={task?.status ?? "todo"}>
            {taskStatuses.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Prioriteit" htmlFor={`${id}-priority`} error={errors.priority}>
          <Select id={`${id}-priority`} name="priority" defaultValue={task?.priority ?? "normal"}>
            {taskPriorities.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Deadline" htmlFor={`${id}-due`} error={errors.due_date}>
          <Input id={`${id}-due`} name="due_date" type="date" defaultValue={task?.dueDate ?? ""} />
        </Field>
        <Field label="Toegewezen aan" htmlFor={`${id}-assignee`} error={errors.assignee_id}>
          <Select
            id={`${id}-assignee`}
            name="assignee_id"
            defaultValue={task ? (task.assigneeId ?? "") : currentUserId}
          >
            <option value="">Niemand</option>
            {staff.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
                {member.id === currentUserId ? " (jij)" : ""}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <RecordPicker
        initial={
          task?.entityType && task.entityId
            ? { type: task.entityType, id: task.entityId, label: task.record?.label ?? "Verwijderd record" }
            : null
        }
        error={errors.entity_id}
      />

      {/* On phones the buttons stay in reach at the bottom of the sheet. */}
      <div className="flex flex-col-reverse gap-3 border-t border-border pt-4 max-sm:sticky max-sm:bottom-0 max-sm:z-10 max-sm:-mx-5 max-sm:bg-card max-sm:px-5 max-sm:pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          {task &&
            (confirmDelete ? (
              <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Verwijderen bevestigen">
                <span className="text-sm text-ink">Weet je het zeker?</span>
                <Button
                  variant="danger"
                  size="sm"
                  disabled={deleting}
                  onClick={() =>
                    startDelete(async () => {
                      const result = await deleteTask(task.id);
                      if (result.ok) onDone();
                      else setDeleteError(result.error);
                    })
                  }
                >
                  Ja, verwijderen
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                  Annuleren
                </Button>
              </div>
            ) : (
              <Button variant="ghost" size="sm" className="text-danger hover:bg-danger-bg" onClick={() => setConfirmDelete(true)}>
                <Trash2 aria-hidden="true" />
                Verwijderen
              </Button>
            ))}
        </div>
        <div className="flex gap-2 max-sm:*:flex-1 sm:justify-end">
          <Button variant="secondary" onClick={onDone}>
            Annuleren
          </Button>
          <Button type="submit" disabled={pending || deleting} aria-busy={pending}>
            {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />}
            {task ? "Opslaan" : "Taak toevoegen"}
          </Button>
        </div>
      </div>
    </form>
  );
}

/** Modal around TaskForm. Pass `task` to edit, or null to create. */
export function TaskModal({
  open,
  task,
  staff,
  currentUserId,
  onClose,
}: {
  open: boolean;
  task: TaskItem | null;
  staff: StaffMember[];
  currentUserId: string;
  onClose: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title={task ? "Taak bewerken" : "Nieuwe taak"} size="lg">
      {/* A fresh form per task, so default values always match. */}
      <TaskForm key={task?.id ?? "new"} task={task} staff={staff} currentUserId={currentUserId} onDone={onClose} />
    </Modal>
  );
}

/** Primary action in the Taken page header. */
export function NewTaskButton({ staff, currentUserId }: { staff: StaffMember[]; currentUserId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus aria-hidden="true" />
        Nieuwe taak
      </Button>
      <TaskModal open={open} task={null} staff={staff} currentUserId={currentUserId} onClose={() => setOpen(false)} />
    </>
  );
}
