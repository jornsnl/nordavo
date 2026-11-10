"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireWorkUser } from "@/lib/work/data";
import { WORK_GENERIC_ERROR, workErrorMessage } from "@/lib/work/errors";
import { deliverNotifications } from "@/lib/work/notify";

/**
 * The writes of Work that also run from the outbox of a phone that was
 * offline (src/lib/offline). The task list, board and action menu use these
 * online too, so a change takes the same path either way: the session check
 * and validation here, then the work_* database functions with their review
 * rules, activity log and notifications.
 *
 * Each returns { error } when the server refuses: the outbox then drops the
 * change and says so. A network failure throws, and the change waits.
 */

export type SyncResult = { ok: true; id?: string } | { error: string };

const id = z.guid({ error: "Not found" });
const title = z.string().trim().min(1, { error: "Add a title" }).max(300, { error: "At most 300 characters" });
const priority = z.enum(["low", "normal", "high", "urgent"]);
const status = z.enum(["todo", "in_progress", "review", "done", "cancelled"]);
const isoTime = z.iso.datetime({ offset: true });
const isoDay = z.iso.date();
const taskType = z.enum(["call", "schedule", "meeting", "teams", "brainstorm", "programming", "design", "writing", "email", "research", "review", "admin"]);

function queuedMail() {
  after(async () => {
    try {
      await deliverNotifications("instant");
    } catch (error) {
      console.error("[work] sending notifications failed:", error instanceof Error ? error.message : error);
    }
  });
}

const createSchema = z.object({
  /** crypto.randomUUID() on the device: sending it twice makes one task. */
  id,
  project_id: id,
  title,
  description: z.string().max(50_000).nullable().optional(),
  priority: priority.default("normal"),
  due_at: isoTime.nullable().optional(),
  assignees: z.array(id).max(50).default([]),
  status: z.enum(["todo", "in_progress", "done"]).default("todo"),
  is_log: z.boolean().default(false),
  /** When it was made on the device (a log finished offline). */
  at: isoTime.optional(),
});

export type SyncCreateTask = z.input<typeof createSchema>;

export async function syncCreateTaskAction(input: SyncCreateTask): Promise<SyncResult> {
  const user = await requireWorkUser();
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? WORK_GENERIC_ERROR };
  const task = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("work_create_task", {
    p_id: task.id,
    p_project: task.project_id,
    p_title: task.title,
    p_description: task.description ?? null,
    p_priority: task.priority,
    p_due_at: task.due_at ?? null,
    p_reviewer: task.is_log ? user.id : null,
    p_assignees: [...new Set(task.assignees)],
    p_status: task.status,
    p_is_log: task.is_log,
    p_at: task.at ?? null,
  });
  if (error || !data) return { error: workErrorMessage(error) };
  queuedMail();
  revalidatePath("/work", "layout");
  return { ok: true, id: data };
}

const updateSchema = z
  .object({
    title: title.optional(),
    description: z.string().max(50_000).nullable().optional(),
    priority: priority.optional(),
    due_at: isoTime.nullable().optional(),
    // Planning (calendar, timeline and the task page).
    start_on: isoDay.nullable().optional(),
    task_type: taskType.nullable().optional(),
    labels: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
    estimate_minutes: z.number().int().min(1).max(60_000).nullable().optional(),
  })
  .strict();

export type SyncTaskFields = z.input<typeof updateSchema>;

/**
 * Only the fields that changed on the device are sent, so a change someone
 * else made to another field in the meantime stays. For the same field, the
 * last one to arrive wins.
 */
export async function syncUpdateTaskAction(taskId: string, fields: SyncTaskFields): Promise<SyncResult> {
  await requireWorkUser();
  const parsedId = id.safeParse(taskId);
  const parsed = updateSchema.safeParse(fields);
  if (!parsedId.success || !parsed.success) return { error: WORK_GENERIC_ERROR };
  if (Object.keys(parsed.data).length === 0) return { ok: true };
  const supabase = await createClient();
  const { error } = await supabase.rpc("work_update_task", { p_task: parsedId.data, p_fields: parsed.data });
  if (error) return { error: workErrorMessage(error) };
  queuedMail();
  revalidatePath("/work", "layout");
  return { ok: true };
}

/** A status change, with when it happened on the device (Done at 10:05 stays 10:05). */
export async function syncSetStatusAction(taskId: string, to: string, at?: string): Promise<SyncResult> {
  await requireWorkUser();
  const parsedId = id.safeParse(taskId);
  const parsedStatus = status.safeParse(to);
  const parsedAt = isoTime.optional().safeParse(at);
  if (!parsedId.success || !parsedStatus.success) return { error: WORK_GENERIC_ERROR };
  const supabase = await createClient();
  const { error } = await supabase.rpc("work_set_status", {
    p_task: parsedId.data,
    p_status: parsedStatus.data,
    // The database keeps it only when recent and not in the future.
    p_at: parsedAt.success ? (parsedAt.data ?? null) : null,
  });
  if (error) return { error: workErrorMessage(error) };
  queuedMail();
  revalidatePath("/work", "layout");
  return { ok: true };
}
