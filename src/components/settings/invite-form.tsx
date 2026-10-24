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
          Uitnodigen vanuit het portaal werkt pas als <code className="font-mono text-xs">SUPABASE_SECRET_KEY</code>{" "}
          op de server is ingesteld. Tot die tijd nodig je gebruikers uit via het Supabase dashboard
          onder Authentication, Users. Daarna pas je hier de rol aan.
        </p>
      )}
      <FormMessage error={state.error} success={state.ok ? state.message : undefined} />
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="E-mailadres" htmlFor="invite_email" required error={errors.email}>
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
            placeholder="naam@bedrijf.nl"
            aria-invalid={Boolean(errors.email)}
            aria-describedby={describedBy("email")}
          />
        </Field>
        <Field label="Naam" htmlFor="invite_full_name" required error={errors.full_name}>
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
        <Field label="Rol" htmlFor="invite_role" required error={errors.role}>
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
            label="Klant"
            htmlFor="invite_client_id"
            required
            error={errors.client_id}
            hint="Dit account ziet alleen de vacatures en kandidaten van deze klant."
          >
            <Select
              id="invite_client_id"
              name="client_id"
              defaultValue=""
              disabled={!enabled}
              aria-invalid={Boolean(errors.client_id)}
              aria-describedby={describedBy("client_id")}
            >
              <option value="">Kies een klant</option>
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
        <PendingSubmit pending={pending} disabled={!enabled} pendingLabel="Bezig met versturen">
          <Send aria-hidden="true" />
          Uitnodiging versturen
        </PendingSubmit>
      </div>
    </form>
  );
}
