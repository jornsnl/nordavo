"use client";

import { useActionState, useEffect, useId } from "react";
import { Input } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { toast } from "@/components/ui/toaster";
import { saveResultAction } from "@/app/content/actions/results";
import type { ContentActionState } from "@/lib/content/errors";

type Initial = { impressions: number | null; likes: number; comments: number; reposts: number } | null;

const fields = [
  { name: "impressions", label: "Impressions" },
  { name: "likes", label: "Likes" },
  { name: "comments", label: "Comments" },
  { name: "reposts", label: "Reposts" },
] as const;

/** One measurement (48 hours or 7 days) of a post. `inline` lays it out as a table row for the quick entry screen. */
export function ResultForm({
  postId,
  measuredAfter,
  initial,
  canEdit,
  offerMeasured,
  inline,
}: {
  postId: string;
  measuredAfter: "48h" | "7d";
  initial: Initial;
  canEdit: boolean;
  offerMeasured?: boolean;
  inline?: boolean;
}) {
  const id = useId();
  const [state, action] = useActionState(saveResultAction.bind(null, postId, measuredAfter), {} as ContentActionState);
  useEffect(() => {
    if (state.ok && state.message) toast(state.message, { tone: "success" });
    else if (state.error) toast(state.error, { tone: "error" });
  }, [state]);

  return (
    <form action={action} className={inline ? "flex flex-wrap items-end gap-2" : "space-y-3"}>
      <div className={inline ? "contents" : "grid grid-cols-2 gap-3 sm:grid-cols-4"}>
        {fields.map((f) => (
          <label key={f.name} className={inline ? "w-24 text-xs text-muted" : "block text-xs font-medium text-muted"}>
            {f.label}
            <Input
              id={`${id}-${f.name}`}
              name={f.name}
              inputMode="numeric"
              autoComplete="off"
              defaultValue={initial ? (initial[f.name] ?? "") : ""}
              disabled={!canEdit}
              aria-invalid={Boolean(state.fieldErrors?.[f.name])}
              className="mt-1"
              required={f.name === "likes" || f.name === "comments"}
            />
          </label>
        ))}
      </div>
      {canEdit && (
        <div className="flex flex-wrap items-center gap-3">
          {offerMeasured && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="mark_measured" defaultChecked className="size-4 accent-brand-700" />
              Set to Measured
            </label>
          )}
          <SubmitButton size="sm" pendingLabel="Saving">
            {initial ? "Update" : "Save"}
          </SubmitButton>
        </div>
      )}
    </form>
  );
}
