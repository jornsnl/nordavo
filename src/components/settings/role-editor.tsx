"use client";

import { useActionState, useState } from "react";
import { type ActionState, initialActionState } from "@/lib/action-state";
import type { ProfileRole } from "@/lib/database.types";
import { profileRoles } from "@/lib/labels";
import { Select } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";

/**
 * Inline role and client link editor for one row of the users table.
 * "stacked" is the phone version in the users list: full width controls,
 * and its own ids, because the table version is in the page as well.
 */
export function RoleEditor({
  action,
  userId,
  userName,
  role,
  clientId,
  clients,
  layout = "row",
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  userId: string;
  userName: string;
  role: ProfileRole;
  clientId: string | null;
  clients: { id: string; name: string }[];
  layout?: "row" | "stacked";
}) {
  const [state, formAction] = useActionState(action, initialActionState);
  const [nextRole, setNextRole] = useState<ProfileRole>(role);
  const [nextClient, setNextClient] = useState(clientId ?? "");
  const changed = nextRole !== role || (nextRole === "client" && nextClient !== (clientId ?? ""));
  const error = state.fieldErrors?.client_id ?? state.error;
  const stacked = layout === "stacked";
  const idFor = (field: string) => `${field}-${stacked ? "m-" : ""}${userId}`;

  return (
    <form action={formAction} className={stacked ? "grid gap-2" : "flex flex-wrap items-center gap-2"}>
      <input type="hidden" name="user_id" value={userId} />
      <label htmlFor={idFor("role")} className="sr-only">
        Rol van {userName}
      </label>
      <Select
        id={idFor("role")}
        name="role"
        value={nextRole}
        onChange={(e) => setNextRole(e.target.value as ProfileRole)}
        className={stacked ? "w-full" : "w-36 py-1.5"}
      >
        {profileRoles.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
      {nextRole === "client" && (
        <>
          <label htmlFor={idFor("client")} className="sr-only">
            Klant van {userName}
          </label>
          <Select
            id={idFor("client")}
            name="client_id"
            value={nextClient}
            onChange={(e) => setNextClient(e.target.value)}
            className={stacked ? "w-full" : "w-44 py-1.5"}
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
      <SubmitButton size={stacked ? "md" : "sm"} variant="secondary" disabled={!changed} pendingLabel="Bezig">
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
