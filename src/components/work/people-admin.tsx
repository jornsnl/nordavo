"use client";

import { useRef, useState, useTransition } from "react";
import { Send, UserMinus, X } from "lucide-react";
import type { WorkRole } from "@/lib/work/database";
import { workRoles } from "@/lib/work/labels";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { PendingSubmit, submitWithoutReset } from "@/components/placements/form-utils";
import { useWorkAction, type WorkAction } from "@/components/work/forms";

export function InviteForm({
  action,
  projects,
  roles,
  defaultProjectId,
}: {
  action: WorkAction;
  projects: { id: string; name: string }[];
  /** Admins may invite every role; members only guests. */
  roles: WorkRole[];
  defaultProjectId?: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [role, setRole] = useState<WorkRole>(roles.includes("guest") && roles.length === 1 ? "guest" : roles[1] ?? roles[0]);
  const { state, formAction, pending, errors } = useWorkAction(action, () => formRef.current?.reset());
  return (
    <form ref={formRef} onSubmit={submitWithoutReset(formAction)} className="space-y-4" noValidate>
      <FormMessage error={state.error} success={state.ok ? state.message : undefined} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="E-mail" htmlFor="invite_email" required error={errors.email}>
          <Input id="invite_email" name="email" type="email" autoComplete="off" required placeholder="name@company.com" />
        </Field>
        <Field label="Name" htmlFor="invite_name" hint="For a new account">
          <Input id="invite_name" name="full_name" autoComplete="off" />
        </Field>
        <Field label="Role" htmlFor="invite_role" required>
          <Select id="invite_role" name="role" value={role} onChange={(e) => setRole(e.target.value as WorkRole)}>
            {workRoles
              .filter((r) => roles.includes(r.value))
              .map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
          </Select>
        </Field>
        <Field
          label="Project"
          htmlFor="invite_project"
          required={role === "guest"}
          error={errors.project_id}
          hint={role === "guest" ? "Guests only see this project" : "Optional: land straight in this project"}
        >
          <Select id="invite_project" name="project_id" defaultValue={defaultProjectId ?? ""}>
            {role !== "guest" && <option value="">No project</option>}
            {role === "guest" && !defaultProjectId && <option value="">Pick a project</option>}
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        {role === "guest" && (
          <Field label="Access ends" htmlFor="invite_expires" hint="Optional. Access stops by itself after this moment.">
            <Input id="invite_expires" name="access_expires_at" type="datetime-local" />
          </Field>
        )}
      </div>
      <div className="flex justify-end max-sm:*:w-full">
        <PendingSubmit pending={pending} pendingLabel="Sending">
          <Send aria-hidden="true" />
          Send invite
        </PendingSubmit>
      </div>
    </form>
  );
}

/** Role and end date of one workspace member. */
export function MemberRoleForm({
  action,
  userId,
  role,
  expiresLocal,
  disabled,
}: {
  action: WorkAction;
  userId: string;
  role: WorkRole;
  expiresLocal: string;
  disabled?: boolean;
}) {
  const { state, formAction, pending } = useWorkAction(action);
  return (
    <form onSubmit={submitWithoutReset(formAction)} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="user_id" value={userId} />
      <label className="w-32">
        <span className="mb-1 block text-xs text-muted">Role</span>
        <Select name="role" defaultValue={role} disabled={disabled} className="w-full py-1.5">
          {workRoles.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </Select>
      </label>
      <label>
        <span className="mb-1 block text-xs text-muted">Access ends</span>
        <Input name="access_expires_at" type="datetime-local" defaultValue={expiresLocal} disabled={disabled} className="py-1.5" />
      </label>
      {!disabled && (
        <PendingSubmit pending={pending} size="sm" variant="secondary">
          Save
        </PendingSubmit>
      )}
      {state.error && <p className="w-full text-xs text-danger">{state.error}</p>}
      {state.ok && <p className="w-full text-xs text-emerald-700">Saved.</p>}
    </form>
  );
}

export function DeactivateButton({
  action,
  userId,
  name,
  transferOptions,
}: {
  action: WorkAction;
  userId: string;
  name: string;
  transferOptions: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const { state, formAction, pending } = useWorkAction(action);
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        <UserMinus aria-hidden="true" />
        Deactivate
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Deactivate ${name}`} description="They lose access to this workspace at once. The account stays.">
        <form onSubmit={submitWithoutReset(formAction)} className="space-y-4">
          <FormMessage error={state.error} success={state.ok ? state.message : undefined} />
          <input type="hidden" name="user_id" value={userId} />
          <Field label="Hand over open tasks to" htmlFor="transfer_to" hint="They become owner and reviewer of the open tasks instead.">
            <Select id="transfer_to" name="transfer_to" defaultValue="">
              <option value="">Nobody (leave them without owner)</option>
              {transferOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          {!state.ok && (
            <div className="flex justify-end max-sm:*:w-full">
              <PendingSubmit pending={pending} variant="danger">
                Deactivate
              </PendingSubmit>
            </div>
          )}
        </form>
      </Modal>
    </>
  );
}

export function AddPersonForm({
  action,
  candidates,
  showExpiry,
}: {
  action: WorkAction;
  candidates: { id: string; name: string; role: WorkRole }[];
  showExpiry: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const { state, formAction, pending } = useWorkAction(action, () => formRef.current?.reset());
  if (candidates.length === 0) {
    return <p className="text-sm text-muted">Everyone in the workspace is already in this project. Invite someone new below.</p>;
  }
  return (
    <form ref={formRef} onSubmit={submitWithoutReset(formAction)} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <Field label="Add someone from the workspace" htmlFor="add_person" className="flex-1">
        <Select id="add_person" name="user_id" defaultValue="">
          <option value="" disabled>
            Pick a person
          </option>
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({workRoles.find((r) => r.value === c.role)?.label})
            </option>
          ))}
        </Select>
      </Field>
      {showExpiry && (
        <Field label="Access ends" htmlFor="add_expires" hint="Optional">
          <Input id="add_expires" name="access_expires_at" type="datetime-local" />
        </Field>
      )}
      <PendingSubmit pending={pending}>Add</PendingSubmit>
      {state.error && <p className="text-xs text-danger">{state.error}</p>}
    </form>
  );
}

/** Calls a bound server action that throws on failure (revoke access, revoke invite, reactivate). */
export function ConfirmButton({
  run,
  label,
  confirm,
  icon = true,
}: {
  run: () => Promise<{ error?: string } | void>;
  label: string;
  confirm?: string;
  icon?: boolean;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-end">
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          start(async () => {
            const result = await run();
            setError(result && result.error ? result.error : null);
          });
        }}
      >
        {icon && <X aria-hidden="true" />}
        {label}
      </Button>
      {error && <span className="text-xs text-danger">{error}</span>}
    </span>
  );
}

export function WorkspaceNameForm({ action, name }: { action: WorkAction; name: string }) {
  const { state, formAction, pending } = useWorkAction(action);
  return (
    <form onSubmit={submitWithoutReset(formAction)} className="space-y-3">
      <FormMessage error={state.error} success={state.ok ? state.message : undefined} />
      <Field label="Name" htmlFor="ws_name">
        <Input id="ws_name" name="name" defaultValue={name} maxLength={80} required />
      </Field>
      <PendingSubmit pending={pending} size="sm">
        Save
      </PendingSubmit>
    </form>
  );
}
