import { after, connection, type NextRequest } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  ApiError,
  addComment,
  commentBody,
  createTask,
  createTaskBody,
  getTask,
  listComments,
  listProjects,
  listTasks,
  listTasksQuery,
  listWorkspaces,
  me,
  setStatus,
  statusBody,
  updateTask,
  updateTaskBody,
  type ApiDb,
} from "@/lib/work/api";
import { deliverNotifications } from "@/lib/work/notify";
import { authenticateWorkToken, workAuthMessage, type WorkApiActor } from "@/lib/work/tokens";

/**
 * REST API of the task tool: Authorization: Bearer wrk_... (Work > Settings).
 * Every call acts as the token owner, with exactly their rights.
 *
 *   GET   /api/work/v1                      this overview
 *   GET   /api/work/v1/me                   who am I, my workspaces and roles
 *   GET   /api/work/v1/workspaces
 *   GET   /api/work/v1/projects?workspace=
 *   GET   /api/work/v1/tasks?project=&workspace=&status=&assignee=me&reviewer=me&subtasks=false&limit=&offset=
 *   POST  /api/work/v1/tasks                {project_id, title, description?, priority?, due_at?, reviewer_id?, assignee_ids?, parent_id?, status?}
 *   GET   /api/work/v1/tasks/:id            with subtasks, comments and files
 *   PATCH /api/work/v1/tasks/:id            {title?, description?, priority?, due_at?, reviewer_id?, assignee_ids?}
 *   POST  /api/work/v1/tasks/:id/status     {status, comment?}
 *   GET   /api/work/v1/tasks/:id/comments
 *   POST  /api/work/v1/tasks/:id/comments   {body, mention_ids?}
 */

const ROUTES = [
  "GET /me",
  "GET /workspaces",
  "GET /projects?workspace=",
  "GET /tasks?project=&workspace=&status=&assignee=me&reviewer=me&subtasks=false&limit=&offset=",
  "POST /tasks {project_id, title, description?, priority?, due_at?, reviewer_id?, assignee_ids?, parent_id?, status?}",
  "GET /tasks/:id",
  "PATCH /tasks/:id {title?, description?, priority?, due_at?, reviewer_id?, assignee_ids?}",
  "POST /tasks/:id/status {status, comment?}",
  "GET /tasks/:id/comments",
  "POST /tasks/:id/comments {body, mention_ids?}",
];

type Ctx = { params: Promise<{ path?: string[] }> };

async function handle(request: NextRequest, { params }: Ctx, method: "GET" | "POST" | "PATCH") {
  await connection();
  const db = createAdminClient();
  if (!db) return json(503, { error: "The API is not configured: SUPABASE_SECRET_KEY is missing on the server." });

  const auth = await authenticateWorkToken(request.headers.get("authorization"), db);
  if (!auth.ok) {
    return json(401, { error: workAuthMessage(auth.reason) }, { "WWW-Authenticate": 'Bearer realm="work"' });
  }

  const path = (await params).path ?? [];
  try {
    const result = await route(db, auth.actor, method, path, request);
    if (method !== "GET") {
      after(() => deliverNotifications("instant", db).catch(() => undefined));
    }
    return json(method === "POST" && path.length === 1 ? 201 : 200, result);
  } catch (error) {
    if (error instanceof ApiError) return json(error.status, { error: error.message });
    if (error instanceof z.ZodError) {
      return json(400, { error: "Invalid input", issues: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
    }
    console.error("[work api]", error instanceof Error ? error.message : error);
    return json(500, { error: "Internal error" });
  }
}

async function route(db: ApiDb, actor: WorkApiActor, method: string, path: string[], request: NextRequest) {
  const site = env.siteUrl();
  const query = Object.fromEntries(request.nextUrl.searchParams.entries());
  const body = async () => (await request.json().catch(() => ({}))) as unknown;
  const [resource, id, sub, ...rest] = path;
  if (rest.length) throw new ApiError(404, "Not found");

  if (!resource && method === "GET") return { name: "Work API", version: 1, base: `${site}/api/work/v1`, routes: ROUTES };
  if (resource === "me" && !id && method === "GET") return me(db, actor, site);
  if (resource === "workspaces" && !id && method === "GET") return { workspaces: await listWorkspaces(db, actor) };
  if (resource === "projects" && !id && method === "GET") return { projects: await listProjects(db, actor, query.workspace) };

  if (resource === "tasks") {
    if (!id && method === "GET") return { tasks: await listTasks(db, actor, listTasksQuery.parse(query), site) };
    if (!id && method === "POST") return createTask(db, actor, createTaskBody.parse(await body()), site);
    if (id && !sub && method === "GET") return getTask(db, actor, id, site);
    if (id && !sub && method === "PATCH") return updateTask(db, actor, id, updateTaskBody.parse(await body()), site);
    if (id && sub === "status" && method === "POST") return setStatus(db, actor, id, statusBody.parse(await body()), site);
    if (id && sub === "comments" && method === "GET") return { comments: await listComments(db, actor, id) };
    if (id && sub === "comments" && method === "POST") return addComment(db, actor, id, commentBody.parse(await body()));
  }
  throw new ApiError(404, "Not found. GET /api/work/v1 lists the routes.");
}

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

export function GET(request: NextRequest, ctx: Ctx) {
  return handle(request, ctx, "GET");
}

export function POST(request: NextRequest, ctx: Ctx) {
  return handle(request, ctx, "POST");
}

export function PATCH(request: NextRequest, ctx: Ctx) {
  return handle(request, ctx, "PATCH");
}
