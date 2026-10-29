"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { formValues } from "@/lib/action-state";
import { env } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requireWorkUser } from "@/lib/work/data";
import type { WorkRole, WorkStatus } from "@/lib/work/database";
import { WORK_GENERIC_ERROR, workErrorMessage, type WorkActionState } from "@/lib/work/errors";
import { parseMentions } from "@/lib/work/mentions";
import { deliverNotifications, sendInviteMail } from "@/lib/work/notify";
import { generateInviteToken, generateWorkToken } from "@/lib/work/tokens";
import { commonTimeZones, isValidTimeZone, localInputToUtc } from "@/lib/work/time";

/**
 * Every write of the task tool. Each action checks the session and validates
 * input; the work_* database functions then enforce who may do what.
 * Notifications queued by a write are mailed right after the response.
 */

const WORK_BUCKET = "work";
const MAX_FILE_BYTES = 25 * 1024 * 1024;

function sendQueuedMail() {
  after(async () => {
    try {
      await deliverNotifications("instant");
    } catch (error) {
      console.error("[work] sending notifications failed:", error instanceof Error ? error.message : error);
    }
  });
}

function fieldErrors(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".");
    if (key && !result[key]) result[key] = issue.message;
  }
  return result;
}

function invalid(error: z.ZodError): WorkActionState {
  return { error: "Check the highlighted fields.", fieldErrors: fieldErrors(error) };
}

const id = z.guid({ error: "Not found" });
const title = z.string({ error: "Add a title" }).trim().min(1, { error: "Add a title" }).max(300, { error: "At most 300 characters" });
const description = z.string().max(50_000, { error: "At most 50,000 characters" }).optional();
const priority = z.enum(["low", "normal", "high", "urgent"]).default("normal");
const visibility = z.enum(["open", "private"]).default("open");

function checkbox(formData: FormData, name: string) {
  return formData.get(name) === "on" || formData.get(name) === "true";
}

function ids(formData: FormData, name: string): string[] {
  return [...new Set(formData.getAll(name).filter((v): v is string => typeof v === "string" && z.guid().safeParse(v).success))];
}

/** A datetime-local value in the user's zone to UTC; "" clears it. */
async function deadline(value: string | undefined): Promise<string | null> {
  if (!value) return null;
  const user = await requireWorkUser();
  return localInputToUtc(value, user.timeZone);
}

// ---------------------------------------------------------------------------
// Workspaces
// ---------------------------------------------------------------------------

const workspaceSchema = z.object({
  name: z.string({ error: "Add a name" }).trim().min(1, { error: "Add a name" }).max(80),
  slug: z
    .string({ error: "Add a web address" })
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, { error: "Lowercase letters, digits and dashes only" })
    .max(40),
});

export async function createWorkspaceAction(_prev: WorkActionState, formData: FormData): Promise<WorkActionState> {
  await requireWorkUser();
  const parsed = workspaceSchema.safeParse(formValues(formData));
  if (!parsed.success) return invalid(parsed.error);
  const supabase = await createClient();
  const { error } = await supabase.rpc("work_create_workspace", { p_name: parsed.data.name, p_slug: parsed.data.slug });
  if (error) return { error: workErrorMessage(error) };
  revalidatePath("/work", "layout");
  redirect(`/work/w/${parsed.data.slug}`);
}

export async function renameWorkspaceAction(workspaceId: string, _prev: WorkActionState, formData: FormData): Promise<WorkActionState> {
  await requireWorkUser();
  const parsed = workspaceSchema.pick({ name: true }).safeParse(formValues(formData));
  if (!parsed.success) return invalid(parsed.error);
  const supabase = await createClient();
  const { error } = await supabase.rpc("work_rename_workspace", { p_workspace: workspaceId, p_name: parsed.data.name });
  if (error) return { error: workErrorMessage(error) };
  revalidatePath("/work", "layout");
  return { ok: true, message: "Saved." };
}

const memberSchema = z.object({
  user_id: id,
  role: z.enum(["admin", "member", "guest"], { error: "Pick a role" }),
  access_expires_at: z.string().optional(),
});

export async function setMemberAction(workspaceId: string, _prev: WorkActionState, formData: FormData): Promise<WorkActionState> {
  await requireWorkUser();
  const parsed = memberSchema.safeParse(formValues(formData));
  if (!parsed.success) return invalid(parsed.error);
  const supabase = await createClient();
  const { error } = await supabase.rpc("work_set_member", {
    p_workspace: workspaceId,
    p_user: parsed.data.user_id,
    p_role: parsed.data.role,
    p_access_expires_at: await deadline(parsed.data.access_expires_at),
  });
  if (error) return { error: workErrorMessage(error) };
  revalidatePath("/work", "layout");
  return { ok: true, message: "Saved." };
}

export async function deactivateMemberAction(workspaceId: string, _prev: WorkActionState, formData: FormData): Promise<WorkActionState> {
  await requireWorkUser();
  const parsed = z.object({ user_id: id, transfer_to: id.optional() }).safeParse(formValues(formData));
  if (!parsed.success) return invalid(parsed.error);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("work_deactivate_member", {
    p_workspace: workspaceId,
    p_user: parsed.data.user_id,
    p_transfer_to: parsed.data.transfer_to ?? null,
  });
  if (error) return { error: workErrorMessage(error) };
  revalidatePath("/work", "layout");
  return { ok: true, message: parsed.data.transfer_to ? `Deactivated. ${data ?? 0} open tasks moved.` : "Deactivated." };
}

export async function reactivateMemberAction(workspaceId: string, userId: string) {
  await requireWorkUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("work_reactivate_member", { p_workspace: workspaceId, p_user: userId });
  if (error) return { error: workErrorMessage(error) };
  revalidatePath("/work", "layout");
  return {};
}

// ---------------------------------------------------------------------------
// Invites
// ---------------------------------------------------------------------------

const inviteSchema = z.object({
  email: z.email({ error: "Enter a valid e-mail address" }).transform((v) => v.toLowerCase()),
  full_name: z.string().trim().max(120).optional(),
  role: z.enum(["admin", "member", "guest"], { error: "Pick a role" }),
  project_id: id.optional(),
  access_expires_at: z.string().optional(),
});

export async function inviteAction(
  workspace: { id: string; name: string },
  _prev: WorkActionState,
  formData: FormData,
): Promise<WorkActionState> {
  const user = await requireWorkUser();
  const parsed = inviteSchema.safeParse(formValues(formData));
  if (!parsed.success) return invalid(parsed.error);
  const { email, full_name, role, project_id } = parsed.data;
  if (role === "guest" && !project_id) {
    return { error: "Guests are invited to a project.", fieldErrors: { project_id: "Pick the project" } };
  }

  const { token, hash } = generateInviteToken();
  const supabase = await createClient();
  const { error } = await supabase.rpc("work_create_invite", {
    p_workspace: workspace.id,
    p_project: project_id ?? null,
    p_email: email,
    p_role: role as WorkRole,
    p_access_expires_at: await deadline(parsed.data.access_expires_at),
    p_token_hash: hash,
  });
  if (error) return { error: workErrorMessage(error) };

  const url = `${env.siteUrl().replace(/\/$/, "")}/work/invite/${token}`;

  // The account must exist before Google or a mailed link can sign it in.
  // New accounts start as "external": the task tool only, no Nordavo portal.
  const admin = createAdminClient();
  if (admin) {
    const { data: existing } = await admin.from("profiles").select("id").eq("email", email).maybeSingle();
    if (!existing) {
      const { error: createError } = await admin.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { full_name: full_name || email.split("@")[0] },
      });
      if (createError && createError.code !== "email_exists") {
        console.error("[work] creating invited account failed:", createError.code, createError.message);
      }
    }
  }

  let projectName: string | null = null;
  if (project_id) {
    const { data } = await supabase.from("work_projects").select("name").eq("id", project_id).maybeSingle();
    projectName = data?.name ?? null;
  }
  const mailed = await sendInviteMail({ to: email, inviter: user.name, workspace: workspace.name, project: projectName, url });

  revalidatePath("/work", "layout");
  if (!admin) {
    return {
      ok: true,
      message: `Invite created, but SUPABASE_SECRET_KEY is missing, so no account was made for ${email}. Share this link once that is set up: ${url}`,
    };
  }
  return mailed
    ? { ok: true, message: `Invite sent to ${email}.` }
    : { ok: true, message: `Invite created, but mail is not set up. Send this link to ${email} yourself: ${url}` };
}

export async function revokeInviteAction(inviteId: string) {
  await requireWorkUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("work_revoke_invite", { p_invite: inviteId });
  if (error) return { error: workErrorMessage(error) };
  revalidatePath("/work", "layout");
  return {};
}

export async function acceptInviteAction(tokenHash: string): Promise<WorkActionState> {
  await requireWorkUser();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("work_accept_invite", { p_token_hash: tokenHash });
  if (error || !data?.[0]) return { error: workErrorMessage(error) };
  revalidatePath("/work", "layout");
  const { workspace_slug, project_id } = data[0];
  redirect(project_id ? `/work/projects/${project_id}` : `/work/w/${workspace_slug}`);
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

const projectSchema = z.object({
  name: z.string({ error: "Add a name" }).trim().min(1, { error: "Add a name" }).max(120),
  description: z.string().max(5000).optional(),
  visibility,
});

export async function createProjectAction(workspaceId: string, _prev: WorkActionState, formData: FormData): Promise<WorkActionState> {
  await requireWorkUser();
  const parsed = projectSchema.safeParse(formValues(formData));
  if (!parsed.success) return invalid(parsed.error);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("work_create_project", {
    p_workspace: workspaceId,
    p_name: parsed.data.name,
    p_description: parsed.data.description ?? null,
    p_visibility: parsed.data.visibility,
    p_guests_see_assigned_only: checkbox(formData, "guests_see_assigned_only"),
  });
  if (error || !data) return { error: workErrorMessage(error) };
  revalidatePath("/work", "layout");
  redirect(`/work/projects/${data}`);
}

export async function updateProjectAction(projectId: string, _prev: WorkActionState, formData: FormData): Promise<WorkActionState> {
  await requireWorkUser();
  const parsed = projectSchema.safeParse(formValues(formData));
  if (!parsed.success) return invalid(parsed.error);
  const supabase = await createClient();
  const { error } = await supabase.rpc("work_update_project", {
    p_project: projectId,
    p_name: parsed.data.name,
    p_description: parsed.data.description ?? null,
    p_visibility: parsed.data.visibility,
    p_guests_see_assigned_only: checkbox(formData, "guests_see_assigned_only"),
    p_archived: checkbox(formData, "archived"),
  });
  if (error) return { error: workErrorMessage(error) };
  revalidatePath("/work", "layout");
  return { ok: true, message: "Saved." };
}

export async function addProjectMemberAction(projectId: string, _prev: WorkActionState, formData: FormData): Promise<WorkActionState> {
  await requireWorkUser();
  const parsed = z.object({ user_id: id, access_expires_at: z.string().optional() }).safeParse(formValues(formData));
  if (!parsed.success) return { error: "Pick a person.", fieldErrors: fieldErrors(parsed.error) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("work_add_project_member", {
    p_project: projectId,
    p_user: parsed.data.user_id,
    p_access_expires_at: await deadline(parsed.data.access_expires_at),
  });
  if (error) return { error: workErrorMessage(error) };
  sendQueuedMail();
  revalidatePath("/work", "layout");
  return { ok: true, message: "Added." };
}

export async function removeProjectMemberAction(projectId: string, userId: string) {
  await requireWorkUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("work_remove_project_member", { p_project: projectId, p_user: userId });
  if (error) return { error: workErrorMessage(error) };
  revalidatePath("/work", "layout");
  return {};
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

const taskSchema = z.object({
  title,
  description,
  priority,
  due_at: z.string().optional(),
  reviewer_id: id.optional(),
  parent_id: id.optional(),
});

export async function createTaskAction(projectId: string, _prev: WorkActionState, formData: FormData): Promise<WorkActionState> {
  await requireWorkUser();
  const parsed = taskSchema.safeParse(formValues(formData));
  if (!parsed.success) return invalid(parsed.error);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("work_create_task", {
    p_project: projectId,
    p_title: parsed.data.title,
    p_description: parsed.data.description ?? null,
    p_priority: parsed.data.priority,
    p_due_at: await deadline(parsed.data.due_at),
    p_reviewer: parsed.data.reviewer_id ?? null,
    p_assignees: ids(formData, "assignees"),
    p_parent: parsed.data.parent_id ?? null,
  });
  if (error || !data) return { error: workErrorMessage(error) };
  sendQueuedMail();
  revalidatePath("/work", "layout");
  if (parsed.data.parent_id) return { ok: true, message: "Subtask added." };
  redirect(`/work/tasks/${data}`);
}

export async function updateTaskAction(taskId: string, _prev: WorkActionState, formData: FormData): Promise<WorkActionState> {
  await requireWorkUser();
  const values = formValues(formData);
  const parsed = taskSchema.partial().safeParse(values);
  if (!parsed.success) return invalid(parsed.error);

  // Only the fields this form sent change.
  const fields: Record<string, string | null> = {};
  if (formData.has("title")) fields.title = parsed.data.title ?? "";
  if (formData.has("description")) fields.description = parsed.data.description ?? null;
  if (formData.has("priority")) fields.priority = parsed.data.priority ?? "normal";
  if (formData.has("due_at")) fields.due_at = await deadline(parsed.data.due_at);
  if (formData.has("reviewer_id")) fields.reviewer_id = parsed.data.reviewer_id ?? null;

  const supabase = await createClient();
  const { error } = await supabase.rpc("work_update_task", { p_task: taskId, p_fields: fields });
  if (error) return { error: workErrorMessage(error) };

  if (formData.has("assignees_present")) {
    const { error: assignError } = await supabase.rpc("work_set_assignees", { p_task: taskId, p_users: ids(formData, "assignees") });
    if (assignError) return { error: workErrorMessage(assignError) };
  }
  sendQueuedMail();
  revalidatePath("/work", "layout");
  return { ok: true, message: "Saved." };
}

const statusSchema = z.object({
  status: z.enum(["todo", "in_progress", "review", "done", "cancelled"]),
  comment: z.string().max(20_000).optional(),
});

export async function setStatusAction(taskId: string, _prev: WorkActionState, formData: FormData): Promise<WorkActionState> {
  await requireWorkUser();
  const parsed = statusSchema.safeParse(formValues(formData));
  if (!parsed.success) return { error: WORK_GENERIC_ERROR };
  const supabase = await createClient();
  const { error } = await supabase.rpc("work_set_status", {
    p_task: taskId,
    p_status: parsed.data.status as WorkStatus,
    p_comment: parsed.data.comment ?? null,
  });
  if (error) return { error: workErrorMessage(error) };
  sendQueuedMail();
  revalidatePath("/work", "layout");
  return { ok: true };
}

/** One-click status change from a list (no comment). */
export async function quickStatusAction(taskId: string, status: WorkStatus) {
  await requireWorkUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("work_set_status", { p_task: taskId, p_status: status });
  if (error) return { error: workErrorMessage(error) };
  sendQueuedMail();
  revalidatePath("/work", "layout");
  return { ok: true };
}

export async function addCommentAction(taskId: string, _prev: WorkActionState, formData: FormData): Promise<WorkActionState> {
  await requireWorkUser();
  const parsed = z
    .object({ body: z.string({ error: "Write a comment first" }).trim().min(1, { error: "Write a comment first" }).max(20_000) })
    .safeParse(formValues(formData));
  if (!parsed.success) return invalid(parsed.error);
  const supabase = await createClient();
  const { error } = await supabase.rpc("work_add_comment", {
    p_task: taskId,
    p_body: parsed.data.body,
    p_mentions: parseMentions(parsed.data.body),
  });
  if (error) return { error: workErrorMessage(error) };
  sendQueuedMail();
  revalidatePath(`/work/tasks/${taskId}`);
  return { ok: true };
}

export async function moveTaskAction(taskId: string, _prev: WorkActionState, formData: FormData): Promise<WorkActionState> {
  await requireWorkUser();
  const parsed = z.object({ project_id: id }).safeParse(formValues(formData));
  if (!parsed.success) return { error: "Pick a project." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("work_move_task", { p_task: taskId, p_project: parsed.data.project_id });
  if (error) return { error: workErrorMessage(error) };
  revalidatePath("/work", "layout");
  return { ok: true, message: "Moved." };
}

export async function duplicateTaskAction(taskId: string) {
  await requireWorkUser();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("work_duplicate_task", { p_task: taskId });
  if (error || !data) return { error: workErrorMessage(error) };
  revalidatePath("/work", "layout");
  redirect(`/work/tasks/${data}`);
}

export async function archiveTaskAction(taskId: string, projectId: string) {
  await requireWorkUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("work_archive_task", { p_task: taskId });
  if (error) return { error: workErrorMessage(error) };
  revalidatePath("/work", "layout");
  redirect(`/work/projects/${projectId}`);
}

export async function restoreTaskAction(taskId: string) {
  await requireWorkUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("work_restore_task", { p_task: taskId });
  if (error) return { error: workErrorMessage(error) };
  revalidatePath("/work", "layout");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

export async function uploadFileAction(taskId: string, _prev: WorkActionState, formData: FormData): Promise<WorkActionState> {
  await requireWorkUser();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Pick a file." };
  if (file.size > MAX_FILE_BYTES) return { error: "Files can be at most 25 MB." };

  const safeName = file.name
    .normalize("NFKD")
    .replace(/[^\w.\-]+/g, "-")
    .replace(/-+/g, "-")
    .slice(-120) || "file";
  const path = `task/${taskId}/${crypto.randomUUID().slice(0, 8)}-${safeName}`;

  const supabase = await createClient();
  // Storage RLS lets the upload through only for tasks this user can open.
  const { error: uploadError } = await supabase.storage
    .from(WORK_BUCKET)
    .upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });
  if (uploadError) {
    console.error("[work] upload failed:", uploadError.message);
    return { error: "The file could not be uploaded." };
  }
  const { error } = await supabase.rpc("work_add_attachment", {
    p_task: taskId,
    p_path: path,
    p_file_name: file.name.slice(0, 255) || safeName,
    p_mime_type: file.type || null,
    p_size_bytes: file.size,
  });
  if (error) {
    await supabase.storage.from(WORK_BUCKET).remove([path]);
    return { error: workErrorMessage(error) };
  }
  revalidatePath(`/work/tasks/${taskId}`);
  return { ok: true, message: "File added." };
}

export async function removeFileAction(attachmentId: string, taskId: string) {
  await requireWorkUser();
  const supabase = await createClient();
  const { data: file } = await supabase.from("work_attachments").select("storage_path").eq("id", attachmentId).maybeSingle();
  if (!file) return { error: "File not found." };
  // Remove the object first: its policy checks the attachment row.
  const { error: storageError } = await supabase.storage.from(WORK_BUCKET).remove([file.storage_path]);
  if (storageError) return { error: "The file could not be removed." };
  const { error } = await supabase.rpc("work_remove_attachment", { p_attachment: attachmentId });
  if (error) return { error: workErrorMessage(error) };
  revalidatePath(`/work/tasks/${taskId}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Quick log: finished work in one step
// ---------------------------------------------------------------------------

export async function quickLogAction(_prev: WorkActionState, formData: FormData): Promise<WorkActionState> {
  const user = await requireWorkUser();
  const parsed = z
    .object({ project_id: id, title, description, done_at: z.string().optional() })
    .safeParse(formValues(formData));
  if (!parsed.success) return invalid(parsed.error);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("work_create_task", {
    p_project: parsed.data.project_id,
    p_title: parsed.data.title,
    p_description: parsed.data.description ?? null,
    p_due_at: await deadline(parsed.data.done_at),
    p_reviewer: user.id,
    p_assignees: [user.id],
    p_status: "done",
    p_is_log: true,
  });
  if (error || !data) return { error: workErrorMessage(error) };
  revalidatePath("/work", "layout");
  return { ok: true, message: `Logged "${parsed.data.title}".` };
}

// ---------------------------------------------------------------------------
// Personal settings
// ---------------------------------------------------------------------------

export async function updateMySettingsAction(_prev: WorkActionState, formData: FormData): Promise<WorkActionState> {
  const user = await requireWorkUser();
  const parsed = z
    .object({
      full_name: z.string({ error: "Add your name" }).trim().min(2, { error: "Add your name" }).max(120),
      time_zone: z.string().refine((v) => commonTimeZones.includes(v) || isValidTimeZone(v), { error: "Unknown time zone" }),
    })
    .safeParse(formValues(formData));
  if (!parsed.success) return invalid(parsed.error);
  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ full_name: parsed.data.full_name, time_zone: parsed.data.time_zone })
    .eq("id", user.id);
  if (error) return { error: WORK_GENERIC_ERROR };
  revalidatePath("/work", "layout");
  return { ok: true, message: "Saved." };
}

const deliveryChoice = z.enum(["instant", "digest", "off"]);

export async function saveNotificationPrefsAction(_prev: WorkActionState, formData: FormData): Promise<WorkActionState> {
  const user = await requireWorkUser();
  const prefs: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("pref_") || typeof value !== "string") continue;
    const choice = deliveryChoice.safeParse(value);
    if (choice.success) prefs[key.slice(5)] = choice.data;
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("work_notification_prefs")
    .upsert({ user_id: user.id, prefs, updated_at: new Date().toISOString() });
  if (error) return { error: WORK_GENERIC_ERROR };
  revalidatePath("/work/settings");
  return { ok: true, message: "Saved." };
}

export async function createApiTokenAction(_prev: WorkActionState & { token?: string }, formData: FormData) {
  const user = await requireWorkUser();
  const parsed = z
    .object({
      name: z.string({ error: "Name the token" }).trim().min(1, { error: "Name the token" }).max(80),
      access: z.enum(["read", "write"]).default("read"),
      expires_in_days: z.coerce.number().int().min(0).max(365).default(90),
    })
    .safeParse(formValues(formData));
  if (!parsed.success) return invalid(parsed.error);
  const { token, hash, prefix } = generateWorkToken();
  const supabase = await createClient();
  const { error } = await supabase.from("work_api_tokens").insert({
    user_id: user.id,
    name: parsed.data.name,
    token_hash: hash,
    token_prefix: prefix,
    access: parsed.data.access,
    expires_at: parsed.data.expires_in_days
      ? new Date(Date.now() + parsed.data.expires_in_days * 86_400_000).toISOString()
      : null,
  });
  if (error) return { error: WORK_GENERIC_ERROR };
  revalidatePath("/work/settings");
  return { ok: true, message: "Copy the token now; it is shown only once.", token };
}

export async function revokeApiTokenAction(tokenId: string) {
  const user = await requireWorkUser();
  const supabase = await createClient();
  await supabase.from("work_api_tokens").update({ revoked_at: new Date().toISOString() }).eq("id", tokenId).eq("user_id", user.id);
  revalidatePath("/work/settings");
}
