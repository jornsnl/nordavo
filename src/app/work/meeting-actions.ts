"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { formValues } from "@/lib/action-state";
import { createClient } from "@/lib/supabase/server";
import { requireWorkUser } from "@/lib/work/data";
import { WORK_GENERIC_ERROR, workErrorMessage, type WorkActionState } from "@/lib/work/errors";
import { deliverNotifications } from "@/lib/work/notify";
import { localInputToUtc } from "@/lib/work/time";
import type { SyncResult } from "@/app/work/sync-actions";

/**
 * The writes of Meetings. Each action checks the session and the input; the
 * work_* functions of 20261125300000_work_meetings.sql then decide who may
 * do what (who sees a meeting, who adds, who closes).
 */

const id = z.guid({ error: "Not found" });
const name = z.string({ error: "Add a name" }).trim().min(1, { error: "Add a name" }).max(120, { error: "At most 120 characters" });
const visibility = z.enum(["workspace", "invited"]).default("workspace");
const isoTime = z.iso.datetime({ offset: true });

function people(formData: FormData): string[] {
  return [...new Set(formData.getAll("members").filter((v): v is string => typeof v === "string" && z.guid().safeParse(v).success))];
}

function sendQueuedMail() {
  after(async () => {
    try {
      await deliverNotifications("instant");
    } catch (error) {
      console.error("[work] sending notifications failed:", error instanceof Error ? error.message : error);
    }
  });
}

function invalid(error: z.ZodError): WorkActionState {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".");
    if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  return { error: "Check the highlighted fields.", fieldErrors };
}

const meetingSchema = z.object({ workspace_id: id, name, visibility });

export async function createMeetingAction(_prev: WorkActionState, formData: FormData): Promise<WorkActionState> {
  await requireWorkUser();
  const parsed = meetingSchema.safeParse(formValues(formData));
  if (!parsed.success) return invalid(parsed.error);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("work_create_meeting", {
    p_workspace: parsed.data.workspace_id,
    p_name: parsed.data.name,
    p_visibility: parsed.data.visibility,
    p_members: people(formData),
  });
  if (error || !data) return { error: workErrorMessage(error) };
  revalidatePath("/work", "layout");
  redirect(`/work/meetings/${data}`);
}

export async function updateMeetingAction(meetingId: string, _prev: WorkActionState, formData: FormData): Promise<WorkActionState> {
  await requireWorkUser();
  const parsed = meetingSchema.omit({ workspace_id: true }).safeParse(formValues(formData));
  if (!parsed.success) return invalid(parsed.error);
  const supabase = await createClient();
  const { error } = await supabase.rpc("work_update_meeting", {
    p_meeting: meetingId,
    p_name: parsed.data.name,
    p_visibility: parsed.data.visibility,
    p_members: people(formData),
    p_archived: formData.get("archived") === "on",
  });
  if (error) return { error: workErrorMessage(error) };
  revalidatePath("/work", "layout");
  return { ok: true, message: "Saved." };
}

const addSchema = z.object({
  /** crypto.randomUUID() on the device: sending it twice makes one point. */
  id,
  meeting_id: id,
  title: z.string().trim().min(1, { error: "Add a title" }).max(300, { error: "At most 300 characters" }),
  note: z.string().max(5000).nullable().optional(),
  /** When it was written on the device (offline). */
  at: isoTime.optional(),
});

export type SyncAddAgendaItem = z.input<typeof addSchema>;

/** A point on the agenda. Also what the offline outbox sends. */
export async function syncAddAgendaItemAction(input: SyncAddAgendaItem): Promise<SyncResult> {
  await requireWorkUser();
  const parsed = addSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? WORK_GENERIC_ERROR };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("work_add_agenda_item", {
    p_meeting: parsed.data.meeting_id,
    p_title: parsed.data.title,
    p_note: parsed.data.note ?? null,
    p_id: parsed.data.id,
    p_at: parsed.data.at ?? null,
  });
  if (error || !data) return { error: workErrorMessage(error) };
  revalidatePath("/work", "layout");
  return { ok: true, id: data };
}

const itemFields = z
  .object({
    title: z.string().trim().min(1, { error: "Add a title" }).max(300).optional(),
    note: z.string().max(5000).nullable().optional(),
    status: z.enum(["open", "discussed", "dropped"]).optional(),
    decision: z.string().max(5000).nullable().optional(),
  })
  .strict();

export type AgendaItemFields = z.input<typeof itemFields>;

/** Title and note of a point, its status, or what was decided. */
export async function updateAgendaItemAction(itemId: string, fields: AgendaItemFields): Promise<SyncResult> {
  await requireWorkUser();
  const parsedId = id.safeParse(itemId);
  const parsed = itemFields.safeParse(fields);
  if (!parsedId.success || !parsed.success) return { error: parsed.error?.issues[0]?.message ?? WORK_GENERIC_ERROR };
  if (Object.keys(parsed.data).length === 0) return { ok: true };
  const supabase = await createClient();
  const { error } = await supabase.rpc("work_update_agenda_item", { p_item: parsedId.data, p_fields: parsed.data });
  if (error) return { error: workErrorMessage(error) };
  revalidatePath("/work", "layout");
  return { ok: true };
}

const taskSchema = z.object({
  owner_id: id,
  due_at: z.string().optional(),
  title: z.string().trim().max(300).optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
});

/** "Make task": a Work task in the inbox of the owner, linked to the point. */
export async function makeTaskAction(itemId: string, _prev: WorkActionState, formData: FormData): Promise<WorkActionState> {
  const user = await requireWorkUser();
  const parsed = taskSchema.safeParse(formValues(formData));
  if (!parsed.success) return invalid(parsed.error);
  const supabase = await createClient();
  const { error } = await supabase.rpc("work_agenda_item_to_task", {
    p_item: itemId,
    p_owner: parsed.data.owner_id,
    p_due_at: parsed.data.due_at ? localInputToUtc(parsed.data.due_at, user.timeZone) : null,
    p_title: parsed.data.title || null,
    p_priority: parsed.data.priority,
  });
  if (error) return { error: workErrorMessage(error) };
  sendQueuedMail();
  revalidatePath("/work", "layout");
  return { ok: true, message: "Task made." };
}

/** Close the meeting: points that were not discussed move on to the next round. */
export async function closeMeetingAction(meetingId: string): Promise<SyncResult> {
  await requireWorkUser();
  const parsed = id.safeParse(meetingId);
  if (!parsed.success) return { error: WORK_GENERIC_ERROR };
  const supabase = await createClient();
  const { error } = await supabase.rpc("work_close_meeting", { p_meeting: parsed.data });
  if (error) return { error: workErrorMessage(error) };
  revalidatePath("/work", "layout");
  return { ok: true };
}
