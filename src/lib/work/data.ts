import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { getCurrentUser, type CurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type {
  WorkAccessAction,
  WorkPriority,
  WorkRole,
  WorkStatus,
  WorkVisibility,
} from "@/lib/work/database";
import { openStatuses, priorityRank } from "@/lib/work/labels";
import { dayIn, localInputToUtc, safeTimeZone } from "@/lib/work/time";

/**
 * Data access for the task tool. Every query runs as the signed-in user, so
 * RLS decides what comes back; nothing here widens access. Writes live in
 * src/app/work/actions.ts and go through the work_* database functions.
 */

export type WorkUser = CurrentUser;

/** The signed-in user. Any account may open /work; memberships decide what it sees. */
export const requireWorkUser = cache(async (): Promise<WorkUser> => {
  const user = await getCurrentUser();
  return { ...user, timeZone: safeTimeZone(user.timeZone) };
});

export type Person = { id: string; name: string; email: string | null };

function personFrom(p: { id: string; full_name: string | null; email: string | null } | null | undefined): Person | null {
  if (!p) return null;
  return { id: p.id, name: p.full_name || p.email?.split("@")[0] || "Someone", email: p.email };
}

/** Names for a set of user ids, as far as RLS lets this user see them. */
async function peopleById(ids: (string | null | undefined)[]): Promise<Map<string, Person>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  const map = new Map<string, Person>();
  if (unique.length === 0) return map;
  const supabase = await createClient();
  for (let i = 0; i < unique.length; i += 200) {
    const { data } = await supabase.from("profiles").select("id, full_name, email").in("id", unique.slice(i, i + 200));
    for (const row of data ?? []) map.set(row.id, personFrom(row)!);
  }
  return map;
}

function check<T>(result: { data: T; error: { message: string } | null }, what: string): NonNullable<T> {
  if (result.error) throw new Error(`Loading ${what} failed: ${result.error.message}`);
  return (result.data ?? []) as NonNullable<T>;
}

// ---------------------------------------------------------------------------
// Workspaces
// ---------------------------------------------------------------------------

export type WorkspaceItem = { id: string; name: string; slug: string; role: WorkRole };

/** Workspaces the user has active access to, with their role in each. */
export const listMyWorkspaces = cache(async (): Promise<WorkspaceItem[]> => {
  const user = await requireWorkUser();
  const supabase = await createClient();
  const [workspaces, members] = await Promise.all([
    supabase.from("work_workspaces").select("id, name, slug").order("name"),
    supabase.from("work_members").select("workspace_id, role").eq("user_id", user.id).is("deactivated_at", null),
  ]);
  const roles = new Map(check(members, "memberships").map((m) => [m.workspace_id, m.role]));
  return check(workspaces, "workspaces")
    .filter((w) => roles.has(w.id))
    .map((w) => ({ ...w, role: roles.get(w.id)! }));
});

export const getWorkspace = cache(async (slug: string): Promise<WorkspaceItem> => {
  const workspaces = await listMyWorkspaces();
  const workspace = workspaces.find((w) => w.slug === slug);
  if (!workspace) notFound();
  return workspace;
});

export async function requireWorkspaceAdmin(slug: string): Promise<WorkspaceItem> {
  const workspace = await getWorkspace(slug);
  if (workspace.role !== "admin") notFound();
  return workspace;
}

/** Portal admins may start a new workspace. */
export async function canCreateWorkspace() {
  const user = await requireWorkUser();
  return user.role === "admin";
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export type ProjectItem = {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  visibility: WorkVisibility;
  guestsSeeAssignedOnly: boolean;
  archived: boolean;
  createdBy: string | null;
  openTasks: number;
  inReview: number;
  isMember: boolean;
};

export async function listProjects(workspaceId: string, { includeArchived = false } = {}): Promise<ProjectItem[]> {
  const user = await requireWorkUser();
  const supabase = await createClient();
  let query = supabase
    .from("work_projects")
    .select("id, workspace_id, name, description, visibility, guests_see_assigned_only, archived_at, created_by")
    .eq("workspace_id", workspaceId)
    .order("name");
  if (!includeArchived) query = query.is("archived_at", null);
  const [projects, tasks, memberships] = await Promise.all([
    query,
    supabase
      .from("work_tasks")
      .select("project_id, status")
      .eq("workspace_id", workspaceId)
      .is("archived_at", null)
      .is("parent_id", null)
      .in("status", openStatuses),
    supabase.from("work_project_members").select("project_id").eq("user_id", user.id),
  ]);
  const counts = new Map<string, { open: number; review: number }>();
  for (const t of check(tasks, "tasks")) {
    const c = counts.get(t.project_id) ?? { open: 0, review: 0 };
    c.open++;
    if (t.status === "review") c.review++;
    counts.set(t.project_id, c);
  }
  const mine = new Set(check(memberships, "project access").map((m) => m.project_id));
  return check(projects, "projects").map((p) => ({
    id: p.id,
    workspaceId: p.workspace_id,
    name: p.name,
    description: p.description,
    visibility: p.visibility,
    guestsSeeAssignedOnly: p.guests_see_assigned_only,
    archived: Boolean(p.archived_at),
    createdBy: p.created_by,
    openTasks: counts.get(p.id)?.open ?? 0,
    inReview: counts.get(p.id)?.review ?? 0,
    isMember: mine.has(p.id),
  }));
}

export type ProjectDetail = ProjectItem & { workspace: WorkspaceItem; canManage: boolean };

export async function getProject(projectId: string): Promise<ProjectDetail> {
  const user = await requireWorkUser();
  const supabase = await createClient();
  const { data: project } = await supabase
    .from("work_projects")
    .select("id, workspace_id, name, description, visibility, guests_see_assigned_only, archived_at, created_by")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) notFound();
  const workspace = (await listMyWorkspaces()).find((w) => w.id === project.workspace_id);
  if (!workspace) notFound();
  const { data: membership } = await supabase
    .from("work_project_members")
    .select("user_id")
    .eq("project_id", projectId)
    .eq("user_id", user.id)
    .maybeSingle();
  const isMember = Boolean(membership);
  return {
    id: project.id,
    workspaceId: project.workspace_id,
    name: project.name,
    description: project.description,
    visibility: project.visibility,
    guestsSeeAssignedOnly: project.guests_see_assigned_only,
    archived: Boolean(project.archived_at),
    createdBy: project.created_by,
    openTasks: 0,
    inReview: 0,
    isMember,
    workspace,
    canManage: workspace.role === "admin" || (workspace.role === "member" && (isMember || project.created_by === user.id)),
  };
}

/**
 * People who can be owner or reviewer in a project: everyone who can open it.
 * Mirrors work_private.can_view_project; the database checks again on save.
 */
export async function listProjectPeople(projectId: string): Promise<(Person & { role: WorkRole })[]> {
  const project = await getProject(projectId);
  const supabase = await createClient();
  const [members, projectMembers] = await Promise.all([
    supabase
      .from("work_members")
      .select("user_id, role, access_expires_at")
      .eq("workspace_id", project.workspaceId)
      .is("deactivated_at", null),
    supabase.from("work_project_members").select("user_id, access_expires_at").eq("project_id", projectId),
  ]);
  const now = Date.now();
  const active = (expires: string | null) => !expires || new Date(expires).getTime() > now;
  const inProject = new Set(
    check(projectMembers, "project access").filter((m) => active(m.access_expires_at)).map((m) => m.user_id),
  );
  const eligible = check(members, "members").filter(
    (m) =>
      active(m.access_expires_at) &&
      (m.role === "admin" || inProject.has(m.user_id) || (m.role === "member" && project.visibility === "open")),
  );
  const people = await peopleById(eligible.map((m) => m.user_id));
  return eligible
    .map((m) => {
      const person = people.get(m.user_id);
      return person ? { ...person, role: m.role } : null;
    })
    .filter((p): p is Person & { role: WorkRole } => Boolean(p))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Task lists
// ---------------------------------------------------------------------------

export type TaskListItem = {
  id: string;
  title: string;
  status: WorkStatus;
  priority: WorkPriority;
  dueAt: string | null;
  parentId: string | null;
  parentTitle: string | null;
  isLog: boolean;
  reviewerId: string | null;
  createdBy: string | null;
  updatedAt: string;
  completedAt: string | null;
  project: { id: string; name: string };
  workspace: { id: string; name: string; slug: string };
  assignees: Person[];
  subtasks: { total: number; done: number };
};

const LIST_SELECT = `id, title, status, priority, due_at, parent_id, is_log, reviewer_id, created_by, updated_at,
  completed_at, project_id, workspace_id,
  project:work_projects!work_tasks_project_id_workspace_id_fkey(id, name),
  workspace:work_workspaces!work_tasks_workspace_id_fkey(id, name, slug),
  parent:parent_id(id, title),
  assignees:work_task_assignees(user_id),
  subtasks:work_tasks!parent_id(id, status, archived_at)` as const;

type ListRow = {
  id: string;
  title: string;
  status: WorkStatus;
  priority: WorkPriority;
  due_at: string | null;
  parent_id: string | null;
  is_log: boolean;
  reviewer_id: string | null;
  created_by: string | null;
  updated_at: string;
  completed_at: string | null;
  project_id: string;
  workspace_id: string;
  project: { id: string; name: string } | null;
  workspace: { id: string; name: string; slug: string } | null;
  parent: { id: string; title: string } | null;
  assignees: { user_id: string }[];
  subtasks: { id: string; status: WorkStatus; archived_at: string | null }[];
};

async function toListItems(rows: ListRow[]): Promise<TaskListItem[]> {
  const people = await peopleById(rows.flatMap((r) => r.assignees.map((a) => a.user_id)));
  return rows.map((r) => {
    const subtasks = r.subtasks.filter((s) => !s.archived_at && s.id !== r.parent_id);
    return {
      id: r.id,
      title: r.title,
      status: r.status,
      priority: r.priority,
      dueAt: r.due_at,
      parentId: r.parent_id,
      parentTitle: r.parent?.title ?? null,
      isLog: r.is_log,
      reviewerId: r.reviewer_id,
      createdBy: r.created_by,
      updatedAt: r.updated_at,
      completedAt: r.completed_at,
      project: r.project ?? { id: r.project_id, name: "Project" },
      workspace: r.workspace ?? { id: r.workspace_id, name: "Workspace", slug: "" },
      assignees: r.assignees.map((a) => people.get(a.user_id)).filter((p): p is Person => Boolean(p)),
      subtasks: { total: subtasks.length, done: subtasks.filter((s) => s.status === "done").length },
    };
  });
}

export function byDeadline(a: TaskListItem, b: TaskListItem) {
  if (a.dueAt && b.dueAt && a.dueAt !== b.dueAt) return a.dueAt.localeCompare(b.dueAt);
  if (a.dueAt && !b.dueAt) return -1;
  if (!a.dueAt && b.dueAt) return 1;
  return priorityRank[a.priority] - priorityRank[b.priority] || a.title.localeCompare(b.title);
}

export type TaskFilters = {
  workspace?: string;
  project?: string;
  status?: WorkStatus;
  priority?: WorkPriority;
  owner?: string;
};

export type OverviewTab = "mine" | "review" | "today";

/** Mijn overzicht: across every workspace and project the user can open. */
export async function listOverview(tab: OverviewTab, filters: TaskFilters): Promise<TaskListItem[]> {
  const user = await requireWorkUser();
  const supabase = await createClient();

  let query =
    tab === "review"
      ? supabase.from("work_tasks").select(LIST_SELECT).eq("reviewer_id", user.id).eq("status", "review")
      : supabase
          .from("work_tasks")
          .select(`${LIST_SELECT}, mine:work_task_assignees!inner(user_id)`)
          .eq("mine.user_id", user.id);

  query = query.is("archived_at", null);
  if (filters.workspace) query = query.eq("workspace_id", filters.workspace);
  if (filters.project) query = query.eq("project_id", filters.project);
  if (filters.priority) query = query.eq("priority", filters.priority);
  if (tab !== "review") {
    query = filters.status ? query.eq("status", filters.status) : query.in("status", openStatuses);
  }
  if (tab === "today") {
    // Everything due before the end of today in the user's time zone, overdue included.
    const today = dayIn(new Date(), user.timeZone);
    const endOfToday = localInputToUtc(`${today}T23:59`, user.timeZone)!;
    query = query.not("due_at", "is", null).lte("due_at", endOfToday).neq("status", "review");
  }

  const rows = check(await query.limit(500), "tasks") as unknown as ListRow[];
  return (await toListItems(rows)).sort(byDeadline);
}

export async function countReviews(): Promise<number> {
  const user = await requireWorkUser();
  const supabase = await createClient();
  const { count } = await supabase
    .from("work_tasks")
    .select("id", { count: "exact", head: true })
    .eq("reviewer_id", user.id)
    .eq("status", "review")
    .is("archived_at", null);
  return count ?? 0;
}

/** Projectweergave: the top-level tasks of a project. */
export async function listProjectTasks(projectId: string, filters: TaskFilters & { showDone?: boolean }) {
  const supabase = await createClient();
  let query = supabase
    .from("work_tasks")
    .select(filters.owner ? `${LIST_SELECT}, owner:work_task_assignees!inner(user_id)` : LIST_SELECT)
    .eq("project_id", projectId)
    .is("archived_at", null)
    .is("parent_id", null);
  if (filters.owner) query = query.eq("owner.user_id", filters.owner);
  if (filters.priority) query = query.eq("priority", filters.priority);
  if (filters.status) query = query.eq("status", filters.status);
  else if (!filters.showDone) query = query.in("status", openStatuses);
  const rows = check(await query.order("position").limit(1000), "tasks") as unknown as ListRow[];
  return (await toListItems(rows)).sort(byDeadline);
}

export async function searchTasks(q: string): Promise<TaskListItem[]> {
  const supabase = await createClient();
  const { data: hits, error } = await supabase.rpc("work_search", { p_query: q, p_limit: 50 });
  if (error) throw new Error(`Search failed: ${error.message}`);
  const ids = (hits ?? []).map((h) => h.id);
  if (ids.length === 0) return [];
  const rows = check(await supabase.from("work_tasks").select(LIST_SELECT).in("id", ids), "tasks") as unknown as ListRow[];
  const order = new Map(ids.map((id, i) => [id, i]));
  return (await toListItems(rows)).sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

/** The trash of a workspace: archived top-level tasks, newest first. */
export async function listTrash(workspaceId: string): Promise<(TaskListItem & { archivedAt: string })[]> {
  const supabase = await createClient();
  const rows = check(
    await supabase
      .from("work_tasks")
      .select(`${LIST_SELECT}, archived_at`)
      .eq("workspace_id", workspaceId)
      .not("archived_at", "is", null)
      .order("archived_at", { ascending: false })
      .limit(500),
    "trash",
  ) as unknown as (ListRow & { archived_at: string })[];
  // A subtask archived with its parent is restored with it.
  const archivedIds = new Set(rows.map((r) => r.id));
  const shown = rows.filter((r) => !r.parent_id || !archivedIds.has(r.parent_id));
  const items = await toListItems(shown);
  return items.map((item, i) => ({ ...item, archivedAt: shown[i].archived_at }));
}

// ---------------------------------------------------------------------------
// Task detail
// ---------------------------------------------------------------------------

export type CommentItem = { id: string; body: string; kind: "comment" | "returned"; author: Person | null; createdAt: string };
export type AttachmentItem = {
  id: string;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number | null;
  uploadedBy: Person | null;
  createdAt: string;
};
export type ActivityItem = { id: number; action: string; actor: Person | null; details: Record<string, unknown>; createdAt: string };

export type TaskDetail = {
  id: string;
  title: string;
  description: string | null;
  status: WorkStatus;
  priority: WorkPriority;
  dueAt: string | null;
  isLog: boolean;
  archivedAt: string | null;
  completedAt: string | null;
  reviewRequestedAt: string | null;
  createdAt: string;
  project: { id: string; name: string; archived: boolean };
  workspace: WorkspaceItem;
  parent: { id: string; title: string } | null;
  creator: Person | null;
  reviewer: Person | null;
  assignees: Person[];
  subtasks: TaskListItem[];
  comments: CommentItem[];
  attachments: AttachmentItem[];
  activity: ActivityItem[];
  /** What the signed-in user may do; the database enforces the same rules. */
  can: {
    edit: boolean;
    approve: boolean;
    cancel: boolean;
    archive: boolean;
    addSubtask: boolean;
  };
};

export async function getTask(taskId: string): Promise<TaskDetail> {
  const user = await requireWorkUser();
  const supabase = await createClient();
  const { data: task } = await supabase
    .from("work_tasks")
    .select(
      `id, title, description, status, priority, due_at, is_log, archived_at, completed_at, review_requested_at,
       created_at, created_by, reviewer_id, parent_id, project_id, workspace_id,
       project:work_projects!work_tasks_project_id_workspace_id_fkey(id, name, archived_at),
       parent:parent_id(id, title),
       assignees:work_task_assignees(user_id)`,
    )
    .eq("id", taskId)
    .maybeSingle();
  if (!task) notFound();
  const workspace = (await listMyWorkspaces()).find((w) => w.id === task.workspace_id);
  if (!workspace) notFound();

  const [subtaskRows, comments, attachments, activity] = await Promise.all([
    supabase.from("work_tasks").select(LIST_SELECT).eq("parent_id", taskId).is("archived_at", null).order("position"),
    supabase
      .from("work_comments")
      .select("id, body, kind, author_id, created_at")
      .eq("task_id", taskId)
      .order("created_at")
      .limit(500),
    supabase
      .from("work_attachments")
      .select("id, file_name, mime_type, size_bytes, uploaded_by, created_at")
      .eq("task_id", taskId)
      .order("created_at"),
    supabase
      .from("work_task_activity")
      .select("id, action, actor_id, details, created_at")
      .eq("task_id", taskId)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  const commentRows = check(comments, "comments");
  const attachmentRows = check(attachments, "files");
  const activityRows = check(activity, "activity");
  const people = await peopleById([
    task.created_by,
    task.reviewer_id,
    ...task.assignees.map((a) => a.user_id),
    ...commentRows.map((c) => c.author_id),
    ...attachmentRows.map((a) => a.uploaded_by),
    ...activityRows.map((a) => a.actor_id),
    ...activityRows.flatMap((a) => {
      const d = a.details as Record<string, unknown>;
      const ids: string[] = [];
      if (typeof d.user_id === "string") ids.push(d.user_id);
      const reviewer = d.reviewer_id as { to?: unknown; from?: unknown } | undefined;
      if (typeof reviewer?.to === "string") ids.push(reviewer.to);
      return ids;
    }),
  ]);
  const person = (id: string | null) => (id ? (people.get(id) ?? null) : null);

  const isAdmin = workspace.role === "admin";
  const editable = !task.archived_at;
  const project = task.project as { id: string; name: string; archived_at: string | null } | null;

  return {
    id: task.id,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    dueAt: task.due_at,
    isLog: task.is_log,
    archivedAt: task.archived_at,
    completedAt: task.completed_at,
    reviewRequestedAt: task.review_requested_at,
    createdAt: task.created_at,
    project: { id: task.project_id, name: project?.name ?? "Project", archived: Boolean(project?.archived_at) },
    workspace,
    parent: (task.parent as { id: string; title: string } | null) ?? null,
    creator: person(task.created_by),
    reviewer: person(task.reviewer_id),
    assignees: task.assignees.map((a) => person(a.user_id)).filter((p): p is Person => Boolean(p)),
    subtasks: (await toListItems(check(subtaskRows, "subtasks") as unknown as ListRow[])).sort(
      (a, b) => Number(a.status === "done") - Number(b.status === "done"),
    ),
    comments: commentRows.map((c) => ({
      id: c.id,
      body: c.body,
      kind: c.kind,
      author: person(c.author_id),
      createdAt: c.created_at,
    })),
    attachments: attachmentRows.map((a) => ({
      id: a.id,
      fileName: a.file_name,
      mimeType: a.mime_type,
      sizeBytes: a.size_bytes,
      uploadedBy: person(a.uploaded_by),
      createdAt: a.created_at,
    })),
    activity: activityRows.map((a) => ({
      id: a.id,
      action: a.action,
      actor: person(a.actor_id),
      details: (a.details ?? {}) as Record<string, unknown>,
      createdAt: a.created_at,
    })),
    can: {
      edit: editable,
      approve: editable && (isAdmin || task.reviewer_id === user.id),
      cancel: editable && (isAdmin || task.reviewer_id === user.id || task.created_by === user.id),
      archive: editable && (isAdmin || (workspace.role === "member" && task.created_by === user.id)),
      addSubtask: editable && !task.parent_id,
    },
  };
}

/** Names of people for display, e.g. in the activity log. */
export async function namesFor(ids: string[]): Promise<Map<string, Person>> {
  return peopleById(ids);
}

// ---------------------------------------------------------------------------
// Administration
// ---------------------------------------------------------------------------

export type MemberItem = Person & {
  role: WorkRole;
  accessExpiresAt: string | null;
  deactivatedAt: string | null;
  joinedAt: string;
  projects: { id: string; name: string; accessExpiresAt: string | null }[];
};

export async function listMembers(workspaceId: string): Promise<MemberItem[]> {
  const supabase = await createClient();
  const [members, projects] = await Promise.all([
    supabase
      .from("work_members")
      .select("user_id, role, access_expires_at, deactivated_at, created_at")
      .eq("workspace_id", workspaceId),
    supabase
      .from("work_projects")
      .select("id, name, members:work_project_members(user_id, access_expires_at)")
      .eq("workspace_id", workspaceId)
      .order("name"),
  ]);
  const memberRows = check(members, "members");
  const people = await peopleById(memberRows.map((m) => m.user_id));
  const projectRows = check(projects, "projects");
  return memberRows
    .map((m) => {
      const p = people.get(m.user_id) ?? { id: m.user_id, name: "Unknown", email: null };
      return {
        ...p,
        role: m.role,
        accessExpiresAt: m.access_expires_at,
        deactivatedAt: m.deactivated_at,
        joinedAt: m.created_at,
        projects: projectRows
          .filter((pr) => pr.members.some((pm) => pm.user_id === m.user_id))
          .map((pr) => ({
            id: pr.id,
            name: pr.name,
            accessExpiresAt: pr.members.find((pm) => pm.user_id === m.user_id)?.access_expires_at ?? null,
          })),
      };
    })
    .sort((a, b) => Number(Boolean(a.deactivatedAt)) - Number(Boolean(b.deactivatedAt)) || a.name.localeCompare(b.name));
}

export type ProjectMemberItem = Person & { role: WorkRole | null; accessExpiresAt: string | null; addedAt: string };

export async function listProjectMembers(projectId: string, workspaceId: string): Promise<ProjectMemberItem[]> {
  const supabase = await createClient();
  const [rows, members] = await Promise.all([
    supabase.from("work_project_members").select("user_id, access_expires_at, created_at").eq("project_id", projectId),
    supabase.from("work_members").select("user_id, role").eq("workspace_id", workspaceId).is("deactivated_at", null),
  ]);
  const roles = new Map(check(members, "members").map((m) => [m.user_id, m.role]));
  const list = check(rows, "project access");
  const people = await peopleById(list.map((r) => r.user_id));
  return list
    .map((r) => ({
      ...(people.get(r.user_id) ?? { id: r.user_id, name: "Unknown", email: null }),
      role: roles.get(r.user_id) ?? null,
      accessExpiresAt: r.access_expires_at,
      addedAt: r.created_at,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export type InviteItem = {
  id: string;
  email: string;
  role: WorkRole;
  projectName: string | null;
  invitedBy: Person | null;
  createdAt: string;
  expiresAt: string;
  accessExpiresAt: string | null;
};

export async function listOpenInvites(workspaceId: string, projectId?: string): Promise<InviteItem[]> {
  const supabase = await createClient();
  let query = supabase
    .from("work_invites")
    .select("id, email, role, project_id, invited_by, created_at, expires_at, access_expires_at, project:work_projects(name)")
    .eq("workspace_id", workspaceId)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false });
  if (projectId) query = query.eq("project_id", projectId);
  const rows = check(await query, "invites");
  const people = await peopleById(rows.map((r) => r.invited_by));
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    role: r.role,
    projectName: (r.project as { name: string } | null)?.name ?? null,
    invitedBy: r.invited_by ? (people.get(r.invited_by) ?? null) : null,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    accessExpiresAt: r.access_expires_at,
  }));
}

export type AccessLogItem = {
  id: number;
  action: WorkAccessAction;
  role: string | null;
  person: Person | null;
  email: string | null;
  actor: Person | null;
  projectName: string | null;
  details: Record<string, unknown>;
  createdAt: string;
};

export async function listAccessLog(workspaceId: string): Promise<AccessLogItem[]> {
  const supabase = await createClient();
  const rows = check(
    await supabase
      .from("work_access_log")
      .select("id, action, role, user_id, email, actor_id, details, created_at, project:work_projects(name)")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(300),
    "access log",
  );
  const people = await peopleById(rows.flatMap((r) => [r.user_id, r.actor_id]));
  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    role: r.role,
    person: r.user_id ? (people.get(r.user_id) ?? null) : null,
    email: r.email,
    actor: r.actor_id ? (people.get(r.actor_id) ?? null) : null,
    projectName: (r.project as { name: string } | null)?.name ?? null,
    details: (r.details ?? {}) as Record<string, unknown>,
    createdAt: r.created_at,
  }));
}

// ---------------------------------------------------------------------------
// Personal settings
// ---------------------------------------------------------------------------

export async function getNotificationPrefs(): Promise<Record<string, string>> {
  const user = await requireWorkUser();
  const supabase = await createClient();
  const { data } = await supabase.from("work_notification_prefs").select("prefs").eq("user_id", user.id).maybeSingle();
  const prefs = data?.prefs;
  return prefs && typeof prefs === "object" && !Array.isArray(prefs) ? (prefs as Record<string, string>) : {};
}

export async function listApiTokens() {
  const user = await requireWorkUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("work_api_tokens")
    .select("id, name, token_prefix, access, created_at, expires_at, last_used_at, revoked_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Loading tokens failed: ${error.message}`);
  return data;
}
