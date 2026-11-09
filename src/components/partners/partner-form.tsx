"use client";

import { useActionState, useState } from "react";
import { Field, FormMessage, Input, Select, Textarea } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialActionState, type ActionState } from "@/lib/action-state";

type Defaults = {
  name: string;
  companyName: string | null;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  notes: string | null;
  status: "active" | "inactive";
  ownerId: string | null;
};

/** Create or edit a partner. */
export function PartnerForm({
  action,
  team,
  defaults,
  submitLabel,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  team: { id: string; name: string }[];
  defaults?: Defaults;
  submitLabel: string;
}) {
  const [state, formAction] = useActionState(action, initialActionState);
  const p = defaults ? "edit-partner" : "new-partner";
  const err = state.fieldErrors ?? {};
  return (
    <form action={formAction} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor={`${p}-name`} required error={err.name}>
          <Input id={`${p}-name`} name="name" required maxLength={200} defaultValue={defaults?.name} autoComplete="off" />
        </Field>
        <Field label="Company" htmlFor={`${p}-company`} error={err.company_name}>
          <Input id={`${p}-company`} name="company_name" maxLength={200} defaultValue={defaults?.companyName ?? ""} />
        </Field>
        <Field label="Email" htmlFor={`${p}-email`} error={err.email}>
          <Input id={`${p}-email`} name="email" type="email" inputMode="email" maxLength={320} defaultValue={defaults?.email ?? ""} />
        </Field>
        <Field label="Phone" htmlFor={`${p}-phone`} error={err.phone}>
          <Input id={`${p}-phone`} name="phone" type="tel" inputMode="tel" maxLength={50} defaultValue={defaults?.phone ?? ""} />
        </Field>
        <Field label="LinkedIn" htmlFor={`${p}-linkedin`} error={err.linkedin_url} className="sm:col-span-2">
          <Input
            id={`${p}-linkedin`}
            name="linkedin_url"
            type="url"
            inputMode="url"
            maxLength={500}
            placeholder="https://www.linkedin.com/in/..."
            defaultValue={defaults?.linkedinUrl ?? ""}
          />
        </Field>
        <Field label="Status" htmlFor={`${p}-status`} error={err.status}>
          <Select id={`${p}-status`} name="status" defaultValue={defaults?.status ?? "active"}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </Select>
        </Field>
        <Field label="Owner" htmlFor={`${p}-owner`} hint={defaults ? undefined : "Default: you."} error={err.owner_id}>
          <Select id={`${p}-owner`} name="owner_id" defaultValue={defaults?.ownerId ?? ""}>
            <option value="">{defaults ? "Nobody" : "Me"}</option>
            {team.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Notes" htmlFor={`${p}-notes`} error={err.notes}>
        <Textarea id={`${p}-notes`} name="notes" rows={4} maxLength={5000} defaultValue={defaults?.notes ?? ""} />
      </Field>
      <SubmitButton size="sm" pendingLabel="Saving" className="max-sm:w-full pointer-coarse:min-h-11">
        {submitLabel}
      </SubmitButton>
      <FormMessage error={state.error} success={state.ok ? state.message : undefined} />
    </form>
  );
}

/** Log a contact moment with the partner. */
export function ContactMomentForm({ action }: { action: (prev: ActionState, formData: FormData) => Promise<ActionState> }) {
  // A new key per saved moment empties the form.
  const [round, setRound] = useState(0);
  const [state, formAction] = useActionState(async (prev: ActionState, formData: FormData) => {
    const result = await action(prev, formData);
    if (result.ok) setRound((r) => r + 1);
    return result;
  }, initialActionState);
  const err = state.fieldErrors ?? {};
  return (
    <form action={formAction} className="space-y-4" key={round}>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="How" htmlFor="moment-channel" required error={err.channel}>
          <Select id="moment-channel" name="channel" defaultValue="bellen">
            <option value="bellen">Call</option>
            <option value="mail">Mail</option>
            <option value="linkedin">LinkedIn</option>
            <option value="meeting">Meeting</option>
          </Select>
        </Field>
        <Field label="Who started" htmlFor="moment-direction" error={err.direction}>
          <Select id="moment-direction" name="direction" defaultValue="outbound">
            <option value="outbound">We did</option>
            <option value="inbound">The partner did</option>
          </Select>
        </Field>
        <Field label="Date" htmlFor="moment-date" hint="Default today." error={err.date}>
          <Input id="moment-date" name="date" type="date" />
        </Field>
      </div>
      <Field label="What was discussed" htmlFor="moment-notes" required error={err.notes}>
        <Textarea id="moment-notes" name="notes" rows={3} required maxLength={5000} />
      </Field>
      <SubmitButton size="sm" pendingLabel="Saving" className="max-sm:w-full pointer-coarse:min-h-11">
        Save contact moment
      </SubmitButton>
      <FormMessage error={state.error} success={state.ok ? state.message : undefined} />
    </form>
  );
}
