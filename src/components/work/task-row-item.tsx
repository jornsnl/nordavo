"use client";

import type { ReactNode } from "react";
import type { TaskMenuTask } from "@/lib/work/task-menu";
import { TaskMenuButton, useTaskMenuTarget } from "@/components/work/task-menu";

/**
 * A task row that opens the task's actions on a long press (touch) or a right
 * click (desktop). The tap itself still opens the task. The keyboard
 * shortcuts (j/k, c, e, x) find it through its data attributes.
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
    // data-task-row: the j/k selection and the c, e and x shortcuts find tasks by it (PortalShortcuts).
    <li
      {...handlers}
      data-task-row={task.id}
      data-task-title={task.title}
      data-task-status={task.status}
      data-task-priority={task.priority}
      data-task-reviewer={task.reviewerId ?? ""}
      className={`${className} scroll-my-24 [-webkit-touch-callout:none] pointer-coarse:select-none data-[cursor=true]:bg-brand-50 data-[cursor=true]:ring-2 data-[cursor=true]:ring-brand-400 data-[cursor=true]:ring-inset`}
    >
      {children}
    </li>
  );
}

export { TaskMenuButton };
