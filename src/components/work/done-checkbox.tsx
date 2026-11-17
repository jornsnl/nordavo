"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { toast } from "@/components/ui/toaster";
import { submitTaskOp } from "@/lib/offline/sync";
import type { TaskListItem } from "@/lib/work/data";

/**
 * Round checkbox that ticks a Work task off. The tick goes through the same
 * outbox as every other change (src/lib/offline): the box and the list change
 * at once, the server hears about it right after. Before, it waited for a
 * server action plus a refresh of the whole layout, which took seconds and
 * let the box spring back in the meantime.
 *
 * When only the reviewer may finish the task, the server sends it to review
 * instead and the sync runtime says so; refusals are reported there too.
 * `task`: the task as the list shows it, so the device's copy can change.
 */
export function DoneCheckbox({
  taskId,
  title,
  done,
  task = null,
}: {
  taskId: string;
  title: string;
  done: boolean;
  task?: TaskListItem | null;
}) {
  // What the user ticked, until the server's state (`done`) changes by itself.
  const [local, setLocal] = useState<{ from: boolean; value: boolean } | null>(null);
  const checked = local && local.from === done ? local.value : done;

  async function toggle(next: boolean) {
    setLocal({ from: done, value: next });
    try {
      await submitTaskOp(
        {
          op: "task.status",
          payload: {
            taskId,
            status: next ? "done" : "todo",
            at: new Date().toISOString(),
            fallbackReview: next,
            ...(next ? {} : { comment: "Opened again." }),
          },
        },
        task,
      );
    } catch {
      setLocal(null);
      toast("This change could not be saved on this device.", { tone: "error" });
    }
  }

  return (
    <span className="relative inline-flex">
      {/* On touch screens the hit area grows to 44px without changing the layout. */}
      <label className="relative inline-flex size-6 shrink-0 cursor-pointer items-center justify-center pointer-coarse:-m-2.5 pointer-coarse:size-11">
        <input
          type="checkbox"
          className="peer absolute inset-0 cursor-pointer opacity-0"
          checked={checked}
          aria-label={checked ? `Open ${title} again` : `Mark ${title} as done`}
          onChange={(event) => void toggle(event.target.checked)}
        />
        <span
          aria-hidden="true"
          className={`flex size-5 items-center justify-center rounded-full border-2 transition peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand-500 ${
            checked
              ? "border-emerald-600 bg-emerald-600 text-white"
              : "border-brand-200 bg-white text-transparent hover:border-brand-500 peer-active:border-brand-500 peer-active:bg-brand-50"
          }`}
        >
          <Check className="size-3.5" strokeWidth={3} />
        </span>
      </label>
    </span>
  );
}
