"use client";

import type { ReactNode } from "react";
import type { TaskListItem } from "@/lib/work/data";
import type { TaskView } from "@/lib/offline/overlay";
import { dueState } from "@/lib/work/time";
import { useOfflineTasks } from "@/components/offline/use-offline-tasks";
import { DueGroups, TaskGroup } from "@/components/work/task-row";
import { TaskBoard } from "@/components/work/task-board";

export type TaskLayout = "due" | "group" | "today" | "board";

/**
 * A task list as this device has it: the server's tasks with the changes
 * made here laid over them, and tasks made here (also offline) added where
 * they belong (`view`). Renders the same groups as before; `empty` when
 * nothing is left.
 */
export function LiveTasks({
  tasks,
  view,
  layout,
  timeZone,
  showContext = true,
  title = "",
  description,
  empty,
}: {
  tasks: TaskListItem[];
  view: TaskView;
  layout: TaskLayout;
  timeZone: string;
  showContext?: boolean;
  /** For layout "group". */
  title?: string;
  description?: string;
  empty: ReactNode;
}) {
  const live = useOfflineTasks(tasks, view);
  if (layout === "board") {
    return live.length === 0 && tasks.length === 0 ? empty : <TaskBoard tasks={tasks} timeZone={timeZone} showContext={showContext} view={view} />;
  }
  if (live.length === 0) return empty;
  if (layout === "due") return <DueGroups tasks={live} timeZone={timeZone} showContext={showContext} />;
  if (layout === "group") return <TaskGroup title={title} description={description} tasks={live} timeZone={timeZone} showContext={showContext} />;
  const overdue = live.filter((t) => dueState(t.dueAt, timeZone) === "overdue");
  const today = live.filter((t) => dueState(t.dueAt, timeZone) !== "overdue");
  return (
    <div className="space-y-4">
      {overdue.length > 0 && <TaskGroup title="Overdue" tone="danger" tasks={overdue} timeZone={timeZone} showContext={showContext} />}
      {today.length > 0 && <TaskGroup title="Due today" tasks={today} timeZone={timeZone} showContext={showContext} />}
    </div>
  );
}
