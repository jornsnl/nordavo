"use client";

import { useActionState, useState } from "react";
import { type ActionState, initialActionState } from "@/lib/action-state";
import type { PortalModule } from "@/lib/database.types";
import { portalModules } from "@/lib/modules";
import { SubmitButton } from "@/components/ui/submit-button";

/**
 * Who sees what (2.5): the modules of one team member, as checkboxes.
 * "stacked" is the phone version with its own ids.
 */
export function ModulesEditor({
  action,
  userId,
  userName,
  modules,
  layout = "row",
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  userId: string;
  userName: string;
  modules: PortalModule[];
  layout?: "row" | "stacked";
}) {
  const [state, formAction] = useActionState(action, initialActionState);
  const [selected, setSelected] = useState<PortalModule[]>(modules);
  const changed =
    selected.length !== modules.length || selected.some((module) => !modules.includes(module));
  const stacked = layout === "stacked";

  return (
    <form action={formAction} className={stacked ? "grid gap-2" : "flex flex-wrap items-center gap-x-3 gap-y-2"}>
      <input type="hidden" name="user_id" value={userId} />
      <fieldset className={stacked ? "grid grid-cols-2 gap-2" : "flex flex-wrap gap-x-3 gap-y-1"}>
        <legend className="sr-only">Modules {userName} sees</legend>
        {portalModules.map((module) => {
          const id = `module-${module.value}-${stacked ? "m-" : ""}${userId}`;
          const checked = selected.includes(module.value);
          return (
            <label
              key={module.value}
              htmlFor={id}
              title={module.description}
              className="inline-flex items-center gap-1.5 text-sm text-ink pointer-coarse:min-h-11"
            >
              <input
                id={id}
                type="checkbox"
                name="modules"
                value={module.value}
                checked={checked}
                onChange={(e) =>
                  setSelected((current) =>
                    e.target.checked ? [...current, module.value] : current.filter((m) => m !== module.value),
                  )
                }
                className="size-4 rounded border-border accent-brand-600 focus-visible:outline-2 focus-visible:outline-brand-500"
              />
              {module.label}
            </label>
          );
        })}
      </fieldset>
      <SubmitButton size={stacked ? "md" : "sm"} variant="secondary" disabled={!changed} pendingLabel="Saving">
        Save
      </SubmitButton>
      {state.error && (
        <p role="alert" className="w-full text-xs font-medium text-danger">
          {state.error}
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
