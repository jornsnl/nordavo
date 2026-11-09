"use client";

import { createContext, useCallback, useContext, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  CircleDot,
  Copy,
  ExternalLink,
  Flag,
  Link2,
  MoreHorizontal,
  Play,
  Send,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { duplicateTaskAction, quickStatusAction, updateTaskAction } from "@/app/work/actions";
import { ActionSheet, type ActionItem } from "@/components/ui/action-sheet";
import { toast } from "@/components/ui/toaster";
import { useLongPress } from "@/components/ui/use-long-press";
import {
  changeMessage,
  taskMenuEntries,
  undoFor,
  type TaskChange,
  type TaskMenuAction,
  type TaskMenuTask,
} from "@/lib/work/task-menu";

/** Fired on window when a change is applied (or rolled back), so boards can move a card at once. */
export const TASK_CHANGE_EVENT = "work:task-change";
export type TaskChangeDetail = { id: string; change: TaskChange };

/** Sends one change through the same server actions as the task page. */
export async function sendTaskChange(taskId: string, change: TaskChange): Promise<{ error?: string }> {
  if (change.kind === "status") return quickStatusAction(taskId, change.status);
  const form = new FormData();
  form.set("priority", change.priority);
  return updateTaskAction(taskId, {}, form);
}

/** Applies one change: moves the card, sends it, then a message with Undo (or the refusal). */
export async function applyTaskChange(task: TaskMenuTask, change: TaskChange, isUndo = false): Promise<void> {
  window.dispatchEvent(new CustomEvent<TaskChangeDetail>(TASK_CHANGE_EVENT, { detail: { id: task.id, change } }));
  const result = await sendTaskChange(task.id, change);
  const back = undoFor(task, change);
  if (result.error) {
    // Put the card back where it was, whatever the undo rules say.
    const revert: TaskChange =
      change.kind === "status" ? { kind: "status", status: task.status } : { kind: "priority", priority: task.priority };
    window.dispatchEvent(new CustomEvent<TaskChangeDetail>(TASK_CHANGE_EVENT, { detail: { id: task.id, change: revert } }));
    toast(result.error, { tone: "error" });
    return;
  }
  if (isUndo) {
    toast("Undone.");
    return;
  }
  const after = change.kind === "status" ? { ...task, status: change.status } : { ...task, priority: change.priority };
  toast(changeMessage(change), back ? { action: { label: "Undo", onClick: () => void applyTaskChange(after, back, true) } } : {});
}

type Opened = { task: TaskMenuTask & { subtitle?: string }; anchor: { x: number; y: number } | null };
type Ctx = { open: (task: Opened["task"], anchor?: { x: number; y: number } | null) => void };

const TaskMenuContext = createContext<Ctx | null>(null);

function iconFor(action: TaskMenuAction): LucideIcon {
  switch (action.kind) {
    case "open":
      return ExternalLink;
    case "copy-link":
      return Link2;
    case "duplicate":
      return Copy;
    case "priority":
      return Flag;
    case "status":
      return action.status === "in_progress"
        ? Play
        : action.status === "review"
          ? Send
          : action.status === "done"
            ? CheckCircle2
            : action.status === "todo"
              ? Undo2
              : CircleDot;
  }
}

/** One action menu for every task card and row inside it. Mounted by the shells. */
export function TaskMenuProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [opened, setOpened] = useState<Opened | null>(null);
  const close = useCallback(() => setOpened(null), []);
  const open = useCallback<Ctx["open"]>((task, anchor = null) => setOpened({ task, anchor }), []);


  const run = useCallback(
    (task: TaskMenuTask, action: TaskMenuAction) => {
      switch (action.kind) {
        case "open":
          router.push(`/work/tasks/${task.id}`);
          return;
        case "copy-link":
          navigator.clipboard
            ?.writeText(`${window.location.origin}/work/tasks/${task.id}`)
            .then(() => toast("Link copied."))
            .catch(() => toast("Could not copy the link.", { tone: "error" }));
          return;
        case "duplicate":
          void duplicateTaskAction(task.id).then((result) => result?.error && toast(result.error, { tone: "error" }));
          return;
        default:
          void applyTaskChange(task, action);
      }
    },
    [router],
  );

  const items: ActionItem[] = useMemo(() => {
    if (!opened) return [];
    return taskMenuEntries(opened.task).map((entry) => ({
      key: entry.key,
      label: entry.label,
      group: entry.group,
      checked: entry.checked,
      icon: iconFor(entry.action),
      onSelect: () => run(opened.task, entry.action),
    }));
  }, [opened, run]);

  const ctx = useMemo(() => ({ open }), [open]);
  return (
    <TaskMenuContext.Provider value={ctx}>
      {children}
      <ActionSheet
        open={opened !== null}
        onClose={close}
        title={opened?.task.title ?? ""}
        subtitle={opened?.task.subtitle}
        items={items}
        anchor={opened?.anchor}
      />
    </TaskMenuContext.Provider>
  );
}

/** Opens the actions of a task from code (the board does after a press without a move). */
export function useTaskMenu() {
  return useContext(TaskMenuContext)?.open ?? null;
}

/**
 * Handlers for a card or row: long press (touch) and right click (desktop)
 * open the task's actions. Outside a TaskMenuProvider they do nothing.
 */
export function useTaskMenuTarget(task: TaskMenuTask & { subtitle?: string }) {
  const ctx = useContext(TaskMenuContext);
  const press = useLongPress({
    onLongPress: () => ctx?.open(task),
    onContext: (at) => ctx?.open(task, at),
  });
  return {
    enabled: Boolean(ctx),
    handlers: ctx ? press : {},
    openAt: (anchor: { x: number; y: number } | null) => ctx?.open(task, anchor),
  };
}

/** The ⋯ button on a card or row, for anyone who does not know about long press. */
export function TaskMenuButton({ task, className = "" }: { task: TaskMenuTask & { subtitle?: string }; className?: string }) {
  const { enabled, openAt } = useTaskMenuTarget(task);
  if (!enabled) return null;
  return (
    <button
      type="button"
      aria-label={`Actions for ${task.title}`}
      aria-haspopup="menu"
      onClick={(event: MouseEvent<HTMLButtonElement>) => {
        event.preventDefault();
        event.stopPropagation();
        const rect = event.currentTarget.getBoundingClientRect();
        openAt({ x: rect.left, y: rect.bottom + 4 });
      }}
      className={`relative z-10 flex size-8 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-brand-50 hover:text-ink focus-visible:outline-2 focus-visible:outline-brand-500 pointer-coarse:size-10 ${className}`}
    >
      <MoreHorizontal className="size-4" aria-hidden="true" />
    </button>
  );
}
