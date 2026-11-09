import type { TaskListItem } from "@/lib/work/data";
import type { WorkPriority, WorkStatus } from "@/lib/work/database";
import { workOption, workPriorities, workStatuses } from "@/lib/work/labels";
import {
  syncCreateTaskAction,
  syncSetStatusAction,
  syncUpdateTaskAction,
  type SyncCreateTask,
  type SyncResult,
  type SyncTaskFields,
} from "@/app/work/sync-actions";

/**
 * The changes to Work tasks that work offline, how each one changes the
 * device's copy of the task, and how it is sent (the same server actions the
 * pages use online).
 */

export type TaskOp =
  | { op: "task.create"; payload: SyncCreateTask; record: TaskListItem }
  | { op: "task.update"; payload: { taskId: string; fields: SyncTaskFields } }
  | { op: "task.status"; payload: { taskId: string; status: WorkStatus; at: string } };

export function taskIdOf(change: TaskOp): string {
  return change.op === "task.create" ? change.payload.id : change.payload.taskId;
}

/** The device's copy after the change. */
export function applyTaskOp(task: TaskListItem | null, change: TaskOp): TaskListItem | null {
  if (change.op === "task.create") return change.record;
  if (!task) return null;
  if (change.op === "task.status") {
    const { status, at } = change.payload;
    return { ...task, status, completedAt: status === "done" ? at : null, updatedAt: at };
  }
  const { fields } = change.payload;
  return {
    ...task,
    ...(fields.title !== undefined ? { title: fields.title } : {}),
    ...(fields.priority !== undefined ? { priority: fields.priority as WorkPriority } : {}),
    ...(fields.due_at !== undefined ? { dueAt: fields.due_at } : {}),
    updatedAt: new Date().toISOString(),
  };
}

/** For the sync panel: "Start: Call back Bright Fintech". */
export function describeTaskOp(change: TaskOp, title: string): string {
  if (change.op === "task.create") return `New task: ${title}`;
  if (change.op === "task.status") return `${workOption(workStatuses, change.payload.status).label}: ${title}`;
  const fields = change.payload.fields;
  if (fields.priority) return `Priority ${workOption(workPriorities, fields.priority as WorkPriority).label}: ${title}`;
  return `Edit: ${title}`;
}

/** Sends one change. Throws on a network failure; returns { error } when the server refuses. */
export async function sendTaskOp(op: string, payload: unknown): Promise<SyncResult> {
  switch (op) {
    case "task.create":
      return syncCreateTaskAction(payload as SyncCreateTask);
    case "task.update": {
      const { taskId, fields } = payload as { taskId: string; fields: SyncTaskFields };
      return syncUpdateTaskAction(taskId, fields);
    }
    case "task.status": {
      const { taskId, status, at } = payload as { taskId: string; status: WorkStatus; at: string };
      return syncSetStatusAction(taskId, status, at);
    }
    default:
      return { error: "This change cannot be sent any more." };
  }
}
