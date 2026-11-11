"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { type ActionState, initialActionState } from "@/lib/action-state";
import type { ProfileRole } from "@/lib/database.types";
import { profileRoles } from "@/lib/labels";
import { portalModules } from "@/lib/modules";
import { Field, FormMessage, Input, Select } from "@/components/ui/field";
import { SearchSelect } from "@/components/ui/search-select";
import { PendingSubmit, submitWithoutReset } from "@/components/placements/form-utils";

export function InviteForm({
  action,
  clients,
  contentWorkspaces = [],
  enabled,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  clients: { id: string; name: string }[];
  /** For a Content only account (the reviewer). */
  contentWorkspaces?: { id: string; name: string }[];
  /** False when SUPABASE_SECRET_KEY is missing on the server. */
  enabled: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, initialActionState);
  const formRef = useRef<HTMLFormElement>(null);
  const [role, setRole] = useState<ProfileRole | "content">("member");
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
            onChange={(e) => setRole(e.target.value as ProfileRole | "content")}
          >
            {/* External callers are invited under Callers. */}
            {profileRoles
              .filter((option) => option.value !== "caller")
              .map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            <option value="content">Content only (reviewer)</option>
          </Select>
        </Field>
        {role === "content" && (
          <fieldset className="space-y-3 sm:col-span-2">
            <legend className="text-sm font-medium text-ink">Content workspaces</legend>
            <p className="text-xs text-muted">
              This account only sees Content and its own Work inbox: no sales, candidates or clients. Pick the workspaces and the role in them.
            </p>
            {contentWorkspaces.length === 0 ? (
              <p className="text-sm text-muted">There is no Content workspace yet. Make one under Content first.</p>
            ) : (
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {contentWorkspaces.map((ws) => (
                  <label key={ws.id} className="inline-flex items-center gap-1.5 text-sm text-ink pointer-coarse:min-h-11">
                    <input
                      type="checkbox"
                      name="content_workspaces"
                      value={ws.id}
                      defaultChecked={contentWorkspaces.length === 1}
                      disabled={!enabled}
                      className="size-4 rounded border-border accent-brand-600"
                    />
                    {ws.name}
                  </label>
                ))}
              </div>
            )}
            {errors.content_workspaces && (
              <p id="invite_content_workspaces-error" className="text-xs text-danger">
                {errors.content_workspaces}
              </p>
            )}
            <Field label="Role in Content" htmlFor="invite_content_role">
              <Select id="invite_content_role" name="content_role" defaultValue="reviewer" disabled={!enabled} className="sm:w-60">
                <option value="reviewer">Reviewer: edits, approves, schedules, publishes</option>
                <option value="viewer">Viewer: reads only</option>
                <option value="author">Author: writes their own posts</option>
              </Select>
            </Field>
          </fieldset>
        )}
        {role === "client" && (
          <Field
            label="Client"
            htmlFor="invite_client_id"
            required
            error={errors.client_id}
            hint="This account only sees the vacancies and candidates of this client."
          >
            <SearchSelect
              id="invite_client_id"
              name="client_id"
              disabled={!enabled}
              required
              aria-invalid={Boolean(errors.client_id)}
              aria-describedby={describedBy("client_id")}
              placeholder="Pick a client"
              searchPlaceholder="Search clients"
              options={clients.map((client) => ({ value: client.id, label: client.name }))}
            />
          </Field>
        )}
        {role === "member" && (
          <fieldset className="sm:col-span-2">
            <legend className="text-sm font-medium text-ink">Modules</legend>
            <p className="mt-0.5 text-xs text-muted">What this team member sees. You can change it later in the list above.</p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
              {portalModules.map((module) => (
                <label key={module.value} className="inline-flex items-center gap-1.5 text-sm text-ink pointer-coarse:min-h-11" title={module.description}>
                  <input
                    type="checkbox"
                    name="modules"
                    value={module.value}
                    defaultChecked
                    disabled={!enabled}
                    className="size-4 rounded border-border accent-brand-600"
                  />
                  {module.label}
                </label>
              ))}
            </div>
          </fieldset>
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
