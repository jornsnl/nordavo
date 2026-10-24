"use client";

import { useId, useRef, useState, useTransition, type ReactNode, type TouchEventHandler } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import type { TaskStatus } from "@/lib/database.types";
import type { StaffMember, TaskItem } from "@/lib/data/tasks";
import { taskStatuses } from "@/lib/labels";
import { FormMessage } from "@/components/ui/field";
import { moveTask } from "./actions";
import { TaskCheckbox } from "./task-checkbox";
import { TaskModal } from "./task-form";
import { AssigneeLabel, DueLabel, PriorityBadge, RecordChip } from "./task-meta";

type Columns = Record<TaskStatus, TaskItem[]>;

const statusOrder: TaskStatus[] = ["todo", "in_progress", "done"];
const STEP = 1024;

function toColumns(tasks: TaskItem[]): Columns {
  const columns: Columns = { todo: [], in_progress: [], done: [] };
  for (const task of tasks) columns[task.status].push(task);
  for (const status of statusOrder) columns[status].sort((a, b) => a.position - b.position);
  return columns;
}

function isStatus(id: UniqueIdentifier): id is TaskStatus {
  return statusOrder.includes(id as TaskStatus);
}

/**
 * Fractional position between the neighbours at `index`. Returns null when
 * there is no room left (equal neighbours), so the column gets renumbered.
 */
function positionAt(list: TaskItem[], index: number): number | null {
  const before = list[index - 1]?.position;
  const after = list[index + 1]?.position;
  if (before === undefined && after === undefined) return STEP;
  if (before === undefined) return (after as number) - STEP;
  if (after === undefined) return before + STEP;
  if (after - before < 1e-6) return null;
  return (before + after) / 2;
}

/** Kanban board for tasks, with keyboard and pointer drag and drop. */
export function TaskBoard({
  tasks,
  staff,
  currentUserId,
  today,
}: {
  tasks: TaskItem[];
  staff: StaffMember[];
  currentUserId: string;
  today: string;
}) {
  const dndId = useId();
  const [columns, setColumns] = useState(() => toColumns(tasks));
  const [sourceTasks, setSourceTasks] = useState(tasks);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editing, setEditing] = useState<TaskItem | null>(null);
  const [error, setError] = useState<string>();
  const [, startTransition] = useTransition();
  const snapshot = useRef<Columns | null>(null);
  const startStatus = useRef<TaskStatus | null>(null);

  // New data from the server (after a save) replaces the local order.
  if (tasks !== sourceTasks) {
    setSourceTasks(tasks);
    setColumns(toColumns(tasks));
  }

  // Touch drags start after a short press, so a swipe still scrolls the
  // page and the column strip.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const findStatus = (id: UniqueIdentifier, cols: Columns = columns): TaskStatus | null => {
    if (isStatus(id)) return id;
    return statusOrder.find((s) => cols[s].some((t) => t.id === id)) ?? null;
  };
  const findTask = (id: UniqueIdentifier) =>
    statusOrder.flatMap((s) => columns[s]).find((t) => t.id === id) ?? null;
  const statusLabel = (status: TaskStatus) => taskStatuses.find((s) => s.value === status)?.label ?? status;

  function handleDragStart({ active }: DragStartEvent) {
    setActiveId(String(active.id));
    setError(undefined);
    // A short buzz on phones that support it, like a native long press.
    navigator.vibrate?.(10);
    snapshot.current = columns;
    startStatus.current = findStatus(active.id);
  }

  // Moving into another column while dragging, so the card shows up there.
  function handleDragOver({ active, over }: DragOverEvent) {
    if (!over) return;
    const from = findStatus(active.id);
    const to = findStatus(over.id);
    if (!from || !to || from === to) return;

    setColumns((cols) => {
      const moving = cols[from].find((t) => t.id === active.id);
      if (!moving) return cols;
      const target = cols[to];
      const overIndex = target.findIndex((t) => t.id === over.id);
      const index = overIndex >= 0 ? overIndex : target.length;
      return {
        ...cols,
        [from]: cols[from].filter((t) => t.id !== active.id),
        [to]: [...target.slice(0, index), { ...moving, status: to }, ...target.slice(index)],
      };
    });
  }

  function handleDragEnd({ active, over }: DragEndEvent) {
    setActiveId(null);
    const before = snapshot.current;
    const originalStatus = startStatus.current;
    snapshot.current = null;
    startStatus.current = null;

    const status = findStatus(active.id);
    if (!over || !status || !before || !originalStatus) {
      if (before) setColumns(before);
      return;
    }

    let list = columns[status];
    const oldIndex = list.findIndex((t) => t.id === active.id);
    const overIndex = isStatus(over.id) ? list.length - 1 : list.findIndex((t) => t.id === over.id);
    const newIndex = overIndex >= 0 ? overIndex : oldIndex;
    if (oldIndex !== newIndex) list = arrayMove(list, oldIndex, newIndex);

    const originalIndex = before[originalStatus].findIndex((t) => t.id === active.id);
    if (status === originalStatus && newIndex === originalIndex) {
      setColumns(before);
      return;
    }

    const position = positionAt(list, newIndex);
    const reorder = position === null ? list.map((t) => t.id) : undefined;
    const finalPosition = position ?? (newIndex + 1) * STEP;
    list = list.map((t, i) =>
      t.id === active.id
        ? { ...t, status, position: finalPosition }
        : reorder
          ? { ...t, position: (i + 1) * STEP }
          : t,
    );
    setColumns({ ...columns, [status]: list });

    startTransition(async () => {
      const result = await moveTask({ id: String(active.id), status, position: finalPosition, reorder });
      if (result.error) {
        setColumns(before);
        setError("Verplaatsen is niet gelukt. Probeer het opnieuw.");
      }
    });
  }

  function handleDragCancel() {
    setActiveId(null);
    if (snapshot.current) setColumns(snapshot.current);
    snapshot.current = null;
    startStatus.current = null;
  }

  const describe = (id: UniqueIdentifier) => {
    if (isStatus(id)) return `kolom ${statusLabel(id)}`;
    const status = findStatus(id);
    const index = status ? columns[status].findIndex((t) => t.id === id) : -1;
    return status ? `plek ${index + 1} in ${statusLabel(status)}` : "een onbekende plek";
  };
  const titleOf = (id: UniqueIdentifier) => findTask(id)?.title ?? "taak";

  const announcements: Announcements = {
    onDragStart: ({ active }) => `Taak ${titleOf(active.id)} opgepakt.`,
    onDragOver: ({ active, over }) =>
      over ? `Taak ${titleOf(active.id)} staat nu op ${describe(over.id)}.` : `Taak ${titleOf(active.id)} staat niet boven een kolom.`,
    onDragEnd: ({ active, over }) =>
      over ? `Taak ${titleOf(active.id)} neergezet op ${describe(over.id)}.` : `Taak ${titleOf(active.id)} neergezet.`,
    onDragCancel: ({ active }) => `Slepen geannuleerd. Taak ${titleOf(active.id)} staat weer op de oude plek.`,
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
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
        accessibility={{
          announcements,
          screenReaderInstructions: {
            draggable:
              "Druk op spatie of enter om de taak op te pakken. Verplaats hem met de pijltjestoetsen, zet hem neer met spatie of enter, of annuleer met escape.",
          },
        }}
      >
        <p className="mb-3 text-xs text-muted md:hidden">
          Veeg opzij voor de andere kolommen. Houd een taak ingedrukt om hem te verplaatsen.
        </p>
        {/* Phones: a swipeable strip of columns. From md: a three column grid. */}
        <div className="-mx-4 flex snap-strip scrollbar-none gap-3 px-4 sm:-mx-6 sm:px-6 md:mx-0 md:grid md:grid-cols-3 md:gap-4 md:overflow-visible md:px-0">
          {statusOrder.map((status) => (
            <BoardColumn
              key={status}
              status={status}
              label={statusLabel(status)}
              tasks={columns[status]}
              today={today}
              onEdit={setEditing}
            />
          ))}
        </div>
        <DragOverlay>
          {activeTask && <TaskCard task={activeTask} today={today} overlay />}
        </DragOverlay>
      </DndContext>

      <TaskModal
        open={editing !== null}
        task={editing}
        staff={staff}
        currentUserId={currentUserId}
        onClose={() => setEditing(null)}
      />
    </>
  );
}

function BoardColumn({
  status,
  label,
  tasks,
  today,
  onEdit,
}: {
  status: TaskStatus;
  label: string;
  tasks: TaskItem[];
  today: string;
  onEdit: (task: TaskItem) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const headingId = `board-${status}`;

  return (
    <section
      aria-labelledby={headingId}
      className={`flex min-h-40 w-[85%] max-w-80 shrink-0 snap-start scroll-ml-4 flex-col rounded-2xl border bg-surface/80 p-3 transition max-md:min-h-[50dvh] sm:scroll-ml-6 md:w-auto md:max-w-none ${
        isOver ? "border-brand-200 bg-brand-50" : "border-border"
      }`}
    >
      <h2 id={headingId} className="mb-3 flex items-center justify-between px-1 font-display text-sm font-semibold text-brand-900">
        {label}
        <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-muted ring-1 ring-border">
          {tasks.length}
        </span>
      </h2>
      <SortableContext id={status} items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <ul ref={setNodeRef} className="flex flex-1 flex-col gap-2">
          {tasks.map((task) => (
            <SortableTaskCard key={task.id} task={task} today={today} onEdit={onEdit} />
          ))}
          {tasks.length === 0 && (
            <li className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-brand-200 px-3 py-6 text-center text-xs text-muted">
              Sleep een taak hierheen
            </li>
          )}
        </ul>
      </SortableContext>
    </section>
  );
}

function SortableTaskCard({
  task,
  today,
  onEdit,
}: {
  task: TaskItem;
  today: string;
  onEdit: (task: TaskItem) => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: task.id });

  // On touch the whole card can be long pressed; mouse and keyboard use the handle.
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      onTouchStart={listeners?.onTouchStart as TouchEventHandler<HTMLLIElement> | undefined}
      className={`select-none [-webkit-touch-callout:none] md:select-auto ${isDragging ? "opacity-40" : ""}`}
    >
      <TaskCard
        task={task}
        today={today}
        onEdit={onEdit}
        handle={
          <button
            type="button"
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            aria-label={`${task.title} verplaatsen`}
            className="flex size-8 shrink-0 cursor-grab items-center justify-center rounded-lg text-muted hover:bg-brand-50 hover:text-ink active:bg-brand-50 focus-visible:outline-2 focus-visible:outline-brand-500 active:cursor-grabbing"
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
  today,
  onEdit,
  handle,
  overlay,
}: {
  task: TaskItem;
  today: string;
  onEdit?: (task: TaskItem) => void;
  handle?: ReactNode;
  overlay?: boolean;
}) {
  const done = task.status === "done";
  return (
    <div
      className={`rounded-xl border border-border bg-card p-3 shadow-xs ${
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
          {onEdit ? (
            <button
              type="button"
              onClick={() => onEdit(task)}
              className={`text-left text-sm font-medium break-words hover:text-brand-600 hover:underline focus-visible:outline-2 focus-visible:outline-brand-500 ${
                done ? "text-muted line-through" : "text-ink"
              }`}
            >
              {task.title}
            </button>
          ) : (
            <p className="text-sm font-medium break-words text-ink">{task.title}</p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <PriorityBadge priority={task.priority} />
            <DueLabel dueDate={task.dueDate} today={today} done={done} />
            <AssigneeLabel name={task.assigneeName} />
          </div>
          {task.entityType && (
            <div className="mt-2">
              <RecordChip task={task} />
            </div>
          )}
        </div>
        {!overlay && (
          <span className="pt-1">
            <TaskCheckbox taskId={task.id} title={task.title} done={done} />
          </span>
        )}
      </div>
    </div>
  );
}
