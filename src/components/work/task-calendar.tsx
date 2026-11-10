"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { DndContext, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { TaskListItem } from "@/lib/work/data";
import type { TaskView } from "@/lib/offline/overlay";
import { submitTaskOp } from "@/lib/offline/sync";
import { MouseAndPenSensor, TOUCH_DELAY_MS, TOUCH_TOLERANCE_PX } from "@/components/ui/dnd";
import { useOfflineTasks } from "@/components/offline/use-offline-tasks";
import { priorityBorder } from "@/components/work/task-row";
import { TaskTypeIcon } from "@/components/work/task-type-icon";
import {
  addDays,
  dayOfMonth,
  deadlineOn,
  diffDays,
  firstOfMonth,
  formatDay,
  lastOfMonth,
  moveDeadline,
  startOfWeek,
} from "@/lib/work/days";
import { dayIn } from "@/lib/work/time";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// A task with a start date shows on every day up to its deadline, so a chip's id carries its day.
const chipId = (taskId: string, day: string) => `${day}|${taskId}`;
const NO_DAY = "none";

/** The fields of a date change, for the outbox. */
export type DateFields = { due_at?: string | null; start_on?: string | null };

/** Sends a date change through the outbox (also offline), with the task as the page shows it. */
export function saveDates(task: TaskListItem, fields: DateFields) {
  void submitTaskOp({ op: "task.update", payload: { taskId: task.id, fields } }, task);
}

/** Mouse or pen after 6 pixels, a finger after a press: a swipe still scrolls the month. */
export function useDateDragSensors() {
  return useSensors(
    useSensor(MouseAndPenSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: TOUCH_DELAY_MS, tolerance: TOUCH_TOLERANCE_PX } }),
  );
}

function Chip({ id, task, faded }: { id: string; task: TaskListItem; faded?: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id });
  const done = task.status === "done" || task.status === "cancelled";
  return (
    <div
      ref={setNodeRef}
      style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 20 } : undefined}
      className={`touch-manipulation select-none ${faded ? "opacity-55" : ""} ${isDragging ? "opacity-80 shadow-lg" : ""}`}
      {...attributes}
      {...listeners}
      aria-roledescription="Draggable task"
    >
      <Link
        href={`/work/tasks/${task.id}`}
        draggable={false}
        title={`${task.title} (${task.project.name})`}
        className={`flex items-center gap-1 truncate rounded-md bg-white px-1.5 py-1 text-xs font-medium shadow-xs ring-1 ring-border hover:bg-brand-50 ${priorityBorder(task.priority)} ${
          done ? "text-muted line-through" : "text-ink"
        }`}
      >
        {task.taskType && <TaskTypeIcon type={task.taskType} className="size-3 shrink-0 text-muted" />}
        <span className="truncate">{task.title}</span>
      </Link>
    </div>
  );
}

function Day({ day, inMonth, tall, today, children }: { day: string; inMonth: boolean; tall: boolean; today: string; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `day:${day}` });
  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col gap-1 border-r border-b border-border p-1.5 transition-colors [&:nth-child(7n)]:border-r-0 ${tall ? "min-h-72" : "min-h-28"} ${
        inMonth ? "" : "bg-surface/70"
      } ${isOver ? "bg-brand-50" : ""}`}
    >
      <span
        className={`flex size-6 items-center justify-center rounded-full text-xs tabular-nums ${
          day === today ? "bg-brand-700 font-semibold text-white" : inMonth ? "text-ink" : "text-muted"
        }`}
      >
        {dayOfMonth(day)}
      </span>
      {children}
    </div>
  );
}

function Tray({ tasks }: { tasks: TaskListItem[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: `day:${NO_DAY}` });
  return (
    <div ref={setNodeRef} className={`rounded-2xl border border-dashed border-border p-3 transition-colors ${isOver ? "bg-brand-50" : "bg-card"}`}>
      <p className="mb-2 text-xs font-semibold text-muted">
        No date ({tasks.length}) <span className="font-normal">· drag one onto a day to give it a deadline (17:00), or drag a task here to remove its dates</span>
      </p>
      {tasks.length > 0 && (
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-4">
          {tasks.slice(0, 24).map((task) => (
            <Chip key={task.id} id={chipId(task.id, NO_DAY)} task={task} />
          ))}
        </div>
      )}
      {tasks.length > 24 && <p className="mt-2 text-xs text-muted">and {tasks.length - 24} more in the list view</p>}
    </div>
  );
}

/**
 * Tasks on a month or week calendar (from the task board of Athmium). A task
 * shows on its deadline, and with a start date on every day from start to
 * deadline. Drag a task to another day to move it: the deadline keeps its
 * time of day and a start date moves along. Changes go through the outbox,
 * so they also work offline.
 */
export function TaskCalendar({ tasks, view, timeZone }: { tasks: TaskListItem[]; view?: TaskView; timeZone: string }) {
  const live = useOfflineTasks(tasks, view);
  const today = dayIn(new Date(), timeZone);
  const [mode, setMode] = useState<"month" | "week">("month");
  const [anchor, setAnchor] = useState(today);
  const sensors = useDateDragSensors();

  const days = useMemo(() => {
    if (mode === "week") {
      const start = startOfWeek(anchor);
      return Array.from({ length: 7 }, (_, i) => addDays(start, i));
    }
    const out: string[] = [];
    const last = lastOfMonth(anchor);
    for (let d = startOfWeek(firstOfMonth(anchor)); d <= last || out.length % 7 !== 0; d = addDays(d, 1)) out.push(d);
    return out;
  }, [mode, anchor]);

  const dueDay = (t: TaskListItem) => (t.dueAt ? dayIn(t.dueAt, timeZone) : null);

  const byDay = useMemo(() => {
    const map = new Map<string, { task: TaskListItem; faded: boolean }[]>();
    const first = days[0];
    const last = days[days.length - 1];
    for (const task of live) {
      const due = task.dueAt ? dayIn(task.dueAt, timeZone) : null;
      const from = task.startOn ?? due;
      const to = due ?? task.startOn;
      if (!from || !to || to < first || from > last) continue;
      for (let d = from < first ? first : from; d <= to && d <= last; d = addDays(d, 1)) {
        const list = map.get(d) ?? [];
        list.push({ task, faded: Boolean(due) && d !== due });
        map.set(d, list);
      }
    }
    return map;
  }, [live, days, timeZone]);

  const undated = live.filter((t) => !t.dueAt && !t.startOn);
  const month = anchor.slice(0, 7);
  const title =
    mode === "month"
      ? formatDay(anchor, { month: "long", year: "numeric" })
      : `${formatDay(days[0], { day: "numeric", month: "short" })} – ${formatDay(days[6], { day: "numeric", month: "short", year: "numeric" })}`;

  function shift(dir: 1 | -1) {
    setAnchor(mode === "week" ? addDays(anchor, 7 * dir) : firstOfMonth(anchor, dir));
  }

  function onDragEnd(e: DragEndEvent) {
    const over = e.over?.id ? String(e.over.id) : null;
    if (!over?.startsWith("day:")) return;
    const to = over.slice(4);
    const active = String(e.active.id);
    const from = active.slice(0, active.indexOf("|"));
    const task = live.find((t) => t.id === active.slice(from.length + 1));
    if (!task || from === to) return;
    if (to === NO_DAY) return saveDates(task, { due_at: null, start_on: null });
    if (from === NO_DAY) return saveDates(task, { due_at: deadlineOn(to, timeZone) });
    const delta = diffDays(from, to);
    const due = dueDay(task);
    const fields: DateFields = {};
    if (task.dueAt && due) fields.due_at = moveDeadline(task.dueAt, addDays(due, delta), timeZone);
    if (task.startOn) fields.start_on = addDays(task.startOn, delta);
    saveDates(task, fields);
  }

  const button = "rounded-lg border border-border bg-white p-1.5 text-ink hover:bg-surface pointer-coarse:min-h-9 pointer-coarse:min-w-9";
  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => shift(-1)} className={button} aria-label={mode === "week" ? "Previous week" : "Previous month"}>
              <ChevronLeft className="size-4" aria-hidden="true" />
            </button>
            <button type="button" onClick={() => shift(1)} className={button} aria-label={mode === "week" ? "Next week" : "Next month"}>
              <ChevronRight className="size-4" aria-hidden="true" />
            </button>
            <button type="button" onClick={() => setAnchor(today)} className={`${button} px-2.5 py-1 text-sm`}>
              Today
            </button>
          </div>
          <h2 className="font-display text-base font-semibold text-brand-900" aria-live="polite">
            {title}
          </h2>
          <div className="ml-auto flex rounded-xl border border-border bg-white p-1 text-sm" role="group" aria-label="Calendar range">
            {(["month", "week"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                aria-pressed={mode === m}
                className={`rounded-lg px-3 py-1 capitalize ${mode === m ? "bg-brand-700 text-white" : "text-muted hover:text-ink"}`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-xs">
          <div className="min-w-[720px]">
            <div className="grid grid-cols-7 border-b border-border bg-surface">
              {WEEKDAYS.map((d) => (
                <div key={d} className="px-2 py-2 text-xs font-semibold text-muted">
                  {d}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {days.map((day) => {
                const list = byDay.get(day) ?? [];
                const max = mode === "month" ? 3 : 50;
                return (
                  <Day key={day} day={day} today={today} inMonth={mode === "week" || day.startsWith(month)} tall={mode === "week"}>
                    {list.slice(0, max).map(({ task, faded }) => (
                      <Chip key={task.id} id={chipId(task.id, day)} task={task} faded={faded} />
                    ))}
                    {list.length > max && (
                      <button
                        type="button"
                        onClick={() => (setAnchor(day), setMode("week"))}
                        className="px-1 text-left text-xs text-muted hover:text-ink"
                      >
                        +{list.length - max} more
                      </button>
                    )}
                  </Day>
                );
              })}
            </div>
          </div>
        </div>
        <Tray tasks={undated} />
      </div>
    </DndContext>
  );
}
