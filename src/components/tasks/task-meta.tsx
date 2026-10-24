import Link from "next/link";
import { CalendarDays, Link2, UserRound } from "lucide-react";
import type { TaskItem } from "@/lib/data/tasks";
import { Badge } from "@/components/ui/badge";
import { entityTypes, optionFor, taskPriorities } from "@/lib/labels";
import { formatDate } from "@/lib/format";

/** "Vandaag", "Morgen", "Gisteren" or a date, red when overdue. */
export function DueLabel({ dueDate, today, done }: { dueDate: string | null; today: string; done?: boolean }) {
  if (!dueDate) return null;
  const overdue = !done && dueDate < today;
  const dayMs = 86_400_000;
  const diff = Math.round((Date.parse(dueDate) - Date.parse(today)) / dayMs);
  const text =
    diff === 0 ? "Vandaag" : diff === 1 ? "Morgen" : diff === -1 ? "Gisteren" : formatDate(dueDate);
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs whitespace-nowrap ${
        overdue ? "font-semibold text-danger" : "text-muted"
      }`}
    >
      <CalendarDays className="size-3.5" aria-hidden="true" />
      <span>
        {overdue && <span className="sr-only">Te laat: </span>}
        {text}
      </span>
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: TaskItem["priority"] }) {
  if (priority === "normal") return null;
  const option = optionFor(taskPriorities, priority);
  return <Badge tone={option.tone}>{option.label}</Badge>;
}

export function AssigneeLabel({ name }: { name: string | null }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1 text-xs text-muted">
      <UserRound className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="truncate">{name ?? "Niemand"}</span>
    </span>
  );
}

/** The record a task is linked to, as a small chip that links to it. */
export function RecordChip({ task }: { task: Pick<TaskItem, "entityType" | "record"> }) {
  if (!task.entityType) return null;
  const typeLabel = entityTypes[task.entityType].label;
  const label = task.record?.label ?? "Verwijderd record";
  const content = (
    <>
      <Link2 className="size-3 shrink-0" aria-hidden="true" />
      <span className="truncate">
        <span className="text-muted">{typeLabel}:</span> {label}
      </span>
    </>
  );
  const className =
    "inline-flex max-w-full min-w-0 items-center gap-1 rounded-full bg-surface px-2 py-0.5 text-xs text-brand-800 ring-1 ring-border";
  if (!task.record?.href) return <span className={className}>{content}</span>;
  return (
    <Link
      href={task.record.href}
      className={`${className} transition hover:bg-brand-50 hover:ring-brand-200 active:bg-brand-100 pointer-coarse:py-1 focus-visible:outline-2 focus-visible:outline-brand-500`}
    >
      {content}
    </Link>
  );
}
