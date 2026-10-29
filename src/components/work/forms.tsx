"use client";

import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { Plus } from "lucide-react";
import type { WorkActionState } from "@/lib/work/errors";
import { workPriorities } from "@/lib/work/labels";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input, Select, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { PendingSubmit, submitWithoutReset } from "@/components/placements/form-utils";

export type WorkAction = (state: WorkActionState, formData: FormData) => Promise<WorkActionState>;
export type PersonOption = { id: string; name: string; role?: string };

const empty: WorkActionState = {};

/** useActionState plus a callback when the action succeeded. */
export function useWorkAction(action: WorkAction, onSuccess?: () => void) {
  const [state, formAction, pending] = useActionState(action, empty);
  const done = useRef(onSuccess);
  useEffect(() => {
    done.current = onSuccess;
  });
  useEffect(() => {
    if (state.ok) done.current?.();
  }, [state]);
  return { state, formAction, pending, errors: state.fieldErrors ?? {} };
}

/** Checkboxes for picking owners; sends assignees=<id> per checked person. */
export function PeoplePicker({
  name,
  people,
  defaultSelected = [],
  label,
}: {
  name: string;
  people: PersonOption[];
  defaultSelected?: string[];
  label: string;
}) {
  return (
    <fieldset>
      <legend className="mb-1.5 block text-sm font-medium text-ink">{label}</legend>
      {people.length === 0 ? (
        <p className="text-xs text-muted">Nobody else can open this project yet.</p>
      ) : (
        <div className="max-h-44 space-y-1 overflow-y-auto rounded-xl border border-border bg-white p-2">
          {people.map((p) => (
            <label key={p.id} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm hover:bg-brand-50 pointer-coarse:min-h-10">
              <input
                type="checkbox"
                name={name}
                value={p.id}
                defaultChecked={defaultSelected.includes(p.id)}
                className="size-4 rounded border-border text-brand-700"
              />
              <span className="flex-1">{p.name}</span>
              {p.role === "guest" && <span className="text-xs text-muted">Guest</span>}
            </label>
          ))}
        </div>
      )}
    </fieldset>
  );
}

export function TaskForm({
  action,
  people,
  currentUserId,
  parentId,
  onDone,
  submitLabel = "Create task",
}: {
  action: WorkAction;
  people: PersonOption[];
  currentUserId: string;
  parentId?: string;
  onDone?: () => void;
  submitLabel?: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const { state, formAction, pending, errors } = useWorkAction(action, () => {
    formRef.current?.reset();
    onDone?.();
  });
  return (
    <form ref={formRef} onSubmit={submitWithoutReset(formAction)} className="space-y-4" noValidate>
      <FormMessage error={state.error} />
      {parentId && <input type="hidden" name="parent_id" value={parentId} />}
      <Field label="Title" htmlFor="task_title" required error={errors.title}>
        <Input id="task_title" name="title" required maxLength={300} autoFocus aria-invalid={Boolean(errors.title)} />
      </Field>
      <Field
        label="Description"
        htmlFor="task_description"
        hint="Goal, steps and when it is done. Markdown works: **bold**, lists, links."
        error={errors.description}
      >
        <Textarea
          id="task_description"
          name="description"
          rows={parentId ? 3 : 6}
          defaultValue={parentId ? "" : "Goal:\n\nSteps:\n- \n\nDone when:\n"}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Priority" htmlFor="task_priority">
          <Select id="task_priority" name="priority" defaultValue="normal">
            {workPriorities.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Deadline" htmlFor="task_due" hint="Your time zone" error={errors.due_at}>
          <Input id="task_due" name="due_at" type="datetime-local" />
        </Field>
        <Field label="Reviewer" htmlFor="task_reviewer" hint="Approves the work">
          <Select id="task_reviewer" name="reviewer_id" defaultValue={currentUserId}>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id === currentUserId ? `${p.name} (you)` : p.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <PeoplePicker name="assignees" label="Owners" people={people} />
      <div className="flex justify-end max-sm:*:w-full">
        <PendingSubmit pending={pending} pendingLabel="Saving">
          {submitLabel}
        </PendingSubmit>
      </div>
    </form>
  );
}

export function NewTaskButton({
  action,
  people,
  currentUserId,
  label = "New task",
}: {
  action: WorkAction;
  people: PersonOption[];
  currentUserId: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus aria-hidden="true" />
        {label}
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title={label} size="lg">
        <TaskForm action={action} people={people} currentUserId={currentUserId} onDone={() => setOpen(false)} />
      </Modal>
    </>
  );
}

export function ProjectFields({
  defaults,
  errors,
  showArchive = false,
}: {
  defaults?: { name: string; description: string | null; visibility: string; guestsSeeAssignedOnly: boolean; archived?: boolean };
  errors: Record<string, string>;
  showArchive?: boolean;
}) {
  return (
    <>
      <Field label="Name" htmlFor="project_name" required error={errors.name}>
        <Input id="project_name" name="name" required maxLength={120} defaultValue={defaults?.name} aria-invalid={Boolean(errors.name)} />
      </Field>
      <Field label="Description" htmlFor="project_description" error={errors.description}>
        <Textarea id="project_description" name="description" rows={3} defaultValue={defaults?.description ?? ""} />
      </Field>
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium text-ink">Who can see it</legend>
        <Radio name="visibility" value="open" defaultChecked={(defaults?.visibility ?? "open") === "open"}>
          <strong className="font-medium">Open</strong>: every admin and member of the workspace.
        </Radio>
        <Radio name="visibility" value="private" defaultChecked={defaults?.visibility === "private"}>
          <strong className="font-medium">Private</strong>: admins and the people you add.
        </Radio>
      </fieldset>
      <Check name="guests_see_assigned_only" defaultChecked={defaults?.guestsSeeAssignedOnly}>
        Guests only see the tasks they are on, not the whole project
      </Check>
      {showArchive && (
        <Check name="archived" defaultChecked={defaults?.archived}>
          Archived: hide from the sidebar, no new tasks
        </Check>
      )}
    </>
  );
}

function Radio({ name, value, defaultChecked, children }: { name: string; value: string; defaultChecked?: boolean; children: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 text-sm">
      <input type="radio" name={name} value={value} defaultChecked={defaultChecked} className="mt-0.5 size-4 text-brand-700" />
      <span>{children}</span>
    </label>
  );
}

export function Check({ name, defaultChecked, children }: { name: string; defaultChecked?: boolean; children: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 text-sm">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="mt-0.5 size-4 rounded text-brand-700" />
      <span>{children}</span>
    </label>
  );
}

export function ProjectForm({
  action,
  defaults,
  submitLabel,
  showArchive,
}: {
  action: WorkAction;
  defaults?: Parameters<typeof ProjectFields>[0]["defaults"];
  submitLabel: string;
  showArchive?: boolean;
}) {
  const { state, formAction, pending, errors } = useWorkAction(action);
  return (
    <form onSubmit={submitWithoutReset(formAction)} className="space-y-4" noValidate>
      <FormMessage error={state.error} success={state.ok ? state.message : undefined} />
      <ProjectFields defaults={defaults} errors={errors} showArchive={showArchive} />
      <div className="flex justify-end max-sm:*:w-full">
        <PendingSubmit pending={pending} pendingLabel="Saving">
          {submitLabel}
        </PendingSubmit>
      </div>
    </form>
  );
}

export function NewProjectButton({ action }: { action: WorkAction }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus aria-hidden="true" />
        New project
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="New project">
        <ProjectForm action={action} submitLabel="Create project" />
      </Modal>
    </>
  );
}
