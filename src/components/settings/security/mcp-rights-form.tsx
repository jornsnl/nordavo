"use client";

import { useActionState } from "react";
import { type ActionState, initialActionState } from "@/lib/action-state";
import { mcpModules, mcpWriteLevels, type McpAccessLevels, levelOf } from "@/lib/mcp/module-access";
import { FormMessage, Select } from "@/components/ui/field";
import { PendingSubmit, submitWithoutReset } from "@/components/placements/form-utils";

/** Per module how far Claude may write. Admins only. */
export function McpRightsForm({
  action,
  levels,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  levels: McpAccessLevels;
}) {
  const [state, formAction, pending] = useActionState(action, initialActionState);
  return (
    <form onSubmit={submitWithoutReset(formAction)} className="space-y-4" noValidate>
      <FormMessage error={state.error} success={state.ok ? state.message : undefined} />
      <ul className="divide-y divide-border rounded-xl border border-border">
        {mcpModules.map((m) => (
          <li key={m.value} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <label htmlFor={`mcp_level_${m.value}`} className="min-w-0">
              <span className="block text-sm font-medium text-ink">{m.label}</span>
              <span className="block text-xs text-muted">{m.description}</span>
            </label>
            <Select id={`mcp_level_${m.value}`} name={`level_${m.value}`} defaultValue={levelOf(levels, m.value)} className="w-full sm:w-60">
              {mcpWriteLevels.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </Select>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted">
        {mcpWriteLevels.map((l) => `${l.label}: ${l.description}`).join(" ")} A new module starts at drafts and suggestions. This applies to every
        token of the team; a token never does more than its owner may.
      </p>
      <div className="flex justify-end max-sm:*:w-full">
        <PendingSubmit pending={pending} pendingLabel="Saving">
          Save rights
        </PendingSubmit>
      </div>
    </form>
  );
}
