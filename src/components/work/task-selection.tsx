"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import { CheckCheck, X } from "lucide-react";
import { completeTasksAction } from "@/app/work/record-actions";
import { bulkDoneText } from "@/lib/work/bulk";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";

/** Sent by the "x" shortcut (PortalShortcuts) with the task id as detail. */
export const TOGGLE_SELECT_EVENT = "work:toggle-select";

type Ctx = { selected: ReadonlySet<string>; toggle: (id: string) => void };

const SelectionContext = createContext<Ctx | null>(null);

/**
 * Select several tasks in a project list and complete them together
 * (feedback Julius). Rows inside get a square select box next to their round
 * done box; a bar at the bottom completes the selection.
 */
export function TaskSelectionProvider({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [pending, startTransition] = useTransition();

  const toggle = useCallback((id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  useEffect(() => {
    const onToggle = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      if (typeof id === "string") toggle(id);
    };
    window.addEventListener(TOGGLE_SELECT_EVENT, onToggle);
    return () => window.removeEventListener(TOGGLE_SELECT_EVENT, onToggle);
  }, [toggle]);

  const value = useMemo(() => ({ selected, toggle }), [selected, toggle]);

  function completeSelected() {
    const ids = [...selected];
    startTransition(async () => {
      try {
        const result = await completeTasksAction(ids);
        setSelected(new Set());
        toast(result.failed && result.error ? `${bulkDoneText(result)} ${result.error}` : bulkDoneText(result), {
          tone: result.failed ? "error" : "success",
        });
      } catch {
        toast("The tasks could not be completed. Check your connection and try again.", { tone: "error" });
      }
    });
  }

  return (
    <SelectionContext value={value}>
      {children}
      {selected.size > 0 && (
        <div
          role="region"
          aria-label="Selected tasks"
          className="sticky bottom-4 z-20 mt-4 flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-2 pl-4 shadow-lg max-sm:bottom-[calc(4.5rem+env(safe-area-inset-bottom))]"
        >
          <span className="mr-auto text-sm font-medium text-ink" aria-live="polite">
            {selected.size} selected
          </span>
          <Button size="sm" onClick={completeSelected} disabled={pending}>
            <CheckCheck aria-hidden="true" />
            {pending ? "Completing" : "Mark as done"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())} disabled={pending} aria-label="Clear the selection">
            <X aria-hidden="true" />
            Clear
          </Button>
        </div>
      )}
    </SelectionContext>
  );
}

/** The square select box of one row; nothing outside a TaskSelectionProvider. */
export function TaskSelectBox({ taskId, title }: { taskId: string; title: string }) {
  const ctx = useContext(SelectionContext);
  if (!ctx) return null;
  const checked = ctx.selected.has(taskId);
  return (
    <label
      className={`relative z-10 inline-flex size-6 shrink-0 cursor-pointer items-center justify-center pointer-coarse:-m-2.5 pointer-coarse:size-11 ${
        checked ? "" : "sm:opacity-40 sm:group-hover:opacity-100 sm:focus-within:opacity-100"
      }`}
      title="Select for bulk complete (x)"
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={() => ctx.toggle(taskId)}
        aria-label={`Select ${title}`}
        className="size-4 cursor-pointer rounded border-border text-brand-700"
      />
    </label>
  );
}
