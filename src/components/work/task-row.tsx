import Link from "next/link";
import { CalendarClock, CornerDownRight, ListChecks, NotebookPen } from "lucide-react";
import type { TaskListItem } from "@/lib/work/data";
import type { WorkPriority, WorkStatus } from "@/lib/work/database";
import { workOption, workPriorities, workStatuses } from "@/lib/work/labels";
import { dueState, formatDue } from "@/lib/work/time";
import { Badge } from "@/components/ui/badge";
import { initials } from "@/lib/format";

export function StatusBadge({ status }: { status: WorkStatus }) {
  const option = workOption(workStatuses, status);
  return <Badge tone={option.tone}>{option.label}</Badge>;
}

export function PriorityBadge({ priority, quiet = false }: { priority: WorkPriority; quiet?: boolean }) {
  if (quiet && (priority === "normal" || priority === "low")) return null;
  const option = workOption(workPriorities, priority);
  return <Badge tone={option.tone}>{option.label}</Badge>;
}

export function DueLabel({ dueAt, timeZone, done = false }: { dueAt: string | null; timeZone: string; done?: boolean }) {
  if (!dueAt) return null;
  const state = done ? "later" : dueState(dueAt, timeZone);
  const tone =
    state === "overdue" ? "text-danger font-semibold" : state === "today" ? "text-amber-700 font-medium" : "text-muted";
  return (
    <span className={`inline-flex items-center gap-1 text-xs whitespace-nowrap ${tone}`}>
      <CalendarClock className="size-3.5" aria-hidden="true" />
      {state === "overdue" && <span className="sr-only">Overdue: </span>}
      {formatDue(dueAt, timeZone)}
    </span>
  );
}

export function People({ people, max = 3 }: { people: { id: string; name: string }[]; max?: number }) {
  if (people.length === 0) return <span className="text-xs text-muted">No owner</span>;
  const shown = people.slice(0, max);
  return (
    <span className="flex items-center -space-x-1.5" title={people.map((p) => p.name).join(", ")}>
      {shown.map((p) => (
        <span
          key={p.id}
          className="flex size-6 items-center justify-center rounded-full bg-brand-100 text-[10px] font-bold text-brand-700 ring-2 ring-white"
          aria-hidden="true"
        >
          {initials(p.name)}
        </span>
      ))}
      {people.length > max && (
        <span className="flex size-6 items-center justify-center rounded-full bg-slate-100 text-[10px] font-semibold text-slate-600 ring-2 ring-white">
          +{people.length - max}
        </span>
      )}
      <span className="sr-only">Owners: {people.map((p) => p.name).join(", ")}</span>
    </span>
  );
}

/** One task in a list. Always says which workspace and project it belongs to when showContext is on. */
export function TaskRow({
  task,
  timeZone,
  showContext = true,
}: {
  task: TaskListItem;
  timeZone: string;
  showContext?: boolean;
}) {
  const done = task.status === "done" || task.status === "cancelled";
  return (
    <li className="group relative flex flex-col gap-2 px-4 py-3 transition hover:bg-brand-50/50 sm:flex-row sm:items-center sm:gap-4 sm:px-5">
      <div className="min-w-0 flex-1">
        {showContext && (
          <p className="mb-0.5 truncate text-xs text-muted">
            {task.workspace.name} › {task.project.name}
          </p>
        )}
        {task.parentTitle && (
          <p className="mb-0.5 flex items-center gap-1 truncate text-xs text-muted">
            <CornerDownRight className="size-3" aria-hidden="true" />
            {task.parentTitle}
          </p>
        )}
        <Link
          href={`/work/tasks/${task.id}`}
          className={`font-medium after:absolute after:inset-0 focus-visible:outline-none ${
            done ? "text-muted line-through decoration-slate-300" : "text-ink"
          }`}
        >
          {task.isLog && <NotebookPen className="mr-1.5 inline size-3.5 text-muted" aria-label="Logged work" />}
          {task.title}
        </Link>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 sm:shrink-0 sm:justify-end">
        <StatusBadge status={task.status} />
        <PriorityBadge priority={task.priority} quiet />
        {task.subtasks.total > 0 && (
          <span className="inline-flex items-center gap-1 text-xs text-muted" title="Subtasks done">
            <ListChecks className="size-3.5" aria-hidden="true" />
            {task.subtasks.done}/{task.subtasks.total}
          </span>
        )}
        <DueLabel dueAt={task.dueAt} timeZone={timeZone} done={done} />
        <People people={task.assignees} />
      </div>
    </li>
  );
}

export function TaskGroup({
  title,
  description,
  tasks,
  timeZone,
  showContext = true,
  tone,
}: {
  title: string;
  description?: string;
  tasks: TaskListItem[];
  timeZone: string;
  showContext?: boolean;
  tone?: "danger";
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-xs">
      <header className="flex items-baseline justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
        <h2 className={`font-display text-sm font-semibold ${tone === "danger" ? "text-danger" : "text-brand-900"}`}>{title}</h2>
        <span className="text-xs text-muted">
          {description ?? `${tasks.length} task${tasks.length === 1 ? "" : "s"}`}
        </span>
      </header>
      <ul className="divide-y divide-border">
        {tasks.map((task) => (
          <TaskRow key={task.id} task={task} timeZone={timeZone} showContext={showContext} />
        ))}
      </ul>
    </section>
  );
}
