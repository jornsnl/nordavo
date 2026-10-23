import "server-only";
import { requireStaff } from "@/lib/auth";
import type { EntityType, TaskPriority, TaskStatus } from "@/lib/database.types";
import { taskPriorities } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";
import { recordKey, resolveRecords, type RecordLink } from "@/lib/data/search";

export type StaffMember = { id: string; name: string };

/** A task as the UI needs it, with the assignee and the linked record resolved. */
export type TaskItem = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  entityType: EntityType | null;
  entityId: string | null;
  record: RecordLink | null;
  position: number;
  completedAt: string | null;
  createdAt: string;
};

export function isTaskPriority(value: unknown): value is TaskPriority {
  return taskPriorities.some((p) => p.value === value);
}

const TASK_COLUMNS =
  "id, title, description, status, priority, due_date, assignee_id, entity_type, entity_id, position, completed_at, created_at, assignee:profiles!tasks_assignee_id_fkey(full_name, email)";

type TaskRow = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  due_date: string | null;
  assignee_id: string | null;
  entity_type: EntityType | null;
  entity_id: string | null;
  position: number;
  completed_at: string | null;
  created_at: string;
  assignee: { full_name: string | null; email: string | null } | null;
};

async function toTaskItems(rows: TaskRow[], withRecords = true): Promise<TaskItem[]> {
  const refs = rows
    .filter((r) => r.entity_type && r.entity_id)
    .map((r) => ({ type: r.entity_type as string, id: r.entity_id as string }));
  const records = withRecords && refs.length > 0 ? await resolveRecords(refs) : new Map<string, RecordLink>();

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    status: r.status,
    priority: r.priority,
    dueDate: r.due_date,
    assigneeId: r.assignee_id,
    assigneeName: r.assignee?.full_name || r.assignee?.email || null,
    entityType: r.entity_type,
    entityId: r.entity_id,
    record: r.entity_type && r.entity_id ? (records.get(recordKey(r.entity_type, r.entity_id)) ?? null) : null,
    position: r.position,
    completedAt: r.completed_at,
    createdAt: r.created_at,
  }));
}

/** Staff profiles for assignee pickers. */
export async function listStaff(): Promise<StaffMember[]> {
  await requireStaff();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, email")
    .in("role", ["admin", "member"])
    .order("full_name");
  if (error) throw new Error(`Teamleden laden mislukt: ${error.message}`);
  return data.map((p) => ({ id: p.id, name: p.full_name || p.email || "Onbekend" }));
}

/**
 * Tasks for the Taken page: every open task plus the most recently
 * finished ones, so the board's done column stays manageable.
 */
export async function listTasks({
  assigneeId,
  priority,
}: {
  assigneeId?: string;
  priority?: TaskPriority;
}): Promise<TaskItem[]> {
  await requireStaff();
  const supabase = await createClient();

  let open = supabase
    .from("tasks")
    .select(TASK_COLUMNS)
    .neq("status", "done")
    .order("position")
    .order("created_at");
  let done = supabase
    .from("tasks")
    .select(TASK_COLUMNS)
    .eq("status", "done")
    .order("completed_at", { ascending: false })
    .limit(50);

  if (assigneeId) {
    open = open.eq("assignee_id", assigneeId);
    done = done.eq("assignee_id", assigneeId);
  }
  if (priority) {
    open = open.eq("priority", priority);
    done = done.eq("priority", priority);
  }

  const [openResult, doneResult] = await Promise.all([open, done]);
  if (openResult.error) throw new Error(`Taken laden mislukt: ${openResult.error.message}`);
  if (doneResult.error) throw new Error(`Taken laden mislukt: ${doneResult.error.message}`);

  const doneSorted = [...doneResult.data].sort((a, b) => a.position - b.position);
  return toTaskItems([...openResult.data, ...doneSorted]);
}

/** Tasks linked to one record, open ones first. */
export async function listTasksForEntity(entityType: EntityType, entityId: string): Promise<TaskItem[]> {
  await requireStaff();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tasks")
    .select(TASK_COLUMNS)
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("created_at")
    .limit(100);
  if (error) throw new Error(`Taken laden mislukt: ${error.message}`);

  const items = await toTaskItems(data, false);
  return [...items.filter((t) => t.status !== "done"), ...items.filter((t) => t.status === "done")];
}

/** Open tasks of the current user, earliest due date (so overdue) first. */
export async function listMyOpenTasks(limit: number) {
  const user = await requireStaff();
  const supabase = await createClient();
  const { data, error, count } = await supabase
    .from("tasks")
    .select(TASK_COLUMNS, { count: "exact" })
    .eq("assignee_id", user.id)
    .neq("status", "done")
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("created_at")
    .limit(limit);
  if (error) throw new Error(`Taken laden mislukt: ${error.message}`);
  const rank = { high: 0, normal: 1, low: 2 } as const;
  const tasks = (await toTaskItems(data)).sort(
    (a, b) =>
      (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || rank[a.priority] - rank[b.priority],
  );
  return { tasks, total: count ?? data.length };
}
