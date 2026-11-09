import type { WorkPriority, WorkStatus } from "@/lib/work/database";

/**
 * Laying this device's changes over the server's list. Pure, so it is the
 * same on every page and easy to test.
 */

export type OverlayEntry<T> = { id: string; data: T | null; created: boolean };

/** Which tasks a list shows, so a task made or changed here lands in the right list. */
export type TaskView = {
  assignee?: string;
  reviewer?: string;
  projectId?: string;
  workspaceId?: string;
  statuses?: WorkStatus[];
  priority?: WorkPriority;
  /** Logged work only (the quick log list). */
  isLog?: boolean;
  /** Due at or before this moment (Today and overdue). */
  dueBefore?: string;
};

type ViewTask = {
  status: WorkStatus;
  dueAt: string | null;
  priority: WorkPriority;
  reviewerId: string | null;
  isLog: boolean;
  project: { id: string };
  workspace: { id: string };
  assignees: { id: string }[];
};

export function matchesView(task: ViewTask, view: TaskView): boolean {
  if (view.assignee && !task.assignees.some((a) => a.id === view.assignee)) return false;
  if (view.reviewer && task.reviewerId !== view.reviewer) return false;
  if (view.projectId && task.project.id !== view.projectId) return false;
  if (view.workspaceId && task.workspace.id !== view.workspaceId) return false;
  if (view.statuses && !view.statuses.includes(task.status)) return false;
  if (view.priority && task.priority !== view.priority) return false;
  if (view.isLog !== undefined && task.isLog !== view.isLog) return false;
  if (view.dueBefore && (!task.dueAt || new Date(task.dueAt) > new Date(view.dueBefore))) return false;
  return true;
}

/**
 * The server's list with the dirty records laid over it: changed ones
 * replaced (or gone when deleted, or when they no longer fit the view), and
 * the ones made on this device that the server does not list yet added at
 * the end.
 */
export function overlay<T extends { id: string }>(
  server: T[],
  dirty: OverlayEntry<T>[],
  fits: (item: T) => boolean = () => true,
): T[] {
  if (dirty.length === 0) return server;
  const byId = new Map(dirty.map((d) => [d.id, d]));
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of server) {
    seen.add(item.id);
    const local = byId.get(item.id);
    if (!local) {
      result.push(item);
      continue;
    }
    if (local.data && fits(local.data)) result.push(local.data);
  }
  for (const local of dirty) {
    if (local.created && !seen.has(local.id) && local.data && fits(local.data)) result.push(local.data);
  }
  return result;
}
