import "server-only";
import { isStaff, type CurrentUser } from "@/lib/auth";
import type { EntityType, TaskPriority, TaskStatus } from "@/lib/database.types";
import { recordKey, resolveRecords, type RecordLink } from "@/lib/data/search";
import { createClient } from "@/lib/supabase/server";

/**
 * "One place to look": the open tasks from the portal's CRM Tasks module
 * (public.tasks) assigned to the signed-in staff member, shown read only in
 * Work's My overview. Guests and other non staff accounts get nothing, both
 * here and in the database (public.tasks is staff only under RLS).
 */
export type PortalTask = {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  record: RecordLink | null;
  href: string;
};

export async function listMyPortalTasks(user: CurrentUser): Promise<PortalTask[]> {
  if (!isStaff(user)) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tasks")
    .select("id, title, status, priority, due_date, entity_type, entity_id")
    .eq("assignee_id", user.id)
    .neq("status", "done")
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("created_at")
    .limit(200);
  if (error) throw new Error(`Loading portal tasks failed: ${error.message}`);
  const rows = (data ?? []) as {
    id: string;
    title: string;
    status: TaskStatus;
    priority: TaskPriority;
    due_date: string | null;
    entity_type: EntityType | null;
    entity_id: string | null;
  }[];
  const refs = rows.filter((r) => r.entity_type && r.entity_id).map((r) => ({ type: r.entity_type!, id: r.entity_id! }));
  const records = refs.length > 0 ? await resolveRecords(refs) : new Map<string, RecordLink>();
  return rows.map((r) => {
    const record = r.entity_type && r.entity_id ? (records.get(recordKey(r.entity_type, r.entity_id)) ?? null) : null;
    return {
      id: r.id,
      title: r.title,
      status: r.status,
      priority: r.priority,
      dueDate: r.due_date,
      record,
      href: record?.href ?? "/dashboard/tasks",
    };
  });
}
