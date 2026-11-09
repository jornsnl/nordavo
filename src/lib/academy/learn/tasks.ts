// Tasks block (Academy: takenblok): deadline state, grouping and the task
// input of the editor. Pure, safe for client components, tested in
// tests/academy-learn.test.ts. Who a task applies to and its real deadline
// come from SQL (academy_task_instances, academy_my_tasks).

import type { AcademyLocale } from "@/lib/academy/database";
import { relativeDeadlineLabel } from "@/lib/academy/time";

export type TaskDueState = "done" | "overdue" | "soon" | "open" | "none";

/** Two days before the deadline a task counts as "soon". */
export const SOON_MS = 2 * 24 * 60 * 60 * 1000;

export function taskDueState(dueAt: string | null, doneAt: string | null, now: Date = new Date()): TaskDueState {
  if (doneAt) return "done";
  if (!dueAt) return "none";
  const due = new Date(dueAt).getTime();
  if (due < now.getTime()) return "overdue";
  if (due - now.getTime() <= SOON_MS) return "soon";
  return "open";
}

type Sortable = { due_at: string | null; done_at: string | null; title: string };

/** Open tasks first: overdue, then by deadline (none last), then done. */
export function sortTasks<T extends Sortable>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    if (Boolean(a.done_at) !== Boolean(b.done_at)) return a.done_at ? 1 : -1;
    if (a.due_at !== b.due_at) {
      if (!a.due_at) return 1;
      if (!b.due_at) return -1;
      return new Date(a.due_at).getTime() - new Date(b.due_at).getTime();
    }
    return a.title.localeCompare(b.title);
  });
}

export function openTasks<T extends Sortable>(rows: T[]): T[] {
  return sortTasks(rows.filter((r) => !r.done_at));
}

export function countOverdue(rows: Sortable[], now: Date = new Date()): number {
  return rows.filter((r) => taskDueState(r.due_at, r.done_at, now) === "overdue").length;
}

/** The deadline of a task in the editor and before the start date: "by day 1", "in week 2". */
export function taskDeadlineText(offsetDays: number | null, locale: AcademyLocale): string | null {
  return offsetDays === null || offsetDays === undefined ? null : relativeDeadlineLabel(offsetDays, locale);
}

export type TaskInput = {
  title: string;
  description: string | null;
  deadline_offset_days: number | null;
  shared: boolean;
  placement_only: boolean;
  required: boolean;
};

/**
 * A task from the editor, cleaned: a title of 1 to 500 characters, a
 * deadline offset of -365 to 3650 days or none. Throws on an empty title.
 * A shared task is always ticked within a placement, so it is placement-only too.
 */
export function cleanTaskInput(raw: {
  title?: unknown;
  description?: unknown;
  deadline_offset_days?: unknown;
  shared?: unknown;
  placement_only?: unknown;
  required?: unknown;
}): TaskInput {
  const title = typeof raw.title === "string" ? raw.title.trim().slice(0, 500) : "";
  if (!title) throw new Error("Give the task a title.");
  const description = typeof raw.description === "string" && raw.description.trim() ? raw.description.trim().slice(0, 5000) : null;
  const offsetRaw = raw.deadline_offset_days;
  const offset =
    typeof offsetRaw === "number" ? offsetRaw : typeof offsetRaw === "string" && offsetRaw.trim() !== "" ? Number(offsetRaw) : null;
  const deadline_offset_days =
    offset === null || !Number.isFinite(offset) ? null : Math.round(Math.min(3650, Math.max(-365, offset)));
  const shared = raw.shared === true;
  return {
    title,
    description,
    deadline_offset_days,
    shared,
    placement_only: shared || raw.placement_only === true,
    required: raw.required !== false,
  };
}

/** Quick picks in the editor: offset 0 is day 1 (the start date); "week N" is the end of that week. */
export const DEADLINE_PRESETS: { label: string; offset: number }[] = [
  { label: "Day 1", offset: 0 },
  { label: "Day 3", offset: 2 },
  { label: "Week 1", offset: 6 },
  { label: "Week 2", offset: 13 },
  { label: "Week 4", offset: 27 },
  { label: "Day 30", offset: 29 },
  { label: "Day 90", offset: 89 },
];

/** One task as a list shows it (lesson tasks block, start page, placement page). */
export type TaskItem = {
  taskId: string;
  /** Set for a shared task: ticked for this placement. */
  placementId: string | null;
  title: string;
  description: string | null;
  required: boolean;
  shared: boolean;
  /** "Client · Developer" for a shared task. */
  placementLabel: string | null;
  /** For a placement-only task of someone else on the placement page. */
  personName?: string | null;
  deadlineOffsetDays: number | null;
  dueAt: string | null;
  doneAt: string | null;
  doneByName: string | null;
  canTick: boolean;
  /** Lesson title and link, on the start page. */
  lessonTitle?: string | null;
  link?: string | null;
};
