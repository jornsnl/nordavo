"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { Pause, Pencil, Play, Send, UserPlus, XCircle } from "lucide-react";
import { type ActionState, initialActionState } from "@/lib/action-state";
import type { CallerStatus } from "@/lib/sales/database";
import { ConfirmButton } from "@/components/candidates/confirm-button";
import { PendingSubmit, submitWithoutReset } from "@/components/placements/form-utils";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";

type FormAction = (state: ActionState, formData: FormData) => Promise<ActionState>;

export type CallerFormValues = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  party: string | null;
  fee: number;
  status: CallerStatus;
};

function CallerFields({
  prefix,
  errors,
  values,
  withEmail,
  disabled,
}: {
  prefix: string;
  errors: Record<string, string>;
  values?: Partial<CallerFormValues>;
  withEmail: boolean;
  disabled?: boolean;
}) {
  const id = (name: string) => `${prefix}_${name}`;
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <Field label="Name" htmlFor={id("name")} required error={errors.name}>
        <Input id={id("name")} name="name" defaultValue={values?.name} required maxLength={200} disabled={disabled} aria-invalid={Boolean(errors.name)} />
      </Field>
      {withEmail && (
        <Field label="Email address" htmlFor={id("email")} required error={errors.email} hint="The invitation goes here. This is also the sign-in address.">
          <Input
            id={id("email")}
            name="email"
            type="email"
            inputMode="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
            disabled={disabled}
            aria-invalid={Boolean(errors.email)}
          />
        </Field>
      )}
      <Field label="Phone" htmlFor={id("phone")} error={errors.phone}>
        <Input id={id("phone")} name="phone" type="tel" defaultValue={values?.phone ?? ""} maxLength={50} disabled={disabled} />
      </Field>
      <Field label="Party" htmlFor={id("party")} error={errors.party} hint="The agency or company the caller works for, for example Webpartners.">
        <Input id={id("party")} name="party" defaultValue={values?.party ?? ""} maxLength={200} disabled={disabled} />
      </Field>
      <Field label="Fee per approved meeting (EUR)" htmlFor={id("fee")} required error={errors.fee_per_meeting}>
        <Input
          id={id("fee")}
          name="fee_per_meeting"
          inputMode="decimal"
          defaultValue={values?.fee != null ? String(values.fee) : ""}
          required
          disabled={disabled}
          aria-invalid={Boolean(errors.fee_per_meeting)}
        />
      </Field>
    </div>
  );
}

/** Settings, Callers: add a caller. They get an invitation by mail. */
export function AddCallerForm({ action, enabled }: { action: FormAction; enabled: boolean }) {
  const [state, formAction, pending] = useActionState(action, initialActionState);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} onSubmit={submitWithoutReset(formAction)} className="space-y-5" noValidate>
      {!enabled && (
        <p className="rounded-xl border border-amber-600/20 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Adding callers only works once <code className="font-mono text-xs">SUPABASE_SECRET_KEY</code> is set on the server.
        </p>
      )}
      <FormMessage error={state.error} success={state.ok ? state.message : undefined} />
      <CallerFields prefix="add_caller" errors={state.fieldErrors ?? {}} withEmail disabled={!enabled} />
      <div className="flex justify-end max-sm:*:w-full">
        <PendingSubmit pending={pending} pendingLabel="Inviting" disabled={!enabled}>
          <UserPlus aria-hidden="true" />
          Add and invite
        </PendingSubmit>
      </div>
    </form>
  );
}

/** Edit, resend invite, pause, resume and stop for one caller. */
export function CallerControls({
  caller,
  updateAction,
  statusAction,
  resendAction,
}: {
  caller: CallerFormValues;
  updateAction: FormAction;
  statusAction: (id: string, status: CallerStatus) => Promise<ActionState>;
  resendAction: (id: string) => Promise<ActionState>;
}) {
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState<ActionState>({});
  const [pending, startTransition] = useTransition();

  function run(fn: () => Promise<ActionState>) {
    startTransition(async () => setMessage(await fn()));
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2 pointer-coarse:[&_button]:min-h-11">
        <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
          <Pencil aria-hidden="true" />
          Edit
        </Button>
        {caller.status === "active" && (
          <>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => resendAction(caller.id))}>
              <Send aria-hidden="true" />
              Resend invite
            </Button>
            <ConfirmButton
              size="sm"
              variant="ghost"
              title={`Pause ${caller.name}?`}
              description={`${caller.name} is signed out and cannot call until you resume. Their contacts and lists stay with them.`}
              confirmLabel="Pause"
              action={() => statusAction(caller.id, "paused")}
            >
              <Pause aria-hidden="true" />
              Pause
            </ConfirmButton>
          </>
        )}
        {caller.status !== "active" && (
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => statusAction(caller.id, "active"))}>
            <Play aria-hidden="true" />
            Resume
          </Button>
        )}
        {caller.status !== "stopped" && (
          <ConfirmButton
            size="sm"
            variant="ghost"
            title={`Stop ${caller.name}?`}
            description={`${caller.name} is signed out and loses access. Their assigned contacts and open lists go back to the team. Their meetings and fees stay in the overview.`}
            confirmLabel="Stop"
            action={() => statusAction(caller.id, "stopped")}
          >
            <XCircle aria-hidden="true" />
            Stop
          </ConfirmButton>
        )}
      </div>
      <FormMessage error={message.error} success={message.ok ? message.message : undefined} />
      <Modal open={editing} onClose={() => setEditing(false)} title={`Edit ${caller.name}`} description={caller.email}>
        <EditCallerForm caller={caller} action={updateAction} onDone={() => setEditing(false)} />
      </Modal>
    </div>
  );
}

function EditCallerForm({ caller, action, onDone }: { caller: CallerFormValues; action: FormAction; onDone: () => void }) {
  const [state, formAction, pending] = useActionState(action, initialActionState);
  useEffect(() => {
    if (state.ok) onDone();
  }, [state, onDone]);
  return (
    <form onSubmit={submitWithoutReset(formAction)} className="space-y-5" noValidate>
      <input type="hidden" name="id" value={caller.id} />
      <FormMessage error={state.error} />
      <CallerFields prefix={`edit_${caller.id}`} errors={state.fieldErrors ?? {}} values={caller} withEmail={false} />
      <p className="text-xs text-muted">A new fee applies to meetings planned from now on. Change the fee of one meeting on the Meetings page.</p>
      <div className="flex justify-end max-sm:*:w-full">
        <PendingSubmit pending={pending} pendingLabel="Saving">
          Save
        </PendingSubmit>
      </div>
    </form>
  );
}
