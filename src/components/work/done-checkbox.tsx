"use client";

import { useOptimistic, useState, useTransition } from "react";
import { Check } from "lucide-react";
import { toggleTaskDoneAction } from "@/app/work/record-actions";

/**
 * Round checkbox that ticks a Work task off outside the task page (record
 * tasks block, dashboard). When only the reviewer may finish the task, it
 * goes to review instead and the note says so; refusals are shown.
 */
export function DoneCheckbox({ taskId, title, done }: { taskId: string; title: string; done: boolean }) {
  const [optimisticDone, setOptimisticDone] = useOptimistic(done);
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);

  return (
    <span className="relative inline-flex">
      {/* On touch screens the hit area grows to 44px without changing the layout. */}
      <label className="relative inline-flex size-6 shrink-0 cursor-pointer items-center justify-center pointer-coarse:-m-2.5 pointer-coarse:size-11">
        <input
          type="checkbox"
          className="peer absolute inset-0 cursor-pointer opacity-0"
          checked={optimisticDone}
          aria-busy={pending}
          aria-label={optimisticDone ? `Open ${title} again` : `Mark ${title} as done`}
          onChange={(event) => {
            const next = event.target.checked;
            setNote(null);
            startTransition(async () => {
              setOptimisticDone(next);
              const result = await toggleTaskDoneAction(taskId, next);
              if (result.error) setNote({ text: result.error, error: true });
              else if (result.message && result.message !== "Done.") setNote({ text: result.message, error: false });
            });
          }}
        />
        <span
          aria-hidden="true"
          className={`flex size-5 items-center justify-center rounded-full border-2 transition peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand-500 ${
            optimisticDone
              ? "border-emerald-600 bg-emerald-600 text-white"
              : "border-brand-200 bg-white text-transparent hover:border-brand-500 peer-active:border-brand-500 peer-active:bg-brand-50"
          }`}
        >
          <Check className="size-3.5" strokeWidth={3} />
        </span>
      </label>
      {note && <DoneNote text={note.text} error={note.error} onClose={() => setNote(null)} />}
    </span>
  );
}

function DoneNote({ text, error, onClose }: { text: string; error: boolean; onClose: () => void }) {
  return (
    <button
      type="button"
      role="status"
      onClick={onClose}
      title="Close"
      className={`absolute top-7 left-0 z-20 w-56 rounded-lg px-2.5 py-1.5 text-left text-xs shadow-md ring-1 ${
        error ? "bg-red-50 text-danger ring-red-200" : "bg-white text-ink ring-border"
      }`}
    >
      {text}
    </button>
  );
}
