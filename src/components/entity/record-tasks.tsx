import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { TaskListItem } from "@/lib/work/data";
import type { PrimaryContact } from "@/lib/work/records";
import { DoneCheckbox } from "@/components/work/done-checkbox";
import { DueLabel, People, PriorityBadge, StatusBadge, priorityBorder } from "@/components/work/task-row";
import { PrimaryContactDetails } from "@/components/work/task-record";

/**
 * The Work tasks of one record in the tasks block of a detail page. Each row
 * links to the task in Work; for a lead or client the primary contact is on
 * the row, so you can call or mail without clicking through.
 */
export function RecordTaskRows({
  tasks,
  timeZone,
  contact,
}: {
  tasks: TaskListItem[];
  timeZone: string;
  contact: PrimaryContact | null;
}) {
  if (tasks.length === 0) return <p className="text-sm text-muted">No tasks for this record yet.</p>;
  return (
    <ul className="space-y-2">
      {tasks.map((task) => {
        const finished = task.status === "done" || task.status === "cancelled";
        return (
          <li
            key={task.id}
            className={`flex items-start gap-2.5 rounded-xl border border-border bg-white px-3 py-2.5 ${priorityBorder(task.priority)}`}
          >
            <span className="pt-0.5">
              <DoneCheckbox taskId={task.id} title={task.title} done={task.status === "done"} />
            </span>
            <div className="min-w-0 flex-1">
              <Link
                href={`/work/tasks/${task.id}`}
                className={`group inline-flex max-w-full items-start gap-1 text-sm break-words hover:text-brand-700 hover:underline focus-visible:outline-2 focus-visible:outline-brand-500 ${
                  finished ? "text-muted line-through" : "font-medium text-ink"
                }`}
              >
                <span className="min-w-0">{task.title}</span>
                <ArrowUpRight className="mt-0.5 size-3.5 shrink-0 text-muted" aria-hidden="true" />
                <span className="sr-only">(open in Work)</span>
              </Link>
              {!finished && (
                <>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                    {task.status !== "todo" && <StatusBadge status={task.status} />}
                    <PriorityBadge priority={task.priority} />
                    <DueLabel dueAt={task.dueAt} timeZone={timeZone} />
                    <People people={task.assignees} />
                  </div>
                  {contact && (
                    <div className="mt-1.5 border-t border-dashed border-border pt-1.5">
                      <PrimaryContactDetails contact={contact} compact />
                    </div>
                  )}
                </>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
