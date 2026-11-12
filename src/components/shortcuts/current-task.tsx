"use client";

import { useEffect } from "react";
import type { TaskMenuTask } from "@/lib/work/task-menu";

/** Sent by the "e" shortcut on a task page: the description editor opens. */
export const EDIT_TASK_EVENT = "work:edit-task";

let current: TaskMenuTask | null = null;

/** The task of the open task page, for "c" and "e" when no row in a list is selected. */
export function getCurrentTask(): TaskMenuTask | null {
  return current;
}

/** Mounted on the task page: tells the keyboard shortcuts which task is open. */
export function CurrentTask({ task }: { task: TaskMenuTask }) {
  useEffect(() => {
    current = task;
    return () => {
      if (current?.id === task.id) current = null;
    };
  }, [task]);
  return null;
}
