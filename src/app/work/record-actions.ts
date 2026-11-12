"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fieldErrorsFrom, formValues, GENERIC_ERROR, type ActionState } from "@/lib/action-state";
import { requireStaff } from "@/lib/auth";
import { entityTypes } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";
import { requireWorkUser } from "@/lib/work/data";
import { workErrorMessage, type WorkActionState } from "@/lib/work/errors";
import { canUseRecordType, isRecordType, type RecordType } from "@/lib/work/records";
import { localInputToUtc } from "@/lib/work/time";

/**
 * Work tasks on portal records: the link on the Work task page, and the
 * tasks block on the detail pages of the portal. The database checks again
 * (work_private.can_link: the team with the module of that record).
 */

const uuid = z.guid();

function revalidateRecord(type: RecordType | null, id: string | null) {
  revalidatePath("/work", "layout");
  revalidatePath("/dashboard");
  if (type && id && type !== "application") revalidatePath(entityTypes[type].href(id));
}

/** Set, change or clear the record of a Work task (the record picker on the task page). */
export async function setTaskRecordAction(taskId: string, _prev: WorkActionState, formData: FormData): Promise<WorkActionState> {
  const user = await requireWorkUser();
  if (!uuid.safeParse(taskId).success) return { error: "Task not found." };
  const values = formValues(formData);
  const type = values.entity_type ?? null;
  const entityId = values.entity_id ?? null;
  if (type !== null && (!isRecordType(type) || !entityId || !uuid.safeParse(entityId).success)) {
    return { error: "Choose a record or remove the link.", fieldErrors: { entity_id: "Choose a record" } };
  }
  if (type !== null && !canUseRecordType(user, type)) {
    return { error: "You cannot link tasks to this kind of record." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("work_set_task_link", {
    p_task: taskId,
    p_entity_type: type,
    p_entity_id: type ? entityId : null,
  });
  if (error) return { error: workErrorMessage(error) };
  revalidateRecord(type, entityId);
  return { ok: true, message: type ? "Record linked." : "Link removed." };
}

const quickTaskSchema = z.object({
  title: z
    .string({ error: "Give the task a title." })
    .min(1, "Give the task a title.")
    .max(300, "Keep the title under 300 characters."),
  assignee_ids: z.array(z.guid("Choose a team member.")).max(20, "Pick at most 20 owners.").default([]),
  due_date: z.iso.date("Choose a valid date.").optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
});

/** Quick add in the tasks block of a detail page: a Work task on this record. */
export async function createRecordTaskAction(
  entityType: string,
  entityId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireStaff();
  if (!isRecordType(entityType) || !uuid.safeParse(entityId).success) return { error: GENERIC_ERROR };
  if (!canUseRecordType(user, entityType)) return { error: "You do not have access to tasks on this record." };

  const parsed = quickTaskSchema.safeParse({
    ...formValues(formData),
    assignee_ids: formData.getAll("assignee_ids").filter((v): v is string => typeof v === "string" && v !== ""),
  });
  if (!parsed.success) {
    return { error: "Check the highlighted fields.", fieldErrors: fieldErrorsFrom(parsed.error) };
  }
  const { title, assignee_ids, due_date, priority } = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase.rpc("work_create_record_task", {
    p_entity_type: entityType,
    p_entity_id: entityId,
    p_title: title,
    p_priority: priority,
    // A deadline picked as a day means the end of the working day, 17:00 for the maker.
    p_due_at: due_date ? localInputToUtc(`${due_date}T17:00`, user.timeZone) : null,
    p_assignees: [...new Set(assignee_ids)],
  });
  if (error) {
    console.error("createRecordTaskAction", error.code, error.message);
    return { error: workErrorMessage(error) };
  }
  revalidateRecord(entityType, entityId);
  return { ok: true, message: "Task added." };
}

/**
 * Tick a Work task off from a list outside the task page, or open it again.
 * An owner, the reviewer or a workspace admin may mark a task as done (the review
 * rule of Work); for anyone else ticking it off sends it to review instead.
 */
export async function toggleTaskDoneAction(taskId: string, done: boolean): Promise<ActionState> {
  await requireWorkUser();
  if (!uuid.safeParse(taskId).success) return { error: GENERIC_ERROR };
  const supabase = await createClient();

  if (!done) {
    const { error } = await supabase.rpc("work_set_status", {
      p_task: taskId,
      p_status: "todo",
      p_comment: "Opened again.",
    });
    if (error) return { error: workErrorMessage(error) };
    revalidatePath("/", "layout");
    return { ok: true };
  }

  const result = await finishTask(supabase, taskId);
  if (typeof result !== "string") return result;
  revalidatePath("/", "layout");
  return result === "done"
    ? { ok: true, message: "Done." }
    : { ok: true, message: "Sent to the reviewer: only an owner or the reviewer can mark it as done." };
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Done when the review rules allow it, otherwise to review. */
async function finishTask(supabase: Supabase, taskId: string): Promise<"done" | "review" | { error: string }> {
  const { error } = await supabase.rpc("work_set_status", { p_task: taskId, p_status: "done" });
  if (!error) return "done";
  if (error.code !== "42501") return { error: workErrorMessage(error) };
  const { error: reviewError } = await supabase.rpc("work_set_status", { p_task: taskId, p_status: "review" });
  if (reviewError) return { error: workErrorMessage(reviewError) };
  return "review";
}

export type BulkDoneResult = { done: number; review: number; failed: number; error?: string };

/**
 * Tick several tasks off at once (the selection in a project list). Each
 * goes through the same rules as one checkbox: done when allowed, otherwise
 * to review. At most 200 at a time.
 */
export async function completeTasksAction(taskIds: string[]): Promise<BulkDoneResult> {
  await requireWorkUser();
  const ids = [...new Set(taskIds)].filter((id) => uuid.safeParse(id).success).slice(0, 200);
  const result: BulkDoneResult = { done: 0, review: 0, failed: 0 };
  if (ids.length === 0) return result;
  const supabase = await createClient();
  for (const id of ids) {
    const outcome = await finishTask(supabase, id);
    if (outcome === "done") result.done++;
    else if (outcome === "review") result.review++;
    else {
      result.failed++;
      result.error ??= outcome.error;
    }
  }
  revalidatePath("/", "layout");
  return result;
}
