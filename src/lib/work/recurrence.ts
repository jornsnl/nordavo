/**
 * Repeating tasks. The rule hangs on the deadline: weekly repeats on its
 * weekday, monthly on its day of the month. The database makes the next task
 * when this one is done (supabase/migrations/20261124600000_work_recurring.sql).
 */

export const recurrenceRules = ["daily", "weekdays", "weekly", "monthly"] as const;
export type Recurrence = (typeof recurrenceRules)[number];

export function isRecurrence(value: unknown): value is Recurrence {
  return typeof value === "string" && (recurrenceRules as readonly string[]).includes(value);
}

const unit: Record<Exclude<Recurrence, "weekdays">, [string, string]> = {
  daily: ["day", "days"],
  weekly: ["week", "weeks"],
  monthly: ["month", "months"],
};

/** "Every workday", "Every week", "Every 2 months". */
export function recurrenceLabel(rule: Recurrence | null, every = 1): string {
  if (!rule) return "Does not repeat";
  if (rule === "weekdays") return "Every workday";
  const [one, many] = unit[rule];
  return every > 1 ? `Every ${every} ${many}` : `Every ${one}`;
}

/** The form's value: rule and interval, both from the form's fields. */
export function parseRecurrence(rule: string | undefined, every: string | undefined): { recurrence: Recurrence | null; every: number } | { error: string } {
  const count = every ? Number(every) : 1;
  if (!Number.isInteger(count) || count < 1 || count > 52) return { error: "Repeat every 1 to 52 days, weeks or months." };
  if (!rule) return { recurrence: null, every: 1 };
  if (!isRecurrence(rule)) return { error: "Choose how the task repeats." };
  return { recurrence: rule, every: rule === "weekdays" ? 1 : count };
}
