import { dayIn } from "@/lib/work/time";

// Grouping of tasks by deadline, as the portal's Tasks page had it, in the
// viewer's time zone. Pure, safe for client components and tests.

export type DueGroupKey = "overdue" | "today" | "week" | "later" | "none";

export const dueGroupLabels: Record<DueGroupKey, string> = {
  overdue: "Overdue",
  today: "Today",
  week: "This week",
  later: "Later",
  none: "No date",
};

const order: DueGroupKey[] = ["overdue", "today", "week", "later", "none"];

function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Overdue: the deadline has passed. Today: later today. This week: up to and
 * including Sunday. Later: after that. No date: no deadline.
 */
export function dueGroup(dueAt: string | null | undefined, timeZone: string, now: Date = new Date()): DueGroupKey {
  if (!dueAt) return "none";
  if (new Date(dueAt).getTime() < now.getTime()) return "overdue";
  const today = dayIn(now, timeZone);
  const day = dayIn(dueAt, timeZone);
  if (day === today) return "today";
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  const endOfWeek = addDays(today, (7 - weekday) % 7);
  return day <= endOfWeek ? "week" : "later";
}

export type DueGroup<T> = { key: DueGroupKey; label: string; tone?: "danger"; tasks: T[] };

/** Non-empty groups in a fixed order; each keeps the order of the input. */
export function groupByDue<T extends { dueAt: string | null }>(
  tasks: T[],
  timeZone: string,
  now: Date = new Date(),
): DueGroup<T>[] {
  const buckets = new Map<DueGroupKey, T[]>();
  for (const task of tasks) {
    const key = dueGroup(task.dueAt, timeZone, now);
    buckets.set(key, [...(buckets.get(key) ?? []), task]);
  }
  return order
    .filter((key) => buckets.has(key))
    .map((key) => ({
      key,
      label: dueGroupLabels[key],
      tone: key === "overdue" ? ("danger" as const) : undefined,
      tasks: buckets.get(key)!,
    }));
}
