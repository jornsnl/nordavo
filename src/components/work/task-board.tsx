"use client";

import { useId, useState, useTransition, type ReactNode, type TouchEventHandler } from "react";
import Link from "next/link";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCorners,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import type { TaskListItem } from "@/lib/work/data";
import type { WorkStatus } from "@/lib/work/database";
import { workOption, workStatuses } from "@/lib/work/labels";
import { FormMessage } from "@/components/ui/field";
import { quickStatusAction } from "@/app/work/actions";
import { DueLabel, People, PriorityBadge, priorityBorder } from "@/components/work/task-row";
import { RecordChip } from "@/components/work/task-record";

const baseColumns: WorkStatus[] = ["todo", "in_progress", "review", "done"];

const statusLabel = (status: WorkStatus) => workOption(workStatuses, status).label;

function isStatus(id: UniqueIdentifier): id is WorkStatus {
  return workStatuses.some((s) => s.value === id);
}

/**
 * Board view of Work: a column per status. Dragging a card to another column
 * changes its status through work_set_status, so the review rules hold: only
 * the reviewer or an admin can drop on Done, Review needs a reviewer, and
 * going back from Review or Done needs a comment (on the task page). When
 * the database refuses, the card jumps back and its message is shown.
 */
export function TaskBoard({
  tasks,
  timeZone,
  showContext = true,
}: {
  tasks: TaskListItem[];
  timeZone: string;
  showContext?: boolean;
}) {
  const dndId = useId();
  const [items, setItems] = useState(tasks);
  const [source, setSource] = useState(tasks);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const [, startTransition] = useTransition();

  // New data from the server (after a save or a filter change) replaces the local state.
  if (tasks !== source) {
    setSource(tasks);
    setItems(tasks);
  }

  const columns: WorkStatus[] = items.some((t) => t.status === "cancelled") ? [...baseColumns, "cancelled"] : baseColumns;

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // Touch drags start after a short press, so a swipe still scrolls.
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );

  const findTask = (id: UniqueIdentifier) => items.find((t) => t.id === id) ?? null;
  const columnOf = (id: UniqueIdentifier): WorkStatus | null => (isStatus(id) ? id : (findTask(id)?.status ?? null));

  function handleDragStart({ active }: DragStartEvent) {
    setActiveId(String(active.id));
    setError(undefined);
    navigator.vibrate?.(10);
  }

  function handleDragEnd({ active, over }: DragEndEvent) {
    setActiveId(null);
    const task = findTask(active.id);
    const to = over ? columnOf(over.id) : null;
    if (!task || !to || to === task.status) return;

    const before = items;
    setItems((list) => list.map((t) => (t.id === task.id ? { ...t, status: to } : t)));
    startTransition(async () => {
      const result = await quickStatusAction(task.id, to);
      if (result.error) {
        setItems(before);
        setError(`"${task.title}" stays in ${statusLabel(task.status)}: ${result.error}`);
      }
    });
  }

  const titleOf = (id: UniqueIdentifier) => findTask(id)?.title ?? "task";
  const describe = (id: UniqueIdentifier) => {
    const status = columnOf(id);
    return status ? `column ${statusLabel(status)}` : "no column";
  };
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up task ${titleOf(active.id)}.`,
    onDragOver: ({ active, over }) =>
      over ? `Task ${titleOf(active.id)} is over ${describe(over.id)}.` : `Task ${titleOf(active.id)} is not over a column.`,
    onDragEnd: ({ active, over }) =>
      over ? `Task ${titleOf(active.id)} dropped on ${describe(over.id)}.` : `Task ${titleOf(active.id)} dropped.`,
    onDragCancel: ({ active }) => `Drag cancelled. Task ${titleOf(active.id)} is back in its column.`,
  };

  const activeTask = activeId ? findTask(activeId) : null;

  return (
    <>
      {error && (
        <div className="mb-4">
          <FormMessage error={error} />
        </div>
      )}
      <DndContext
        id={dndId}
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveId(null)}
        accessibility={{
          announcements,
          screenReaderInstructions: {
            draggable:
              "Press space or enter to pick up the task. Move it to another column with the arrow keys, drop it with space or enter, or cancel with escape.",
          },
        }}
      >
        <p className="mb-3 text-xs text-muted lg:hidden">Swipe sideways for the other columns. Press and hold a task to move it.</p>
        <div
          className={`-mx-4 flex snap-strip scrollbar-none gap-3 px-4 sm:-mx-6 sm:px-6 lg:mx-0 lg:grid lg:gap-4 lg:overflow-visible lg:px-0 ${
            columns.length === 5 ? "lg:grid-cols-5" : "lg:grid-cols-4"
          }`}
        >
          {columns.map((status) => (
            <BoardColumn key={status} status={status} tasks={items.filter((t) => t.status === status)}>
              {(task) => <DraggableCard key={task.id} task={task} timeZone={timeZone} showContext={showContext} />}
            </BoardColumn>
          ))}
        </div>
        <DragOverlay>{activeTask && <TaskCard task={activeTask} timeZone={timeZone} showContext={showContext} overlay />}</DragOverlay>
      </DndContext>
    </>
  );
}

function BoardColumn({
  status,
  tasks,
  children,
}: {
  status: WorkStatus;
  tasks: TaskListItem[];
  children: (task: TaskListItem) => ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const headingId = `work-board-${status}`;
  return (
    <section
      ref={setNodeRef}
      aria-labelledby={headingId}
      className={`flex min-h-40 w-[85%] max-w-80 shrink-0 snap-start scroll-ml-4 flex-col rounded-2xl border bg-surface/80 p-3 transition max-lg:min-h-[50dvh] sm:scroll-ml-6 lg:w-auto lg:max-w-none ${
        isOver ? "border-brand-200 bg-brand-50" : "border-border"
      }`}
    >
      <h2 id={headingId} className="mb-3 flex items-center justify-between px-1 font-display text-sm font-semibold text-brand-900">
        {statusLabel(status)}
        <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-muted ring-1 ring-border">{tasks.length}</span>
      </h2>
      <ul className="flex flex-1 flex-col gap-2">
        {tasks.map((task) => children(task))}
        {tasks.length === 0 && (
          <li className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-brand-200 px-3 py-6 text-center text-xs text-muted">
            Drag a task here
          </li>
        )}
      </ul>
    </section>
  );
}

function DraggableCard({ task, timeZone, showContext }: { task: TaskListItem; timeZone: string; showContext: boolean }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, isDragging } = useDraggable({ id: task.id });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      onTouchStart={listeners?.onTouchStart as TouchEventHandler<HTMLLIElement> | undefined}
      className={`select-none [-webkit-touch-callout:none] lg:select-auto ${isDragging ? "opacity-40" : ""}`}
    >
      <TaskCard
        task={task}
        timeZone={timeZone}
        showContext={showContext}
        handle={
          <button
            type="button"
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            aria-label={`Move ${task.title}`}
            className="flex size-8 shrink-0 cursor-grab items-center justify-center rounded-lg text-muted hover:bg-brand-50 hover:text-ink active:cursor-grabbing active:bg-brand-50 focus-visible:outline-2 focus-visible:outline-brand-500"
          >
            <GripVertical className="size-4" aria-hidden="true" />
          </button>
        }
      />
    </li>
  );
}

function TaskCard({
  task,
  timeZone,
  showContext,
  handle,
  overlay,
}: {
  task: TaskListItem;
  timeZone: string;
  showContext: boolean;
  handle?: ReactNode;
  overlay?: boolean;
}) {
  const done = task.status === "done" || task.status === "cancelled";
  return (
    <div
      className={`rounded-xl border border-border bg-card p-3 shadow-xs ${priorityBorder(task.priority)} ${
        overlay ? "rotate-1 shadow-lg ring-2 ring-brand-200" : ""
      }`}
    >
      <div className="flex items-start gap-2">
        {overlay ? (
          <span className="flex size-8 shrink-0 items-center justify-center text-muted" aria-hidden="true">
            <GripVertical className="size-4" />
          </span>
        ) : (
          handle
        )}
        <div className="min-w-0 flex-1 pt-1">
          {showContext && (
            <p className="mb-0.5 truncate text-xs text-muted">
              {task.workspace.name} › {task.project.name}
            </p>
          )}
          <Link
            href={`/work/tasks/${task.id}`}
            className={`text-sm font-medium break-words hover:text-brand-600 hover:underline focus-visible:outline-2 focus-visible:outline-brand-500 ${
              done ? "text-muted line-through" : "text-ink"
            }`}
          >
            {task.title}
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <PriorityBadge priority={task.priority} />
            <DueLabel dueAt={task.dueAt} timeZone={timeZone} done={done} />
            <People people={task.assignees} />
          </div>
          {task.record && (
            <div className="mt-2">
              <RecordChip record={task.record} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
