"use client";

import { useActionState, useEffect, useRef } from "react";
import { KeyRound, TriangleAlert } from "lucide-react";
import { initialActionState } from "@/lib/action-state";
import type { McpTokenActionState } from "@/app/dashboard/settings/mcp-actions";
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
            label="Name"
            htmlFor="mcp_name"
            required
            error={errors.name}
            hint="For example the laptop you use Claude Code on."
          >
            <Input
              id="mcp_name"
              name="name"
              maxLength={80}
              autoComplete="off"
              enterKeyHint="done"
              placeholder="Work MacBook"
              required
              disabled={!enabled}
              aria-invalid={Boolean(errors.name)}
              aria-describedby={describedBy("name")}
            />
          </Field>
          <Field
            label="Access"
            htmlFor="mcp_access"
            required
            error={errors.access}
            hint="Choose read, unless Claude also needs to create tasks and notes."
          >
            <Select id="mcp_access" name="access" defaultValue="read" disabled={!enabled}>
              <option value="read">Read</option>
              <option value="write">Read and write</option>
            </Select>
          </Field>
          <Field label="Valid for" htmlFor="mcp_expires" required error={errors.expires}>
            <Select id="mcp_expires" name="expires" defaultValue="90" disabled={!enabled}>
              <option value="30">30 days</option>
              <option value="90">90 days</option>
              <option value="365">365 days</option>
              <option value="never">Never expires</option>
            </Select>
          </Field>
        </div>
        <div className="flex justify-end max-sm:*:w-full">
          <PendingSubmit pending={pending} disabled={!enabled} pendingLabel="Creating">
            <KeyRound aria-hidden="true" />
            Create token
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
            <p className="text-xs font-medium tracking-wide text-muted uppercase">Your token</p>
            <McpCodeBlock code={state.token} label="Token" />
          </div>
          <div className="space-y-1.5">
            <p className="text-xs font-medium tracking-wide text-muted uppercase">
              Paste this in your terminal
            </p>
            <McpCodeBlock code={mcpAddCommand(endpoint, state.token, "user")} label="Command" />
            <p className="text-xs text-muted">
              With <code className="font-mono">--scope user</code> Nordavo works in all your projects. Leave
              it out to use the connection only in the current folder.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
