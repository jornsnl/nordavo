"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  fieldErrorsFrom,
  formValues,
  GENERIC_ERROR,
  type ActionState,
} from "@/lib/action-state";

const entityTypeSchema = z.enum(["client", "vacancy", "candidate", "application", "placement", "company"]);
const statusSchema = z.enum(["todo", "in_progress", "done"]);

const taskSchema = z
  .object({
    id: z.guid().optional(),
    title: z
      .string({ error: "Give the task a title." })
      .min(1, "Give the task a title.")
      .max(200, "Keep the title under 200 characters."),
    description: z.string().max(5000, "The description is too long.").optional(),
    status: statusSchema.default("todo"),
    priority: z.enum(["low", "normal", "high"]).default("normal"),
    due_date: z.iso.date("Choose a valid date.").optional(),
    assignee_id: z.guid("Choose a team member.").optional(),
    entity_type: entityTypeSchema.optional(),
    entity_id: z.guid("Choose a record.").optional(),
  })
  .refine((v) => Boolean(v.entity_type) === Boolean(v.entity_id), {
    message: "Choose a record or remove the link.",
    path: ["entity_id"],
  });

/** Create or update a task from the task form or the quick add on a record. */
export async function saveTask(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireStaff();
  const values = formValues(formData);
  const parsed = taskSchema.safeParse({
    ...values,
    entity_id: values.entity_type ? values.entity_id : undefined,
  });
  if (!parsed.success) {
    return { error: "Check the highlighted fields.", fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  const { id, ...task } = parsed.data;
  const row = {
    title: task.title,
    description: task.description ?? null,
    status: task.status,
    priority: task.priority,
    due_date: task.due_date ?? null,
    assignee_id: task.assignee_id ?? null,
    entity_type: task.entity_type ?? null,
    entity_id: task.entity_id ?? null,
  };

  const supabase = await createClient();
  const { error } = id
    ? await supabase.from("tasks").update(row).eq("id", id)
    : // New tasks go to the bottom of their column on the board.
      await supabase.from("tasks").insert({ ...row, position: Date.now() });

  if (error) return { error: GENERIC_ERROR };
  refresh();
  return { ok: true, message: id ? "Task saved." : "Task added." };
}

/** Tick a task off, or open it again. */
export async function setTaskDone(taskId: string, done: boolean): Promise<ActionState> {
  await requireStaff();
  const id = z.guid().safeParse(taskId);
  if (!id.success) return { error: GENERIC_ERROR };

  const supabase = await createClient();
  const { error } = await supabase
    .from("tasks")
    .update({ status: done ? "done" : "todo" })
    .eq("id", id.data);
  if (error) return { error: GENERIC_ERROR };
  refresh();
  return { ok: true };
}

const moveSchema = z.object({
  id: z.guid(),
  status: statusSchema,
  position: z.number(),
  /** Set when positions in the column ran out of room: renumber in this order. */
  reorder: z.array(z.guid()).max(500).optional(),
});

/** Drag and drop on the board: new status and a fractional position. */
export async function moveTask(input: z.input<typeof moveSchema>): Promise<ActionState> {
  await requireStaff();
  const parsed = moveSchema.safeParse(input);
  if (!parsed.success) return { error: GENERIC_ERROR };
  const { id, status, position, reorder } = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase.from("tasks").update({ status, position }).eq("id", id);
  if (error) return { error: GENERIC_ERROR };

  if (reorder) {
    // Position changes are not written to the activity log, so this stays quiet.
    const results = await Promise.all(
      reorder.map((taskId, index) =>
        supabase
          .from("tasks")
          .update({ position: (index + 1) * 1024 })
          .eq("id", taskId)
          .eq("status", status),
      ),
    );
    if (results.some((r) => r.error)) return { error: GENERIC_ERROR };
  }

  refresh();
  return { ok: true };
}

export async function deleteTask(taskId: string): Promise<ActionState> {
  await requireStaff();
  const id = z.guid().safeParse(taskId);
  if (!id.success) return { error: GENERIC_ERROR };

  const supabase = await createClient();
  const { error } = await supabase.from("tasks").delete().eq("id", id.data);
  if (error) return { error: GENERIC_ERROR };
  refresh();
  return { ok: true, message: "Task deleted." };
}
