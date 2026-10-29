import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database, Json } from "@/lib/database.types";
import type { WorkStatus, WorkTaskRow } from "@/lib/work/database";
import { parseMentions } from "@/lib/work/mentions";
import type { WorkApiActor } from "@/lib/work/tokens";

/**
 * The task tool's API operations, shared by REST (/api/work/v1) and MCP
 * (/api/work/mcp). They run with the secret key but always for one user:
 * reads go through the work_api_* functions, which apply that user's rights
 * (work_private.can_view_*), and writes through the same work_* functions as
 * the app, with p_actor set to the token owner. There is no other path.
 */

export type ApiDb = SupabaseClient<Database>;

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function fromDb(error: { code?: string; message: string } | null, what: string): never | void {
  if (!error) return;
  if (error.code === "P0002") throw new ApiError(404, error.message);
  if (error.code === "42501") throw new ApiError(403, error.message);
  if (error.code === "P0001") throw new ApiError(422, error.message);
  console.error(`[work api] ${what}:`, error.code, error.message);
  throw new ApiError(500, `${what} failed`);
}

function requireWrite(actor: WorkApiActor) {
  if (actor.access !== "write") throw new ApiError(403, "This token can only read. Create a read and write token in Settings.");
}

const uuid = z.guid();
export const statusSchema = z.enum(["todo", "in_progress", "review", "done", "cancelled"]);
export const prioritySchema = z.enum(["low", "normal", "high", "urgent"]);

/** "me" or a user id. */
function personParam(value: string | null | undefined, actor: WorkApiActor): string | null {
  if (!value) return null;
  if (value === "me") return actor.userId;
  if (!uuid.safeParse(value).success) throw new ApiError(400, "Use a user id or 'me'");
  return value;
}

function idParam(value: string | null | undefined, name: string): string | null {
  if (!value) return null;
  if (!uuid.safeParse(value).success) throw new ApiError(400, `${name} must be an id`);
  return value;
}

async function people(db: ApiDb, actor: WorkApiActor, ids: (string | null)[]) {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return new Map<string, { id: string; name: string; email: string | null }>();
  const { data, error } = await db.rpc("work_api_visible_people", { p_viewer: actor.userId, p_ids: unique });
  fromDb(error, "Loading people");
  return new Map(
    (data ?? []).map((p) => [p.id, { id: p.id, name: p.full_name || p.email?.split("@")[0] || "Someone", email: p.email }]),
  );
}

async function workspacesOf(db: ApiDb, actor: WorkApiActor) {
  const { data, error } = await db
    .from("work_members")
    .select("role, access_expires_at, workspace:work_workspaces!work_members_workspace_id_fkey(id, name, slug)")
    .eq("user_id", actor.userId)
    .is("deactivated_at", null);
  fromDb(error, "Loading workspaces");
  const now = Date.now();
  return (data ?? [])
    .filter((m) => !m.access_expires_at || new Date(m.access_expires_at).getTime() > now)
    .map((m) => ({ ...(m.workspace as { id: string; name: string; slug: string }), role: m.role }));
}

export async function me(db: ApiDb, actor: WorkApiActor, siteUrl: string) {
  return {
    id: actor.userId,
    name: actor.name,
    email: actor.email,
    token_access: actor.access,
    workspaces: await workspacesOf(db, actor),
    app: `${siteUrl.replace(/\/$/, "")}/work`,
    now: new Date().toISOString(),
  };
}

export async function listWorkspaces(db: ApiDb, actor: WorkApiActor) {
  return workspacesOf(db, actor);
}

export async function listProjects(db: ApiDb, actor: WorkApiActor, workspaceId?: string | null) {
  const { data, error } = await db.rpc("work_api_visible_projects", { p_user: actor.userId });
  fromDb(error, "Loading projects");
  const ws = idParam(workspaceId, "workspace");
  return (data ?? [])
    .filter((p) => !ws || p.workspace_id === ws)
    .map((p) => ({
      id: p.id,
      workspace_id: p.workspace_id,
      name: p.name,
      description: p.description,
      visibility: p.visibility,
      archived: Boolean(p.archived_at),
    }));
}

async function shapeTasks(db: ApiDb, actor: WorkApiActor, rows: WorkTaskRow[], siteUrl: string) {
  const ids = rows.map((r) => r.id);
  const projectIds = [...new Set(rows.map((r) => r.project_id))];
  const [{ data: assignees }, { data: projects }] = await Promise.all([
    ids.length ? db.from("work_task_assignees").select("task_id, user_id").in("task_id", ids) : Promise.resolve({ data: [] as { task_id: string; user_id: string }[] }),
    projectIds.length ? db.from("work_projects").select("id, name").in("id", projectIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  const names = await people(db, actor, [...(assignees ?? []).map((a) => a.user_id), ...rows.map((r) => r.reviewer_id), ...rows.map((r) => r.created_by)]);
  const projectName = new Map((projects ?? []).map((p) => [p.id, p.name]));
  const base = siteUrl.replace(/\/$/, "");
  return rows.map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    priority: t.priority,
    due_at: t.due_at,
    workspace_id: t.workspace_id,
    project: { id: t.project_id, name: projectName.get(t.project_id) ?? null },
    parent_id: t.parent_id,
    reviewer: t.reviewer_id ? (names.get(t.reviewer_id) ?? { id: t.reviewer_id }) : null,
    created_by: t.created_by ? (names.get(t.created_by) ?? { id: t.created_by }) : null,
    owners: (assignees ?? []).filter((a) => a.task_id === t.id).map((a) => names.get(a.user_id) ?? { id: a.user_id }),
    created_at: t.created_at,
    updated_at: t.updated_at,
    completed_at: t.completed_at,
    url: `${base}/work/tasks/${t.id}`,
  }));
}

export const listTasksQuery = z.object({
  project: z.string().optional(),
  workspace: z.string().optional(),
  status: statusSchema.optional(),
  assignee: z.string().optional(),
  reviewer: z.string().optional(),
  subtasks: z.enum(["true", "false"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).max(100_000).optional(),
});

export async function listTasks(db: ApiDb, actor: WorkApiActor, query: z.infer<typeof listTasksQuery>, siteUrl: string) {
  const { data, error } = await db.rpc("work_api_list_tasks", {
    p_user: actor.userId,
    p_project: idParam(query.project, "project"),
    p_workspace: idParam(query.workspace, "workspace"),
    p_status: (query.status as WorkStatus | undefined) ?? null,
    p_assignee: personParam(query.assignee, actor),
    p_reviewer: personParam(query.reviewer, actor),
    p_include_subtasks: query.subtasks !== "false",
    p_limit: query.limit ?? 50,
    p_offset: query.offset ?? 0,
  });
  fromDb(error, "Loading tasks");
  return shapeTasks(db, actor, data ?? [], siteUrl);
}

async function requireVisible(db: ApiDb, actor: WorkApiActor, taskId: string) {
  if (!uuid.safeParse(taskId).success) throw new ApiError(404, "Task not found");
  const { data: visible, error } = await db.rpc("work_api_can_view_task", { p_task: taskId, p_user: actor.userId });
  fromDb(error, "Checking access");
  if (!visible) throw new ApiError(404, "Task not found");
}

export async function getTask(db: ApiDb, actor: WorkApiActor, taskId: string, siteUrl: string) {
  await requireVisible(db, actor, taskId);
  const [{ data: task }, { data: children }, { data: files }] = await Promise.all([
    db.from("work_tasks").select("*").eq("id", taskId).single(),
    db.from("work_tasks").select("*").eq("parent_id", taskId).is("archived_at", null).order("position"),
    db.from("work_attachments").select("id, file_name, mime_type, size_bytes, created_at").eq("task_id", taskId),
  ]);
  if (!task) throw new ApiError(404, "Task not found");
  // Subtasks are checked one by one: in "own tasks only" projects a guest may not see them all.
  const visibleChildren: WorkTaskRow[] = [];
  for (const child of children ?? []) {
    const { data: ok } = await db.rpc("work_api_can_view_task", { p_task: child.id, p_user: actor.userId });
    if (ok) visibleChildren.push(child);
  }
  const [shaped] = await shapeTasks(db, actor, [task], siteUrl);
  const base = siteUrl.replace(/\/$/, "");
  return {
    ...shaped,
    description: task.description,
    archived: Boolean(task.archived_at),
    subtasks: await shapeTasks(db, actor, visibleChildren, siteUrl),
    files: (files ?? []).map((f) => ({ ...f, url: `${base}/work/files/${f.id}` })),
    comments: await listComments(db, actor, taskId, { skipCheck: true }),
  };
}

export async function listComments(db: ApiDb, actor: WorkApiActor, taskId: string, { skipCheck = false } = {}) {
  if (!skipCheck) await requireVisible(db, actor, taskId);
  const { data, error } = await db
    .from("work_comments")
    .select("id, body, kind, author_id, created_at")
    .eq("task_id", taskId)
    .order("created_at")
    .limit(500);
  fromDb(error, "Loading comments");
  const names = await people(db, actor, (data ?? []).map((c) => c.author_id));
  return (data ?? []).map((c) => ({
    id: c.id,
    body: c.body,
    kind: c.kind,
    author: c.author_id ? (names.get(c.author_id) ?? { id: c.author_id }) : null,
    created_at: c.created_at,
  }));
}

const isoDate = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), { error: "Use an ISO 8601 date, e.g. 2026-11-03T16:00:00Z" })
  .transform((v) => new Date(v).toISOString());

export const createTaskBody = z.object({
  project_id: uuid,
  title: z.string().trim().min(1).max(300),
  description: z.string().max(50_000).optional(),
  priority: prioritySchema.optional(),
  due_at: isoDate.nullable().optional(),
  reviewer_id: uuid.optional(),
  assignee_ids: z.array(uuid).max(20).optional(),
  parent_id: uuid.optional(),
  status: z.enum(["todo", "in_progress", "done"]).optional(),
});

export async function createTask(db: ApiDb, actor: WorkApiActor, body: z.infer<typeof createTaskBody>, siteUrl: string) {
  requireWrite(actor);
  const { data, error } = await db.rpc("work_create_task", {
    p_project: body.project_id,
    p_title: body.title,
    p_description: body.description ?? null,
    p_priority: body.priority ?? "normal",
    p_due_at: body.due_at ?? null,
    p_reviewer: body.reviewer_id ?? null,
    p_assignees: body.assignee_ids ?? [],
    p_parent: body.parent_id ?? null,
    p_status: body.status ?? "todo",
    p_actor: actor.userId,
  });
  fromDb(error, "Creating the task");
  return getTask(db, actor, data!, siteUrl);
}

export const updateTaskBody = z
  .object({
    title: z.string().trim().min(1).max(300).optional(),
    description: z.string().max(50_000).nullable().optional(),
    priority: prioritySchema.optional(),
    due_at: isoDate.nullable().optional(),
    reviewer_id: uuid.optional(),
    assignee_ids: z.array(uuid).max(20).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { error: "Send at least one field" });

export async function updateTask(db: ApiDb, actor: WorkApiActor, taskId: string, body: z.infer<typeof updateTaskBody>, siteUrl: string) {
  requireWrite(actor);
  await requireVisible(db, actor, taskId);
  const { assignee_ids, ...fields } = body;
  if (Object.keys(fields).length > 0) {
    const { error } = await db.rpc("work_update_task", { p_task: taskId, p_fields: fields as Json, p_actor: actor.userId });
    fromDb(error, "Updating the task");
  }
  if (assignee_ids) {
    const { error } = await db.rpc("work_set_assignees", { p_task: taskId, p_users: assignee_ids, p_actor: actor.userId });
    fromDb(error, "Updating owners");
  }
  return getTask(db, actor, taskId, siteUrl);
}

export const statusBody = z.object({ status: statusSchema, comment: z.string().max(20_000).optional() });

export async function setStatus(db: ApiDb, actor: WorkApiActor, taskId: string, body: z.infer<typeof statusBody>, siteUrl: string) {
  requireWrite(actor);
  await requireVisible(db, actor, taskId);
  const { error } = await db.rpc("work_set_status", {
    p_task: taskId,
    p_status: body.status,
    p_comment: body.comment ?? null,
    p_actor: actor.userId,
  });
  fromDb(error, "Changing the status");
  return getTask(db, actor, taskId, siteUrl);
}

export const commentBody = z.object({ body: z.string().trim().min(1).max(20_000), mention_ids: z.array(uuid).max(20).optional() });

export async function addComment(db: ApiDb, actor: WorkApiActor, taskId: string, body: z.infer<typeof commentBody>) {
  requireWrite(actor);
  await requireVisible(db, actor, taskId);
  const mentions = [...new Set([...(body.mention_ids ?? []), ...parseMentions(body.body)])];
  const { data, error } = await db.rpc("work_add_comment", {
    p_task: taskId,
    p_body: body.body,
    p_mentions: mentions,
    p_actor: actor.userId,
  });
  fromDb(error, "Adding the comment");
  return { id: data };
}
