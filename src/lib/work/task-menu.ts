import type { WorkPriority, WorkStatus } from "./database";
import { workOption, workPriorities, workStatuses } from "./labels";

/**
 * The actions of one task, shared by every way to open them: the right click
 * menu on desktop, a long press on a card or row, and the ⋯ button. One list,
 * so what they do, their undo and their messages are the same everywhere.
 */

export type TaskMenuTask = {
  id: string;
  title: string;
  status: WorkStatus;
  priority: WorkPriority;
  reviewerId: string | null;
};

export type TaskChange = { kind: "status"; status: WorkStatus } | { kind: "priority"; priority: WorkPriority };

export type TaskMenuAction = { kind: "open" } | { kind: "copy-link" } | { kind: "duplicate" } | TaskChange;

export type TaskMenuEntry = {
  key: string;
  label: string;
  action: TaskMenuAction;
  group: "open" | "status" | "priority" | "more";
  checked?: boolean;
};

const statusLabel = (status: WorkStatus) => workOption(workStatuses, status).label;

export function taskMenuEntries(task: TaskMenuTask): TaskMenuEntry[] {
  const entries: TaskMenuEntry[] = [{ key: "open", label: "Open task", action: { kind: "open" }, group: "open" }];
  const status = (to: WorkStatus, label: string) =>
    entries.push({ key: `status-${to}`, label, action: { kind: "status", status: to }, group: "status" });

  // Only moves that need no comment: going back from Review or Done asks what
  // still needs to happen, which belongs on the task page.
  if (task.status === "todo") status("in_progress", "Start");
  if (task.status === "in_progress") status("todo", "Back to To do");
  if ((task.status === "todo" || task.status === "in_progress") && task.reviewerId) status("review", "Send to review");
  if (task.status !== "done" && task.status !== "cancelled") status("done", "Mark as done");

  for (const option of workPriorities) {
    entries.push({
      key: `priority-${option.value}`,
      label: `Priority: ${option.label}`,
      action: { kind: "priority", priority: option.value },
      group: "priority",
      checked: task.priority === option.value,
    });
  }

  entries.push({ key: "copy-link", label: "Copy link", action: { kind: "copy-link" }, group: "more" });
  entries.push({ key: "duplicate", label: "Duplicate", action: { kind: "duplicate" }, group: "more" });
  return entries;
}

/** The change that takes an applied change back, when the review rules allow it without a comment. */
export function undoFor(before: TaskMenuTask, change: TaskChange): TaskChange | null {
  if (change.kind === "priority") {
    return change.priority === before.priority ? null : { kind: "priority", priority: before.priority };
  }
  if (change.status === before.status) return null;
  const goingBack = (change.status === "review" || change.status === "done") && (before.status === "todo" || before.status === "in_progress");
  return goingBack ? null : { kind: "status", status: before.status };
}

/** The message after a change, e.g. "Moved to In progress." */
export function changeMessage(change: TaskChange): string {
  if (change.kind === "priority") return `Priority set to ${workOption(workPriorities, change.priority).label}.`;
  return change.status === "done" ? "Marked as done." : `Moved to ${statusLabel(change.status)}.`;
}

export function applyChange<T extends TaskMenuTask>(task: T, change: TaskChange): T {
  return change.kind === "priority" ? { ...task, priority: change.priority } : { ...task, status: change.status };
}
