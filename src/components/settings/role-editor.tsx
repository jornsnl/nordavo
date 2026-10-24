"use client";

import { useActionState, useState } from "react";
import { type ActionState, initialActionState } from "@/lib/action-state";
import type { ProfileRole } from "@/lib/database.types";
import { profileRoles } from "@/lib/labels";
import { Select } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";

/** Inline role and client link editor for one row of the users table. */
export function RoleEditor({
  action,
  userId,
  userName,
  role,
  clientId,
  clients,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  userId: string;
  userName: string;
  role: ProfileRole;
  clientId: string | null;
  clients: { id: string; name: string }[];
}) {
  const [state, formAction] = useActionState(action, initialActionState);
  const [nextRole, setNextRole] = useState<ProfileRole>(role);
  const [nextClient, setNextClient] = useState(clientId ?? "");
  const changed = nextRole !== role || (nextRole === "client" && nextClient !== (clientId ?? ""));
  const error = state.fieldErrors?.client_id ?? state.error;

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="user_id" value={userId} />
      <label htmlFor={`role-${userId}`} className="sr-only">
        Rol van {userName}
      </label>
      <Select
        id={`role-${userId}`}
        name="role"
        value={nextRole}
        onChange={(e) => setNextRole(e.target.value as ProfileRole)}
        className="w-36 py-1.5"
      >
        {profileRoles.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
      {nextRole === "client" && (
        <>
          <label htmlFor={`client-${userId}`} className="sr-only">
            Klant van {userName}
          </label>
          <Select
            id={`client-${userId}`}
            name="client_id"
            value={nextClient}
            onChange={(e) => setNextClient(e.target.value)}
            className="w-44 py-1.5"
            aria-invalid={Boolean(state.fieldErrors?.client_id)}
          >
            <option value="">Kies een klant</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </Select>
        </>
      )}
      <SubmitButton size="sm" variant="secondary" disabled={!changed} pendingLabel="Bezig">
        Opslaan
      </SubmitButton>
      {error && (
        <p role="alert" className="w-full text-xs font-medium text-danger">
          {error}
        </p>
      )}
      {state.ok && !changed && (
        <p role="status" className="w-full text-xs text-emerald-700">
          {state.message}
        </p>
      )}
    </form>
  );
}
