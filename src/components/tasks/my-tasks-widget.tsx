import Link from "next/link";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { listMyOpenTasks } from "@/lib/data/tasks";
import { todayIso } from "@/lib/format";
import { Card, CardHeader } from "@/components/ui/card";
import { TaskCheckbox } from "./task-checkbox";
import { DueLabel, PriorityBadge, RecordChip } from "./task-meta";

/**
 * Open tasks assigned to the current user, for the dashboard overview.
 * Contract: async Server Component, render inside <Suspense>.
 */
export async function MyTasksWidget({ limit = 6 }: { limit?: number }) {
  const { tasks, total } = await listMyOpenTasks(limit);
  const today = todayIso();
  const overdue = tasks.filter((t) => t.dueDate && t.dueDate < today).length;

  return (
    <Card>
      <CardHeader
        title="Mijn taken"
        description={
          total === 0
            ? "Niets open op jouw naam."
            : overdue > 0
              ? `${total} open, waarvan ${overdue} te laat.`
              : `${total} open.`
        }
        actions={
          <Link
            href="/dashboard/taken"
            className="inline-flex items-center gap-1 rounded-lg text-sm font-semibold text-brand-600 hover:text-brand-800 focus-visible:outline-2 focus-visible:outline-brand-500"
          >
            Alle taken
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        }
      />
      {tasks.length === 0 ? (
        <div className="flex flex-col items-center px-5 py-10 text-center">
          <CheckCircle2 className="mb-2 size-6 text-emerald-600" aria-hidden="true" />
          <p className="text-sm text-muted">Je hebt geen open taken. Lekker bezig.</p>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {tasks.map((task) => (
            <li key={task.id} className="flex items-start gap-3 px-5 py-3">
              <TaskCheckbox taskId={task.id} title={task.title} done={false} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium break-words text-ink">{task.title}</p>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <DueLabel dueDate={task.dueDate} today={today} />
                  <PriorityBadge priority={task.priority} />
                  <RecordChip task={task} />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {total > tasks.length && (
        <p className="border-t border-border px-5 py-3 text-xs text-muted">
          En nog {total - tasks.length} andere.{" "}
          <Link href="/dashboard/taken" className="font-medium text-brand-600 hover:underline">
            Bekijk ze allemaal
          </Link>
        </p>
      )}
    </Card>
  );
}
