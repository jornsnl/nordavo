"use client";

import type { ReactNode } from "react";
import type { TaskMenuTask } from "@/lib/work/task-menu";
import { TaskMenuButton, useTaskMenuTarget } from "@/components/work/task-menu";

/**
 * A task row that opens the task's actions on a long press (touch) or a right
 * click (desktop). The tap itself still opens the task.
 */
export function TaskRowItem({
  task,
  className,
  children,
}: {
  task: TaskMenuTask & { subtitle?: string };
  className: string;
  children: ReactNode;
}) {
  const { handlers } = useTaskMenuTarget(task);
  return (
    // The callout and text selection would cover the menu on a long press.
    <li {...handlers} className={`${className} [-webkit-touch-callout:none] pointer-coarse:select-none`}>
      {children}
    </li>
  );
}

export { TaskMenuButton };
