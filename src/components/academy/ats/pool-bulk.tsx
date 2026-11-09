"use client";

import { useActionState, useState } from "react";
import { poolBulkAction } from "@/app/dashboard/candidates/academy-actions";
import { initialActionState } from "@/lib/action-state";
import { FormMessage, Select } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";

export const POOL_BULK_FORM = "pool-bulk";

/**
 * The bulk bar of the talent pool. The row checkboxes belong to this form
 * through form="pool-bulk"; "all matches" sends the filters instead, so a
 * whole list or a whole vacancy can be enrolled at once.
 */
export function PoolBulkBar({
  total,
  filters,
  canManage,
  groups,
  modules,
}: {
  total: number;
  /** The current filters as a query string. */
  filters: string;
  canManage: boolean;
  groups: { id: string; name: string }[];
  modules: { id: string; title: string; in_default_access: boolean }[];
}) {
  const [state, action] = useActionState(poolBulkAction, initialActionState);
  const [op, setOp] = useState(canManage ? "enrol" : "top_on");
  const extra = modules.filter((m) => !m.in_default_access);
  return (
    <form id={POOL_BULK_FORM} action={action} className="space-y-3 rounded-2xl border border-border bg-card p-3 shadow-xs sm:p-4">
      <input type="hidden" name="filters" value={filters} />
      <FormMessage error={state.error} success={state.message} />
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-ink">Do</span>
          <Select name="op" value={op} onChange={(e) => setOp(e.target.value)} className="w-64">
            {canManage && <option value="enrol">Add to the developer course</option>}
            <option value="top_on">Mark as top candidate</option>
            <option value="top_off">Remove top candidate</option>
            {canManage && groups.length > 0 && <option value="group">Add to a group</option>}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-ink">For</span>
          <Select name="target" defaultValue="selected" className="w-56">
            <option value="selected">The ticked candidates</option>
            <option value="all">All {total} matches of the filters</option>
          </Select>
        </label>
        {(op === "enrol" || op === "group") && groups.length > 0 && (
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-ink">Group</span>
            <Select name="group_id" defaultValue="" className="w-56">
              {op === "enrol" && <option value="">No group</option>}
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </Select>
          </label>
        )}
        <SubmitButton size="md" pendingLabel="Working…">
          Apply
        </SubmitButton>
      </div>
      {op === "enrol" && (
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
          {extra.map((m) => (
            <label key={m.id} className="flex items-center gap-2">
              <input type="checkbox" name="open_module_ids" value={m.id} className="size-4 accent-brand-700" />
              Also open: {m.title}
            </label>
          ))}
          <label className="flex items-center gap-2">
            <input type="checkbox" name="send_mail" defaultChecked className="size-4 accent-brand-700" />
            Send the invitation mail
          </label>
        </div>
      )}
    </form>
  );
}
