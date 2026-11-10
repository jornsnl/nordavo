"use client";

import { useActionState } from "react";
import { FormMessage } from "@/components/ui/field";
import { PendingSubmit, submitWithoutReset } from "@/components/placements/form-utils";
import type { ContentActionState } from "@/lib/content/errors";

type Pref = { kind: string; label: string; inApp: boolean; email: boolean };

/** In the app and by email, per kind, grouped by who it is for. */
export function NotificationPrefsForm({
  action,
  groups,
}: {
  action: (prev: ContentActionState, formData: FormData) => Promise<ContentActionState>;
  groups: { title: string; prefs: Pref[] }[];
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form onSubmit={submitWithoutReset(formAction)} className="space-y-6">
      <FormMessage error={state.error} success={state.ok ? state.message : undefined} />
      {groups.map((group) => (
        <fieldset key={group.title}>
          <legend className="mb-2 font-display text-sm font-semibold text-brand-900">{group.title}</legend>
          <ul className="divide-y divide-border rounded-xl border border-border bg-white">
            {group.prefs.map((pref) => (
              <li key={pref.kind} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-sm font-medium">{pref.label}</span>
                <span className="flex gap-5 text-sm">
                  {pref.kind !== "weekly_summary" && (
                    <label className="flex items-center gap-2">
                      <input type="checkbox" name={`in_app:${pref.kind}`} defaultChecked={pref.inApp} className="size-4 accent-brand-700" />
                      In the app
                    </label>
                  )}
                  <label className="flex items-center gap-2">
                    <input type="checkbox" name={`email:${pref.kind}`} defaultChecked={pref.email} className="size-4 accent-brand-700" />
                    By email
                  </label>
                </span>
              </li>
            ))}
          </ul>
        </fieldset>
      ))}
      <div className="flex justify-end max-sm:*:w-full">
        <PendingSubmit pending={pending} pendingLabel="Saving">
          Save
        </PendingSubmit>
      </div>
    </form>
  );
}
