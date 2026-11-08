import Link from "next/link";
import { ArrowUpRight, CheckSquare } from "lucide-react";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Badge } from "@/components/ui/badge";
import { formatDate, todayIso } from "@/lib/format";
import { optionFor, taskPriorities, taskStatuses } from "@/lib/labels";
import type { PortalTask } from "@/lib/work/portal-tasks";

/**
 * Read only list of the staff member's open portal (CRM) tasks inside Work.
 * Each row links to the record the task is about; changes happen in the portal.
 */
export function PortalTaskGroup({ tasks }: { tasks: PortalTask[] }) {
  if (tasks.length === 0) {
    return (
      <EmptyState
        icon={CheckSquare}
        title="No open portal tasks"
        description="Tasks assigned to you in the portal's Tasks module show up here."
      />
    );
  }
  const today = todayIso();
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-xs">
      <header className="flex flex-wrap items-baseline justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
        <h2 className="font-display text-sm font-semibold text-brand-900">Portal tasks</h2>
        <span className="text-xs text-muted">
          Read only here.{" "}
          <Link href="/dashboard/tasks" className="font-medium text-brand-700 underline-offset-4 hover:underline">
            Open Tasks in the portal
          </Link>
        </span>
      </header>
      <ul className="divide-y divide-border">
        {tasks.map((task) => {
          const overdue = task.dueDate !== null && task.dueDate < today;
          const priority = optionFor(taskPriorities, task.priority);
          const status = optionFor(taskStatuses, task.status);
          return (
            <li key={task.id}>
              <Link
                href={task.href}
                className="flex flex-col gap-1.5 px-4 py-3 transition hover:bg-brand-50/50 sm:flex-row sm:items-center sm:justify-between sm:px-5"
              >
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-sm font-medium text-ink">
                    <span className="truncate">{task.title}</span>
                    <ArrowUpRight aria-hidden="true" className="size-3.5 shrink-0 text-muted" />
                  </p>
                  <p className="truncate text-xs text-muted">
                    {task.record ? `${task.record.label}${task.record.sublabel ? ` · ${task.record.sublabel}` : ""}` : "No linked record"}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <Badge tone={status.tone}>{status.label}</Badge>
                  {task.priority !== "normal" && <Badge tone={priority.tone}>{priority.label}</Badge>}
                  <span className={`text-xs ${overdue ? "font-semibold text-danger" : "text-muted"}`}>
                    {task.dueDate ? formatDate(task.dueDate) : "No deadline"}
                  </span>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
