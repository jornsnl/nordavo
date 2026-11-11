import "server-only";
import type { Json } from "@/lib/database.types";
import { amsterdamDate, check, clip, personName, recordUrl, resolveLabels, type LinkableType, type McpDb } from "@/lib/mcp/shared";
import type { WorkStatus, WorkTaskRow } from "@/lib/work/database";
import { localInputToUtc } from "@/lib/work/time";

/**
 * Work tasks for the portal MCP (list_tasks, create_task, update_task_status).
 * The db is the secret key client scoped to the token owner's modules
 * (module-scope.ts, which also filters work_task_links on record type); which
 * tasks the owner may open is decided by work_api_record_tasks and the work_*
 * write functions with p_actor = the token owner.
 */

const ZONE = "Europe/Amsterdam";

/** Start of a day (YYYY-MM-DD) in Amsterdam, as UTC. */
export function amsterdamDayStart(day: string): string {
  return localInputToUtc(`${day}T00:00`, ZONE)!;
}

/** A deadline given as a day: 17:00 Amsterdam time, as the portal tasks moved to Work. */
export function amsterdamDueAt(day: string): string {
  return localInputToUtc(`${day}T17:00`, ZONE)!;
}

/** UTC timestamp to its calendar day in Amsterdam. */
export function amsterdamDay(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(iso),
  );
}

export type TaskListFilters = {
  mine: boolean;
  status: "open" | "todo" | "in_progress" | "review" | "done" | "cancelled" | "all";
  due?: "overdue" | "today" | "week" | "none";
  entity_type?: LinkableType;
  entity_id?: string;
  workspace_id?: string;
  project_id?: string;
  limit: number;
  offset: number;
};

const OPEN: WorkStatus[] = ["todo", "in_progress", "review"];

export async function listWorkTasks(db: McpDb, userId: string, siteUrl: string, f: TaskListFilters) {
  const today = amsterdamDate();
  const now = new Date();
  let dueFrom: string | null = null;
  let dueTo: string | null = null;
  if (f.due === "overdue") dueTo = now.toISOString();
  if (f.due === "today") {
    dueFrom = amsterdamDayStart(today);
    dueTo = amsterdamDayStart(amsterdamDate(1));
  }
  if (f.due === "week") {
    dueFrom = amsterdamDayStart(today);
    dueTo = amsterdamDayStart(amsterdamDate(8));
  }
  const statuses: WorkStatus[] | null = f.status === "all" ? null : f.status === "open" ? OPEN : [f.status];

  const { data, error } = await db.rpc("work_api_record_tasks", {
    p_user: userId,
    p_assignee: f.mine ? userId : null,
    p_statuses: f.due === "overdue" ? (statuses ?? OPEN).filter((s) => OPEN.includes(s)) : statuses,
    p_due_from: dueFrom,
    p_due_to: dueTo,
    p_no_due: f.due === "none",
    p_entity_type: f.entity_type ?? null,
    p_entity_id: f.entity_id ?? null,
    p_limit: f.limit + 1,
    p_offset: f.offset,
    p_workspace: f.workspace_id ?? null,
    p_project: f.project_id ?? null,
  });
  if (error) throw new Error(`Could not load tasks: ${error.message}`);
  const rows = (data ?? []) as WorkTaskRow[];
  const page = rows.slice(0, f.limit);
  return { today, has_more: rows.length > f.limit, tasks: await shapeWorkTasks(db, page, siteUrl) };
}

/** Owners, reviewer, project and linked record of Work tasks, compact. */
export async function shapeWorkTasks(db: McpDb, rows: WorkTaskRow[], siteUrl: string) {
  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return [];
  const projectIds = [...new Set(rows.map((r) => r.project_id))];
  const workspaceIds = [...new Set(rows.map((r) => r.workspace_id))];
  const [assignees, links, projects, workspaces] = await Promise.all([
    db.from("work_task_assignees").select("task_id, user_id").in("task_id", ids),
    db.from("work_task_links").select("task_id, entity_type, entity_id").in("task_id", ids),
    db.from("work_projects").select("id, name").in("id", projectIds),
    db.from("work_workspaces").select("id, name, kind").in("id", workspaceIds),
  ]);
  const owners = check(assignees, "task owners");
  const linkRows = check(links, "linked records");
  const peopleIds = [...new Set([...owners.map((a) => a.user_id), ...rows.flatMap((r) => (r.reviewer_id ? [r.reviewer_id] : []))])];
  const [people, labels] = await Promise.all([
    peopleIds.length
      ? db.from("profiles").select("id, full_name, email").in("id", peopleIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string | null; email: string | null }[], error: null }),
    resolveLabels(
      db,
      linkRows.map((l) => ({ type: l.entity_type, id: l.entity_id })),
    ),
  ]);
  const names = new Map(check(people, "people").map((p) => [p.id, personName(p)]));
  const projectName = new Map(check(projects, "projects").map((p) => [p.id, p.name]));
  const workspaceOf = new Map(check(workspaces, "workspaces").map((w) => [w.id, w]));
  const linkOf = new Map(linkRows.map((l) => [l.task_id, l]));
  const base = siteUrl.replace(/\/$/, "");
  const now = Date.now();

  return rows.map((t) => {
    const link = linkOf.get(t.id);
    return {
      id: t.id,
      title: t.title,
      description: clip(t.description, 500),
      status: t.status,
      priority: t.priority,
      due_at: t.due_at,
      due_date: t.due_at ? amsterdamDay(t.due_at) : null,
      overdue: Boolean(t.due_at && OPEN.includes(t.status) && new Date(t.due_at).getTime() < now),
      owners: owners.filter((a) => a.task_id === t.id).map((a) => ({ id: a.user_id, name: names.get(a.user_id) ?? null })),
      reviewer: t.reviewer_id ? { id: t.reviewer_id, name: names.get(t.reviewer_id) ?? null } : null,
      workspace: {
        id: t.workspace_id,
        name: workspaceOf.get(t.workspace_id)?.name ?? null,
        kind: workspaceOf.get(t.workspace_id)?.kind ?? "shared",
      },
      project: { id: t.project_id, name: projectName.get(t.project_id) ?? null },
      task_type: t.task_type,
      labels: t.labels,
      start_on: t.start_on,
      estimate_minutes: t.estimate_minutes,
      linked: link
        ? {
            type: link.entity_type,
            id: link.entity_id,
            label: labels.get(`${link.entity_type}:${link.entity_id}`) ?? null,
            url: recordUrl(siteUrl, link.entity_type, link.entity_id),
          }
        : null,
      completed_at: t.completed_at,
      url: `${base}/work/tasks/${t.id}`,
    };
  });
}

type WorkLogRow = {
  id: number;
  task_id: string;
  action: string;
  details: Json;
  created_at: string;
  actor: { full_name: string | null; email: string | null } | null;
};

/** The Work log of some tasks, newest first, for get_activity. */
export async function workTaskActivity(db: McpDb, tasks: { id: string; title: string }[], limit: number) {
  if (tasks.length === 0) return [];
  const rows = check(
    await db
      .from("work_task_activity")
      .select("id, task_id, action, details, created_at, actor:profiles!work_task_activity_actor_id_fkey(full_name, email)")
      .in(
        "task_id",
        tasks.map((t) => t.id),
      )
      .order("created_at", { ascending: false })
      .limit(limit),
    "task activity",
  ) as unknown as WorkLogRow[];
  const titles = new Map(tasks.map((t) => [t.id, t.title]));
  return rows.map((r) => ({
    at: r.created_at,
    type: "task",
    id: r.task_id,
    record: titles.get(r.task_id) ?? null,
    action: r.action,
    summary: `${titles.get(r.task_id) ?? "Task"} ${r.action.replace(/_/g, " ")}`,
    changes: r.details,
    by: personName(r.actor) ?? "system",
  }));
}

/** Work tasks linked to a record: id, title and the old portal task id (for older log rows). */
export async function linkedWorkTasks(db: McpDb, entityType: string, entityId: string) {
  const rows = check(
    await db
      .from("work_task_links")
      .select("task_id, task:work_tasks!work_task_links_task_id_fkey(id, title, external_source, external_id)")
      .eq("entity_type", entityType as LinkableType)
      .eq("entity_id", entityId)
      .limit(100),
    "linked tasks",
  );
  return rows.flatMap((l) => {
    const t = l.task as { id: string; title: string; external_source: string | null; external_id: string | null } | null;
    return t ? [{ id: t.id, title: t.title, oldId: t.external_source === "portal_tasks" ? t.external_id : null }] : [];
  });
}

/** The token owner's inbox project (made the first time), or null. */
export async function inboxProject(db: McpDb, userId: string): Promise<string | null> {
  const { data, error } = await db.rpc("work_ensure_inbox", { p_actor: userId });
  if (error) return null;
  return data ?? null;
}

/** Workspaces and projects the token owner can put tasks in, the inbox first. */
export async function listWorkProjects(db: McpDb, userId: string, siteUrl: string, includeArchived = false) {
  const inbox = await inboxProject(db, userId);
  const { data, error } = await db.rpc("work_api_visible_projects", { p_user: userId });
  if (error) throw new Error(`Could not load projects: ${error.message}`);
  const projects = (data ?? []) as { id: string; workspace_id: string; name: string; visibility: string; archived_at: string | null }[];
  const workspaceIds = [...new Set(projects.map((p) => p.workspace_id))];
  const [workspaces, open] = await Promise.all([
    workspaceIds.length
      ? db.from("work_workspaces").select("id, name, slug, kind, archived_at").in("id", workspaceIds)
      : Promise.resolve({ data: [], error: null }),
    projects.length
      ? db.from("work_tasks").select("project_id").in("project_id", projects.map((p) => p.id)).in("status", OPEN).is("archived_at", null).is("parent_id", null)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const counts = new Map<string, number>();
  for (const row of check(open, "open tasks") as { project_id: string }[]) counts.set(row.project_id, (counts.get(row.project_id) ?? 0) + 1);
  const base = siteUrl.replace(/\/$/, "");
  const rank = { inbox: 0, private: 1, shared: 2 } as const;
  const list = (check(workspaces, "workspaces") as { id: string; name: string; slug: string; kind: keyof typeof rank; archived_at: string | null }[])
    .filter((w) => includeArchived || !w.archived_at)
    .sort((a, b) => rank[a.kind] - rank[b.kind] || a.name.localeCompare(b.name))
    .map((w) => ({
      id: w.id,
      name: w.name,
      kind: w.kind,
      archived: Boolean(w.archived_at),
      url: `${base}/work/w/${w.slug}`,
      projects: projects
        .filter((p) => p.workspace_id === w.id && (includeArchived || !p.archived_at))
        .map((p) => ({
          id: p.id,
          name: p.name,
          is_inbox: p.id === inbox,
          private: p.visibility === "private",
          archived: Boolean(p.archived_at),
          open_tasks: counts.get(p.id) ?? 0,
          url: `${base}/work/projects/${p.id}`,
        })),
    }));
  return { inbox_project_id: inbox, workspaces: list };
}
