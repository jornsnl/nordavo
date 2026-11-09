import Link from "next/link";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { listOverview, requireWorkUser } from "@/lib/work/data";
import { dueState } from "@/lib/work/time";
import { Card, CardHeader } from "@/components/ui/card";
import { DoneCheckbox } from "@/components/work/done-checkbox";
import { DueLabel, PriorityBadge, StatusBadge, priorityBorder } from "@/components/work/task-row";
import { RecordChip } from "@/components/work/task-record";

/**
 * My open Work tasks (assigned to me, any workspace), for the dashboard
 * overview. Tasks on a record show which one, with a link to it.
 * Contract: async Server Component, render inside <Suspense>.
 */
export async function MyTasksWidget({ limit = 6 }: { limit?: number }) {
  const user = await requireWorkUser();
  const all = await listOverview("mine", {});
  const tasks = all.slice(0, limit);
  const total = all.length;
  const overdue = all.filter((t) => dueState(t.dueAt, user.timeZone) === "overdue").length;

  return (
    <Card>
      <CardHeader
        title="My tasks"
        description={
          total === 0
            ? "Nothing open in your name."
            : overdue > 0
              ? `${total} open, ${overdue} of them overdue.`
              : `${total} open.`
        }
        actions={
          <Link
            href="/work"
            className="inline-flex items-center gap-1 rounded-lg text-sm font-semibold text-brand-600 hover:text-brand-800 pointer-coarse:-my-3 pointer-coarse:min-h-11 focus-visible:outline-2 focus-visible:outline-brand-500"
          >
            Open Work
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        }
      />
      {tasks.length === 0 ? (
        <div className="flex flex-col items-center px-5 py-10 text-center">
          <CheckCircle2 className="mb-2 size-6 text-emerald-600" aria-hidden="true" />
          <p className="text-sm text-muted">You have no open tasks. Nice work.</p>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {tasks.map((task) => (
            <li key={task.id} className={`flex items-start gap-3 px-5 py-3 ${priorityBorder(task.priority)}`}>
              <DoneCheckbox taskId={task.id} title={task.title} done={false} />
              <div className="min-w-0 flex-1">
                <Link
                  href={`/work/tasks/${task.id}`}
                  className="text-sm font-medium break-words text-ink hover:text-brand-700 hover:underline focus-visible:outline-2 focus-visible:outline-brand-500"
                >
                  {task.title}
                </Link>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  {task.status !== "todo" && <StatusBadge status={task.status} />}
                  <DueLabel dueAt={task.dueAt} timeZone={user.timeZone} />
                  <PriorityBadge priority={task.priority} quiet />
                  {task.record ? (
                    <RecordChip record={task.record} />
                  ) : (
                    <span className="truncate text-xs text-muted">{task.project.name}</span>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {total > tasks.length && (
        <p className="border-t border-border px-5 py-3 text-xs text-muted">
          And {total - tasks.length} more.{" "}
          <Link href="/work" className="font-medium text-brand-600 hover:underline">
            View them all in Work
          </Link>
        </p>
      )}
    </Card>
  );
}
