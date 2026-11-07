"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { type ActionState, initialActionState } from "@/lib/action-state";
import type { ProfileRole } from "@/lib/database.types";
import { profileRoles } from "@/lib/labels";
import { Field, FormMessage, Input, Select } from "@/components/ui/field";
import { PendingSubmit, submitWithoutReset } from "@/components/placements/form-utils";

export function InviteForm({
  action,
  clients,
  enabled,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  clients: { id: string; name: string }[];
  /** False when SUPABASE_SECRET_KEY is missing on the server. */
  enabled: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, initialActionState);
  const formRef = useRef<HTMLFormElement>(null);
  const [role, setRole] = useState<ProfileRole>("member");
  const errors = state.fieldErrors ?? {};
  const describedBy = (name: string) => (errors[name] ? `invite_${name}-error` : undefined);

  // Clear the typed e-mail and name once the invite is on its way.
  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} onSubmit={submitWithoutReset(formAction)} className="space-y-5" noValidate>
      {!enabled && (
        <p className="rounded-xl border border-amber-600/20 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Inviting from the portal only works once <code className="font-mono text-xs">SUPABASE_SECRET_KEY</code>{" "}
          is set on the server. Until then, invite users through the Supabase dashboard
          under Authentication, Users. Then change their role here.
        </p>
      )}
      <FormMessage error={state.error} success={state.ok ? state.message : undefined} />
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Email address" htmlFor="invite_email" required error={errors.email}>
          <Input
            id="invite_email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="next"
            required
            disabled={!enabled}
            placeholder="name@company.com"
            aria-invalid={Boolean(errors.email)}
            aria-describedby={describedBy("email")}
          />
        </Field>
        <Field label="Name" htmlFor="invite_full_name" required error={errors.full_name}>
          <Input
            id="invite_full_name"
            name="full_name"
            autoComplete="off"
            autoCapitalize="words"
            enterKeyHint="next"
            required
            disabled={!enabled}
            aria-invalid={Boolean(errors.full_name)}
            aria-describedby={describedBy("full_name")}
          />
        </Field>
        <Field label="Role" htmlFor="invite_role" required error={errors.role}>
          <Select
            id="invite_role"
            name="role"
            value={role}
            disabled={!enabled}
            onChange={(e) => setRole(e.target.value as ProfileRole)}
          >
            {profileRoles.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>
        {role === "client" && (
          <Field
            label="Client"
            htmlFor="invite_client_id"
            required
            error={errors.client_id}
            hint="This account only sees the vacancies and candidates of this client."
          >
            <Select
              id="invite_client_id"
              name="client_id"
              defaultValue=""
              disabled={!enabled}
              aria-invalid={Boolean(errors.client_id)}
              aria-describedby={describedBy("client_id")}
            >
              <option value="">Pick a client</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>
      <div className="flex justify-end max-sm:*:w-full">
        <PendingSubmit pending={pending} disabled={!enabled} pendingLabel="Sending">
          <Send aria-hidden="true" />
          Send invite
        </PendingSubmit>
      </div>
    </form>
  );
}
