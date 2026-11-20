"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, ShieldCheck, ShieldOff, SlidersHorizontal, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import type { ActionState } from "@/lib/action-state";
import { ActionModal, invalidProps, type FormAction } from "./action-modal";

type Flag = "left_company" | "wrong_person" | "wrong_number";

export const contactFlagLabels: Record<Flag, string> = {
  left_company: "Left the company",
  wrong_person: "Wrong person",
  wrong_number: "Wrong number",
};

// ---------------------------------------------------------------------------
// Confirm and run (delete, toggle)
// ---------------------------------------------------------------------------

function useRun(onDone?: () => void) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok?: boolean; error?: string; message?: string }>) => {
    setError(null);
    start(async () => {
      const result = await fn();
      if (result.ok === false || result.error) {
        setError(result.error ?? "Something went wrong.");
        return;
      }
      onDone?.();
      router.refresh();
    });
  };
  return { run, error, pending, setError };
}

function ConfirmDelete({
  label,
  title,
  description,
  confirmLabel,
  onConfirm,
  iconOnly = false,
  size = "sm",
}: {
  label: string;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => Promise<ActionState | { ok: boolean; error?: string; message?: string }>;
  iconOnly?: boolean;
  size?: "sm" | "md";
}) {
  const [open, setOpen] = useState(false);
  const { run, error, pending, setError } = useRun(() => setOpen(false));
  return (
    <>
      <Button
        variant="ghost"
        size={size}
        aria-label={iconOnly ? label : undefined}
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        <Trash2 aria-hidden="true" />
        {!iconOnly && label}
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title={title} description={description}>
        <div className="space-y-4">
          {error && (
            <p role="alert" className="rounded-xl border border-danger/20 bg-danger-bg px-4 py-3 text-sm text-danger">
              {error}
            </p>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" disabled={pending} aria-busy={pending} onClick={() => run(onConfirm)}>
              {pending ? "Deleting" : confirmLabel}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

export type EditableContact = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  title: string | null;
  tier: number | null;
  role: "main" | "reserve" | "extra";
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
};

export function EditContactButton({ contact, action }: { contact: EditableContact; action: FormAction }) {
  return (
    <ActionModal
      label="Edit"
      icon={Pencil}
      variant="ghost"
      ariaLabel={`Edit ${[contact.firstName, contact.lastName].filter(Boolean).join(" ") || "contact"}`}
      title="Edit contact"
      description="Empty a field to remove its value. A new main contact moves the old one to backup."
      action={action}
      modalSize="lg"
    >
      {(state) => {
        const e = state.fieldErrors ?? {};
        return (
          <>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="First name" htmlFor="first_name" error={e.first_name}>
                <Input id="first_name" name="first_name" defaultValue={contact.firstName ?? ""} autoComplete="off" {...invalidProps(state, "first_name")} />
              </Field>
              <Field label="Last name" htmlFor="last_name" error={e.last_name}>
                <Input id="last_name" name="last_name" defaultValue={contact.lastName ?? ""} autoComplete="off" {...invalidProps(state, "last_name")} />
              </Field>
              <Field label="Job title" htmlFor="title" error={e.title}>
                <Input id="title" name="title" defaultValue={contact.title ?? ""} {...invalidProps(state, "title")} />
              </Field>
              <Field label="Tier" htmlFor="tier" error={e.tier}>
                <Select id="tier" name="tier" defaultValue={contact.tier ? String(contact.tier) : ""}>
                  <option value="">No tier</option>
                  <option value="1">Tier 1: technisch (CTO, head of engineering, data of IT, tech lead)</option>
                  <option value="2">Tier 2: eigenaar of directie (CEO, founder, directeur)</option>
                  <option value="3">Tier 3: HR of recruitment (alleen zonder tier 1 en 2)</option>
                </Select>
              </Field>
              <Field label="Role" htmlFor="role" error={e.role}>
                <Select id="role" name="role" defaultValue={contact.role}>
                  <option value="main">Contact 1</option>
                  <option value="reserve">Contact 2</option>
                  <option value="extra">Extra</option>
                </Select>
              </Field>
              <Field label="Email" htmlFor="email" error={e.email}>
                <Input id="email" name="email" type="email" defaultValue={contact.email ?? ""} autoComplete="off" spellCheck={false} {...invalidProps(state, "email")} />
              </Field>
              <Field label="Phone" htmlFor="phone" hint="Only a mobile number puts the contact on a call list." error={e.phone}>
                <Input id="phone" name="phone" type="tel" defaultValue={contact.phone ?? ""} autoComplete="off" {...invalidProps(state, "phone")} />
              </Field>
              <Field label="LinkedIn profile" htmlFor="linkedin_url" error={e.linkedin_url}>
                <Input
                  id="linkedin_url"
                  name="linkedin_url"
                  defaultValue={contact.linkedinUrl ?? ""}
                  autoCapitalize="none"
                  spellCheck={false}
                  {...invalidProps(state, "linkedin_url")}
                />
              </Field>
            </div>
          </>
        );
      }}
    </ActionModal>
  );
}

/** Which channels may be used for this contact, and the flags left, wrong person, wrong number. */
export function ContactChannelsButton({
  name,
  mail,
  call,
  linkedin,
  flag,
  action,
}: {
  name: string;
  mail: boolean;
  call: boolean;
  linkedin: boolean;
  flag: Flag | null;
  action: (input: { mail: boolean; call: boolean; linkedin: boolean; flag: Flag | null }) => Promise<ActionState>;
}) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState({ mail, call, linkedin, flag });
  const { run, error, pending, setError } = useRun(() => setOpen(false));
  const restricted = !mail || !call || !linkedin || flag !== null;
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        aria-label={`Channels of ${name}`}
        onClick={() => {
          setValues({ mail, call, linkedin, flag });
          setError(null);
          setOpen(true);
        }}
      >
        <SlidersHorizontal aria-hidden="true" />
        {restricted ? "Channels (limited)" : "Channels"}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`How may we approach ${name}?`}
        description="Switched off here means the contact is out of mail campaigns and call lists, and Claude skips them."
      >
        <div className="space-y-4 text-sm">
          {error && (
            <p role="alert" className="rounded-xl border border-danger/20 bg-danger-bg px-4 py-3 text-danger">
              {error}
            </p>
          )}
          <fieldset className="space-y-2">
            <legend className="mb-1 font-medium text-ink">Allowed</legend>
            {(
              [
                ["mail", "Mail"],
                ["call", "Call"],
                ["linkedin", "LinkedIn"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="size-4"
                  checked={values[key]}
                  onChange={(event) => setValues((v) => ({ ...v, [key]: event.target.checked }))}
                />
                {label}
              </label>
            ))}
          </fieldset>
          <Field label="Mark as" htmlFor="contact-flag" hint="Left the company and wrong person: not approached on any channel. Wrong number: not called.">
            <Select
              id="contact-flag"
              value={values.flag ?? ""}
              onChange={(event) => setValues((v) => ({ ...v, flag: (event.target.value || null) as Flag | null }))}
            >
              <option value="">Nothing</option>
              {(Object.keys(contactFlagLabels) as Flag[]).map((f) => (
                <option key={f} value={f}>
                  {contactFlagLabels[f]}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={pending} aria-busy={pending} onClick={() => run(() => action(values))}>
              {pending ? "Saving" : "Save"}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

export function DeleteContactButton({ name, action }: { name: string; action: () => Promise<ActionState> }) {
  return (
    <ConfirmDelete
      label={`Delete ${name}`}
      iconOnly
      title={`Delete ${name}?`}
      description="The contact is removed for good. The deletion stays in the timeline. Do not delete someone who asked not to be contacted: switch the channels off instead."
      confirmLabel="Delete contact"
      onConfirm={action}
    />
  );
}

// ---------------------------------------------------------------------------
// Own contact
// ---------------------------------------------------------------------------

/** Switch the own contact protection of a company on or off. */
export function OwnContactControl({
  ownContact,
  reason,
  action,
}: {
  ownContact: boolean;
  reason: string | null;
  action: (value: boolean, reason?: string) => Promise<ActionState>;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(reason ?? "");
  const { run, error, pending, setError } = useRun(() => setOpen(false));
  return (
    <>
      <Button
        variant={ownContact ? "secondary" : "ghost"}
        size="sm"
        onClick={() => {
          setText(reason ?? "");
          setError(null);
          setOpen(true);
        }}
      >
        {ownContact ? <ShieldOff aria-hidden="true" /> : <ShieldCheck aria-hidden="true" />}
        {ownContact ? "Own contact: change" : "Mark as own contact"}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={ownContact ? "Own contact" : "Mark as own contact"}
        description="A company we have contact with ourselves: a partner, a network contact or a client. It never goes into a cold mail campaign (Instantly, Seleqt), on a call list or in a list Claude makes. This is not Do not contact: nobody asked us to stay away."
      >
        <div className="space-y-4 text-sm">
          {error && (
            <p role="alert" className="rounded-xl border border-danger/20 bg-danger-bg px-4 py-3 text-danger">
              {error}
            </p>
          )}
          <Field label="Why" htmlFor="own-contact-reason" hint="For example Partner, Client, Network or In the pipeline.">
            <Input id="own-contact-reason" value={text} maxLength={500} onChange={(event) => setText(event.target.value)} />
          </Field>
          <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            {ownContact && (
              <Button variant="secondary" disabled={pending} onClick={() => run(() => action(false))}>
                Switch off
              </Button>
            )}
            <Button disabled={pending} aria-busy={pending} onClick={() => run(() => action(true, text))}>
              {pending ? "Saving" : ownContact ? "Save" : "Mark as own contact"}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

// ---------------------------------------------------------------------------
// Leads and signals
// ---------------------------------------------------------------------------

/** Delete leads made by mistake (list: the selection, lead page: this lead). */
export function DeleteLeadsButton({
  count,
  name,
  action,
  onDone,
  redirectTo,
}: {
  count: number;
  name?: string;
  action: () => Promise<{ ok: boolean; error?: string; message?: string }>;
  onDone?: (message: string) => void;
  redirectTo?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const what = count === 1 ? (name ?? "this lead") : `${count} leads`;
  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        <Trash2 aria-hidden="true" />
        Delete
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Delete ${what}?`}
        description="For leads made by mistake. Contacts, signals and the timeline of the lead go with it. A lead that has been approached, is in the pipeline or is linked to a client is kept: send it to No go instead."
      >
        <div className="space-y-4">
          {error && (
            <p role="alert" className="rounded-xl border border-danger/20 bg-danger-bg px-4 py-3 text-sm text-danger">
              {error}
            </p>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={pending}
              aria-busy={pending}
              onClick={() =>
                start(async () => {
                  const result = await action();
                  if (!result.ok) {
                    setError(result.error ?? "Something went wrong.");
                    return;
                  }
                  setOpen(false);
                  onDone?.(result.message ?? "Deleted.");
                  if (redirectTo) router.push(redirectTo);
                  else router.refresh();
                })
              }
            >
              {pending ? "Deleting" : "Delete"}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

export type EditableSignal = {
  id: string;
  title: string | null;
  url: string | null;
  description: string | null;
  closed: boolean;
  postedAt?: string | null;
  validUntil?: string | null;
};

export function EditSignalButton({ signal, action }: { signal: EditableSignal; action: FormAction }) {
  return (
    <ActionModal
      label="Edit"
      icon={Pencil}
      variant="ghost"
      ariaLabel={`Edit signal ${signal.title ?? ""}`.trim()}
      title="Edit signal"
      description="Change the title, link, date or text of this signal, until when it counts, or mark it offline (it expires)."
      action={action}
      modalSize="lg"
    >
      {(state) => {
        const e = state.fieldErrors ?? {};
        return (
          <>
            <Field label="Title" htmlFor="signal-title" required error={e.title}>
              <Input id="signal-title" name="title" defaultValue={signal.title ?? ""} {...invalidProps(state, "title", "signal-title")} />
            </Field>
            <Field label="Link" htmlFor="signal-url" hint="The vacancy itself." error={e.source_url}>
              <Input id="signal-url" name="source_url" type="url" defaultValue={signal.url ?? ""} {...invalidProps(state, "source_url", "signal-url")} />
            </Field>
            <Field label="Text" htmlFor="signal-description" error={e.description}>
              <Textarea id="signal-description" name="description" rows={8} defaultValue={signal.description ?? ""} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Date (online since)" htmlFor="signal-posted" error={e.posted_at}>
                <Input id="signal-posted" name="posted_at" type="date" defaultValue={signal.postedAt ?? ""} />
              </Field>
              <Field label="Valid until" htmlFor="signal-valid" hint="Empty: while it is open." error={e.valid_until}>
                <Input id="signal-valid" name="valid_until" type="date" defaultValue={signal.validUntil ?? ""} />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="closed" defaultChecked={signal.closed} className="size-4" />
              Offline: this signal no longer counts
            </label>
          </>
        );
      }}
    </ActionModal>
  );
}

export function DeleteSignalButton({ title, action }: { title: string; action: () => Promise<ActionState> }) {
  return (
    <ConfirmDelete
      label={`Delete signal ${title}`}
      iconOnly
      title="Delete this signal?"
      description={`${title} is removed from this lead. Claude may add it again if it is still online.`}
      confirmLabel="Delete signal"
      onConfirm={action}
    />
  );
}
