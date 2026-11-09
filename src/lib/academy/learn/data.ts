import "server-only";
import { requireAcademyUser } from "@/lib/academy/auth";
import type { MyTaskRow, PlacementTaskRow } from "@/lib/academy/learn/database";
import { type TaskItem, openTasks } from "@/lib/academy/learn/tasks";
import { createClient } from "@/lib/supabase/server";

// Learner side of the tasks block outside the lesson: the start page and
// the placement page. Reads go through academy_my_tasks() and
// academy_placement_tasks() as the signed-in user.
//
// For the placement page (built by another builder):
//   const tasks = await getPlacementTasks(placementId);   // rows, or
//   <PlacementTasksPanel placementId={id} user={user} />   // ready-made panel
// from src/components/academy/learn/placement-tasks.tsx.

export async function listMyTasks(): Promise<MyTaskRow[]> {
  const user = await requireAcademyUser();
  if (!user.member) return [];
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("academy_my_tasks", { p_block_id: null });
  if (error) throw new Error(`Could not load tasks: ${error.message}`);
  return data ?? [];
}

/** Open tasks of the signed-in user (own and shared), overdue first, then by deadline. */
export async function listMyOpenTasks(): Promise<MyTaskRow[]> {
  return openTasks(await listMyTasks());
}

/**
 * The course tasks of one placement: the shared tasks and the placement-only
 * tasks of its people (whose progress the viewer may follow). Members of the
 * placement and Academy managers; others get an empty list.
 */
export async function getPlacementTasks(placementId: string): Promise<PlacementTaskRow[]> {
  await requireAcademyUser();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("academy_placement_tasks", { p_placement_id: placementId });
  if (error) throw new Error(`Could not load the placement tasks: ${error.message}`);
  return data ?? [];
}

export function myTaskItem(row: MyTaskRow): TaskItem {
  return {
    taskId: row.task_id,
    placementId: row.placement_id,
    title: row.title,
    description: row.description,
    required: row.required,
    shared: row.shared,
    placementLabel: row.placement_label,
    deadlineOffsetDays: row.deadline_offset_days,
    dueAt: row.due_at,
    doneAt: row.done_at,
    doneByName: row.done_by_name,
    canTick: row.can_tick,
    lessonTitle: row.lesson_title,
    link: row.link,
  };
}

export function placementTaskItem(row: PlacementTaskRow, placementId: string): TaskItem {
  return {
    taskId: row.task_id,
    // Shared tasks are ticked for the placement; personal ones by the person.
    placementId: row.shared ? placementId : null,
    title: row.title,
    description: row.description,
    required: row.required,
    shared: row.shared,
    placementLabel: null,
    personName: row.shared ? null : row.person_name,
    deadlineOffsetDays: row.deadline_offset_days,
    dueAt: row.due_at,
    doneAt: row.done_at,
    doneByName: row.done_by_name,
    canTick: row.can_tick,
    lessonTitle: row.lesson_title,
    link: null,
  };
}
