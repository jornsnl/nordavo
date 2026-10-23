"use client";

import { useOptimistic, useTransition } from "react";
import { Check } from "lucide-react";
import { setTaskDone } from "./actions";

/** Round checkbox that ticks a task off straight away and saves in the background. */
export function TaskCheckbox({ taskId, title, done }: { taskId: string; title: string; done: boolean }) {
  const [optimisticDone, setOptimisticDone] = useOptimistic(done);
  const [pending, startTransition] = useTransition();

  return (
    <label className="relative inline-flex size-6 shrink-0 cursor-pointer items-center justify-center">
      <input
        type="checkbox"
        className="peer absolute inset-0 cursor-pointer opacity-0"
        checked={optimisticDone}
        aria-busy={pending}
        aria-label={optimisticDone ? `${title} weer openzetten` : `${title} afvinken`}
        onChange={(event) => {
          const next = event.target.checked;
          startTransition(async () => {
            setOptimisticDone(next);
            await setTaskDone(taskId, next);
          });
        }}
      />
      <span
        aria-hidden="true"
        className={`flex size-5 items-center justify-center rounded-full border-2 transition peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand-500 ${
          optimisticDone
            ? "border-emerald-600 bg-emerald-600 text-white"
            : "border-brand-200 bg-white text-transparent hover:border-brand-500"
        }`}
      >
        <Check className="size-3.5" strokeWidth={3} />
      </span>
    </label>
  );
}
