"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { StaffMember, TaskItem } from "@/lib/data/tasks";
import { optionFor, taskStatuses } from "@/lib/labels";
import { Badge } from "@/components/ui/badge";
import { TaskCheckbox } from "./task-checkbox";
import { TaskModal } from "./task-form";
import { AssigneeLabel, DueLabel, PriorityBadge, RecordChip } from "./task-meta";

export type TaskGroup = { key: string; label: string; tone?: "danger"; tasks: TaskItem[] };

/** The list view of the Taken page, grouped by due date. */
export function TaskList({
  groups,
  done,
  staff,
  currentUserId,
  today,
}: {
  groups: TaskGroup[];
  done: TaskItem[];
  staff: StaffMember[];
  currentUserId: string;
  today: string;
}) {
  const [editing, setEditing] = useState<TaskItem | null>(null);

  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <section key={group.key} aria-labelledby={`group-${group.key}`}>
          <h2
            id={`group-${group.key}`}
            className={`mb-2 flex items-center gap-2 font-display text-sm font-semibold ${
              group.tone === "danger" ? "text-danger" : "text-brand-900"
            }`}
          >
            {group.label}
            <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-muted ring-1 ring-border">
              {group.tasks.length}
            </span>
          </h2>
          <TaskRows tasks={group.tasks} today={today} onEdit={setEditing} />
        </section>
      ))}

      {done.length > 0 && (
        <details className="group">
          <summary className="mb-2 flex w-fit cursor-pointer list-none items-center gap-2 rounded-lg font-display pointer-coarse:min-h-11 text-sm font-semibold text-muted hover:text-brand-900 focus-visible:outline-2 focus-visible:outline-brand-500">
            <ChevronDown className="size-4 transition group-open:rotate-180" aria-hidden="true" />
            Afgerond
            <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium ring-1 ring-border">{done.length}</span>
          </summary>
          <TaskRows tasks={done} today={today} onEdit={setEditing} />
        </details>
      )}

      <TaskModal
        open={editing !== null}
        task={editing}
        staff={staff}
        currentUserId={currentUserId}
        onClose={() => setEditing(null)}
      />
    </div>
  );
}

function TaskRows({
  tasks,
  today,
  onEdit,
}: {
  tasks: TaskItem[];
  today: string;
  onEdit: (task: TaskItem) => void;
}) {
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card shadow-xs">
      {tasks.map((task) => {
        const done = task.status === "done";
        return (
          // The title button stretches over the row, so the whole row opens the task.
          <li key={task.id} className="relative flex items-start gap-3 px-4 py-3 transition hover:bg-brand-50/40 has-[button:active]:bg-brand-50">
            <span className="relative z-10 pt-0.5">
              <TaskCheckbox taskId={task.id} title={task.title} done={done} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <button
                  type="button"
                  onClick={() => onEdit(task)}
                  className={`min-w-0 text-left text-sm font-medium break-words after:absolute after:inset-0 hover:text-brand-600 hover:underline focus-visible:outline-2 focus-visible:outline-brand-500 ${
                    done ? "text-muted line-through" : "text-ink"
                  }`}
                >
                  {task.title}
                </button>
                {task.status === "in_progress" && (
                  <Badge tone={optionFor(taskStatuses, task.status).tone}>
                    {optionFor(taskStatuses, task.status).label}
                  </Badge>
                )}
                <PriorityBadge priority={task.priority} />
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <DueLabel dueDate={task.dueDate} today={today} done={done} />
                <AssigneeLabel name={task.assigneeName} />
                <span className="relative z-10 min-w-0 max-w-full">
                  <RecordChip task={task} />
                </span>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
