"use client";

import { useActionState, useState } from "react";
import { Copy, KeyRound } from "lucide-react";
import type { WorkActionState } from "@/lib/work/errors";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input, Select } from "@/components/ui/field";
import { PendingSubmit, submitWithoutReset } from "@/components/placements/form-utils";
import { useWorkAction, type WorkAction } from "@/components/work/forms";

export function ProfileForm({
  action,
  name,
  timeZone,
  zones,
}: {
  action: WorkAction;
  name: string;
  timeZone: string;
  zones: string[];
}) {
  const { state, formAction, pending, errors } = useWorkAction(action);
  const options = zones.includes(timeZone) ? zones : [timeZone, ...zones];
  return (
    <form onSubmit={submitWithoutReset(formAction)} className="space-y-4">
      <FormMessage error={state.error} success={state.ok ? state.message : undefined} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor="me_name" required error={errors.full_name}>
          <Input id="me_name" name="full_name" defaultValue={name} required maxLength={120} />
        </Field>
        <Field label="Time zone" htmlFor="me_tz" hint="Deadlines are shown in this zone" error={errors.time_zone}>
          <Select id="me_tz" name="time_zone" defaultValue={timeZone}>
            {options.map((zone) => (
              <option key={zone} value={zone}>
                {zone.replace(/_/g, " ")}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="flex justify-end max-sm:*:w-full">
        <PendingSubmit pending={pending} pendingLabel="Saving">
          Save
        </PendingSubmit>
      </div>
    </form>
  );
}

export function NotificationPrefsForm({
  action,
  kinds,
  values,
}: {
  action: WorkAction;
  kinds: { value: string; label: string; description: string; default: string }[];
  values: Record<string, string>;
}) {
  const { state, formAction, pending } = useWorkAction(action);
  return (
    <form onSubmit={submitWithoutReset(formAction)} className="space-y-4">
      <FormMessage error={state.error} success={state.ok ? state.message : undefined} />
      <ul className="divide-y divide-border">
        {kinds.map((kind) => (
          <li key={kind.value} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium">{kind.label}</p>
              <p className="text-xs text-muted">{kind.description}</p>
            </div>
            <label className="sm:w-48">
              <span className="sr-only">{kind.label}</span>
              <Select name={`pref_${kind.value}`} defaultValue={values[kind.value] ?? kind.default} className="w-full py-2">
                <option value="instant">Mail right away</option>
                <option value="digest">In the daily overview</option>
                <option value="off">Off</option>
              </Select>
            </label>
          </li>
        ))}
      </ul>
      <div className="flex justify-end max-sm:*:w-full">
        <PendingSubmit pending={pending} pendingLabel="Saving">
          Save
        </PendingSubmit>
      </div>
    </form>
  );
}

type TokenState = WorkActionState & { token?: string };

export function ApiTokenForm({ action }: { action: (state: TokenState, formData: FormData) => Promise<TokenState> }) {
  const [state, formAction, pending] = useActionState(action, {} as TokenState);
  const [copied, setCopied] = useState(false);
  const errors = state.fieldErrors ?? {};
  return (
    <form onSubmit={submitWithoutReset(formAction)} className="space-y-4">
      <FormMessage error={state.error} />
      {state.token && (
        <div className="space-y-2 rounded-xl border border-emerald-600/20 bg-emerald-50 p-3">
          <p className="text-sm text-emerald-900">{state.message}</p>
          <div className="flex gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg bg-white px-3 py-2 font-mono text-xs">{state.token}</code>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                void navigator.clipboard.writeText(state.token!);
                setCopied(true);
              }}
            >
              <Copy aria-hidden="true" />
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Name" htmlFor="token_name" required error={errors.name}>
          <Input id="token_name" name="name" placeholder="Claude on my laptop" maxLength={80} required />
        </Field>
        <Field label="Access" htmlFor="token_access">
          <Select id="token_access" name="access" defaultValue="read">
            <option value="read">Read only</option>
            <option value="write">Read and write</option>
          </Select>
        </Field>
        <Field label="Expires" htmlFor="token_expiry">
          <Select id="token_expiry" name="expires_in_days" defaultValue="90">
            <option value="30">After 30 days</option>
            <option value="90">After 90 days</option>
            <option value="365">After a year</option>
            <option value="0">Never</option>
          </Select>
        </Field>
      </div>
      <div className="flex justify-end max-sm:*:w-full">
        <PendingSubmit pending={pending}>
          <KeyRound aria-hidden="true" />
          Create token
        </PendingSubmit>
      </div>
    </form>
  );
}
