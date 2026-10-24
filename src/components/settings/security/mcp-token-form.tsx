"use client";

import { useActionState, useEffect, useRef } from "react";
import { KeyRound, TriangleAlert } from "lucide-react";
import { initialActionState } from "@/lib/action-state";
import type { McpTokenActionState } from "@/app/dashboard/instellingen/mcp-actions";
import { Field, FormMessage, Input, Select } from "@/components/ui/field";
import { PendingSubmit, submitWithoutReset } from "@/components/placements/form-utils";
import { McpCodeBlock, mcpAddCommand } from "@/components/settings/security/mcp-code-block";

/** Create a token; shows it once, with the ready-to-paste command. */
export function McpTokenForm({
  action,
  endpoint,
  enabled,
}: {
  action: (state: McpTokenActionState, formData: FormData) => Promise<McpTokenActionState>;
  endpoint: string;
  /** False when the server has no SUPABASE_SECRET_KEY, so tokens would not work. */
  enabled: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, initialActionState as McpTokenActionState);
  const formRef = useRef<HTMLFormElement>(null);
  const errors = state.fieldErrors ?? {};
  const describedBy = (name: string) => (errors[name] ? `mcp_${name}-error` : undefined);

  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);

  return (
    <div className="space-y-5">
      <form ref={formRef} onSubmit={submitWithoutReset(formAction)} className="space-y-5" noValidate>
        <FormMessage error={state.error} />
        <div className="grid gap-5 sm:grid-cols-3">
          <Field
            label="Naam"
            htmlFor="mcp_name"
            required
            error={errors.name}
            hint="Bijvoorbeeld de laptop waarop je Claude Code gebruikt."
          >
            <Input
              id="mcp_name"
              name="name"
              maxLength={80}
              autoComplete="off"
              enterKeyHint="done"
              placeholder="MacBook werk"
              required
              disabled={!enabled}
              aria-invalid={Boolean(errors.name)}
              aria-describedby={describedBy("name")}
            />
          </Field>
          <Field
            label="Rechten"
            htmlFor="mcp_access"
            required
            error={errors.access}
            hint="Kies lezen, tenzij Claude ook taken en notities moet aanmaken."
          >
            <Select id="mcp_access" name="access" defaultValue="read" disabled={!enabled}>
              <option value="read">Lezen</option>
              <option value="write">Lezen en schrijven</option>
            </Select>
          </Field>
          <Field label="Geldig" htmlFor="mcp_expires" required error={errors.expires}>
            <Select id="mcp_expires" name="expires" defaultValue="90" disabled={!enabled}>
              <option value="30">30 dagen</option>
              <option value="90">90 dagen</option>
              <option value="365">365 dagen</option>
              <option value="never">Nooit verlopen</option>
            </Select>
          </Field>
        </div>
        <div className="flex justify-end max-sm:*:w-full">
          <PendingSubmit pending={pending} disabled={!enabled} pendingLabel="Bezig met aanmaken">
            <KeyRound aria-hidden="true" />
            Token aanmaken
          </PendingSubmit>
        </div>
      </form>

      {state.ok && state.token && (
        <div
          role="status"
          className="space-y-4 rounded-xl border border-emerald-600/20 bg-emerald-50/60 px-4 py-4"
        >
          <p className="flex items-start gap-2 text-sm font-medium text-emerald-900">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {state.message}
          </p>
          <div className="space-y-1.5">
            <p className="text-xs font-medium tracking-wide text-muted uppercase">Je token</p>
            <McpCodeBlock code={state.token} label="Token" />
          </div>
          <div className="space-y-1.5">
            <p className="text-xs font-medium tracking-wide text-muted uppercase">
              Plak dit in je terminal
            </p>
            <McpCodeBlock code={mcpAddCommand(endpoint, state.token, "user")} label="Commando" />
            <p className="text-xs text-muted">
              Met <code className="font-mono">--scope user</code> werkt Nordavo in al je projecten. Laat
              het weg om de koppeling alleen in de huidige map te gebruiken.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
