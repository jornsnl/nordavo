"use client";

import { useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { DndContext, useDraggable, type DragEndEvent, type DragMoveEvent } from "@dnd-kit/core";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { TaskListItem } from "@/lib/work/data";
import type { TaskView } from "@/lib/offline/overlay";
import { priorityStyles } from "@/lib/sales/labels";
import { formatEstimate } from "@/lib/work/labels";
import { addDays, deadlineOn, diffDays, formatDay, isWeekend, moveDeadline, startOfWeek, timelineSpan, weekday } from "@/lib/work/days";
import { dayIn } from "@/lib/work/time";
import { useOfflineTasks } from "@/components/offline/use-offline-tasks";
import { TaskTypeIcon } from "@/components/work/task-type-icon";
import { saveDates, useDateDragSensors, type DateFields } from "@/components/work/task-calendar";

const ZOOMS = [
  // `width` is the narrowest a day gets; wider screens stretch the days to fill the row.
  { id: "2w", label: "2 weeks", days: 14, width: 56, before: 0 },
  { id: "6w", label: "6 weeks", days: 42, width: 24, before: 7 },
  { id: "q", label: "Quarter", days: 91, width: 10, before: 7 },
] as const;
type ZoomId = (typeof ZOOMS)[number]["id"];

export type LaneBy = "project" | "person" | "none";
type Lane = { key: string; label: string; items: TaskListItem[] };

type Edge = "move" | "start" | "end";
const dragId = (edge: Edge, lane: string, id: string) => `${edge}|${lane}|${id}`;
const parseDragId = (s: string) => {
  const [edge, lane, ...rest] = s.split("|");
  return { edge: edge as Edge, lane, id: rest.join("|") };
};

function Handle({ id, side }: { id: string; side: "left" | "right" }) {
  // Mouse only; the task page changes dates from the keyboard.
  const { listeners, setNodeRef } = useDraggable({ id });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      aria-hidden="true"
      title={side === "left" ? "Drag to change the start date" : "Drag to change the deadline"}
      className={`absolute inset-y-0 z-[2] w-2 cursor-ew-resize rounded opacity-0 transition-opacity group-hover/bar:opacity-100 hover:bg-ink/15 pointer-coarse:hidden ${
        side === "left" ? "left-0" : "right-0"
      }`}
    />
  );
}

function Bar({
  id,
  task,
  left,
  width,
  clipped,
  derived,
  dragging,
  canResize,
  lane,
}: {
  id: string;
  task: TaskListItem;
  left: number;
  width: number;
  clipped: { start: boolean; end: boolean };
  derived: "start" | "due" | null;
  dragging: boolean;
  canResize: boolean;
  lane: string;
}) {
  const { attributes, listeners, setNodeRef } = useDraggable({ id });
  const style = priorityStyles[task.priority];
  const done = task.status === "done" || task.status === "cancelled";
  return (
    <div
      ref={setNodeRef}
      style={{ left, width }}
      className={`group/bar absolute inset-y-1 z-[1] touch-manipulation select-none ${dragging ? "z-20 opacity-80 shadow-lg" : ""}`}
      {...attributes}
      {...listeners}
      aria-roledescription="Draggable task"
      aria-label={`${task.title}: drag to move its dates`}
    >
      <div
        className={`flex h-full items-center gap-1 overflow-hidden rounded-md border px-1.5 text-xs font-medium ${style.chip} ${
          derived ? "border-dashed" : ""
        } ${done ? "opacity-60" : ""}`}
        title={`${task.title}${derived ? ` (${derived === "start" ? "start" : "end"} from the estimate)` : ""}`}
      >
        {width >= 40 && task.taskType && <TaskTypeIcon type={task.taskType} className="size-3 shrink-0" />}
        {width >= 60 && <span className="truncate">{task.title}</span>}
      </div>
      {canResize && !clipped.start && <Handle id={dragId("start", lane, task.id)} side="left" />}
      {canResize && !clipped.end && <Handle id={dragId("end", lane, task.id)} side="right" />}
    </div>
  );
}

/**
 * Tasks as bars from start date to deadline (from the task board of
 * Athmium), in lanes by project or person. A task with one date gets its
 * other end from the estimate (dashed). Drag a bar to move both dates, or
 * its ends to change the start date or the deadline. Through the outbox, so
 * also offline.
 */
export function TaskTimeline({
  tasks,
  view,
  timeZone,
  defaultLanes = "project",
}: {
  tasks: TaskListItem[];
  view?: TaskView;
  timeZone: string;
  defaultLanes?: LaneBy;
}) {
  const live = useOfflineTasks(tasks, view);
  const today = dayIn(new Date(), timeZone);
  const [zoomId, setZoomId] = useState<ZoomId>("6w");
  const [anchor, setAnchor] = useState(today);
  const [laneBy, setLaneBy] = useState<LaneBy>(defaultLanes);
  const zoom = ZOOMS.find((z) => z.id === zoomId)!;
  const first = addDays(startOfWeek(anchor), -zoom.before);
  const last = addDays(first, zoom.days - 1);

  const scroller = useRef<HTMLDivElement>(null);
  const labelCell = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState(0);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setRoom(el.clientWidth - (labelCell.current?.offsetWidth ?? 0));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const w = Math.max(zoom.width, room / zoom.days);
  const [drag, setDrag] = useState<{ key: string; days: number } | null>(null);
  const sensors = useDateDragSensors();

  const spanOf = (t: TaskListItem) => timelineSpan(t, timeZone);
  const shown = live.filter((t) => {
    const s = spanOf(t);
    return s && s.to >= first && s.from <= last;
  });
  const unscheduled = live.filter((t) => !t.dueAt && !t.startOn).length;

  const lanes = ((): Lane[] => {
    const sorted = [...shown].sort((a, b) => spanOf(a)!.from.localeCompare(spanOf(b)!.from) || a.title.localeCompare(b.title));
    if (laneBy === "none") return [{ key: "all", label: "", items: sorted }];
    const map = new Map<string, Lane>();
    const add = (key: string, label: string, task: TaskListItem) => {
      const lane = map.get(key) ?? { key, label, items: [] };
      lane.items.push(task);
      map.set(key, lane);
    };
    for (const task of sorted) {
      if (laneBy === "project") add(task.project.id, `${task.workspace.name} › ${task.project.name}`, task);
      else if (task.assignees.length === 0) add("nobody", "No owner", task);
      else for (const p of task.assignees) add(p.id, p.name, task);
    }
    return [...map.values()].sort((a, b) => (a.key === "nobody" ? 1 : b.key === "nobody" ? -1 : a.label.localeCompare(b.label)));
  })();

  const days = Array.from({ length: zoom.days }, (_, i) => addDays(first, i));
  const months = (() => {
    const out: { label: string; span: number }[] = [];
    for (const d of days) {
      const label = formatDay(d, { month: zoom.days > 14 ? "short" : "long", year: "numeric" });
      if (out.at(-1)?.label === label) out.at(-1)!.span++;
      else out.push({ label, span: 1 });
    }
    return out;
  })();
  const todayIdx = diffDays(first, today);
  const gridWidth = zoom.days * w;

  function current(task: TaskListItem, lane: string) {
    const span = spanOf(task)!;
    if (!drag || !drag.days) return span;
    const { edge, lane: l, id } = parseDragId(drag.key);
    if (id !== task.id || l !== lane) return span;
    if (edge === "move") return { ...span, from: addDays(span.from, drag.days), to: addDays(span.to, drag.days) };
    if (edge === "start") {
      const from = addDays(span.from, drag.days);
      return { ...span, from: from > span.to ? span.to : from, derived: null };
    }
    const to = addDays(span.to, drag.days);
    return { ...span, to: to < span.from ? span.from : to, derived: null };
  }

  function onDragMove(e: DragMoveEvent) {
    const n = Math.round(e.delta.x / w);
    setDrag((d) => (d && d.days === n && d.key === String(e.active.id) ? d : { key: String(e.active.id), days: n }));
  }

  function onDragEnd(e: DragEndEvent) {
    setDrag(null);
    const { edge, id } = parseDragId(String(e.active.id));
    const delta = Math.round(e.delta.x / w);
    const task = live.find((t) => t.id === id);
    if (!task || !delta) return;
    const span = spanOf(task)!;
    const due = (day: string) => (task.dueAt ? moveDeadline(task.dueAt, day, timeZone) : deadlineOn(day, timeZone));
    const fields: DateFields = {};
    if (edge === "move") {
      // Only the dates the task has: an end from the estimate follows along.
      if (task.dueAt) fields.due_at = due(addDays(span.to, delta));
      if (task.startOn) fields.start_on = addDays(task.startOn, delta);
    } else if (edge === "start") {
      // Resizing sets both ends, so the bar keeps the shape it was given.
      const from = addDays(span.from, delta);
      fields.start_on = from > span.to ? span.to : from;
      if (!task.dueAt) fields.due_at = due(span.to);
    } else {
      const to = addDays(span.to, delta);
      fields.due_at = due(to < span.from ? span.from : to);
      if (!task.startOn) fields.start_on = span.from;
    }
    saveDates(task, fields);
  }

  const title = `${formatDay(first, { day: "numeric", month: "short" })} – ${formatDay(last, { day: "numeric", month: "short", year: "numeric" })}`;
  const button = "rounded-lg border border-border bg-white p-1.5 text-ink hover:bg-surface pointer-coarse:min-h-9 pointer-coarse:min-w-9";
  const step = 7 * Math.max(1, Math.floor(zoom.days / 14));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setAnchor(addDays(anchor, -step))} className={button} aria-label="Earlier">
            <ChevronLeft className="size-4" aria-hidden="true" />
          </button>
          <button type="button" onClick={() => setAnchor(addDays(anchor, step))} className={button} aria-label="Later">
            <ChevronRight className="size-4" aria-hidden="true" />
          </button>
          <button type="button" onClick={() => setAnchor(today)} className={`${button} px-2.5 py-1 text-sm`}>
            Today
          </button>
        </div>
        <h2 className="font-display text-base font-semibold text-brand-900" aria-live="polite">
          {title}
        </h2>
        {unscheduled > 0 && <span className="text-xs text-muted">{unscheduled} without a date</span>}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <label className="text-sm">
            <span className="sr-only">Lanes</span>
            <select
              value={laneBy}
              onChange={(e) => setLaneBy(e.target.value as LaneBy)}
              className="rounded-xl border border-border bg-white px-2.5 py-1.5 text-sm"
            >
              <option value="project">By project</option>
              <option value="person">By owner</option>
              <option value="none">No lanes</option>
            </select>
          </label>
          <div className="flex rounded-xl border border-border bg-white p-1 text-sm" role="group" aria-label="Zoom">
            {ZOOMS.map((z) => (
              <button
                key={z.id}
                type="button"
                onClick={() => setZoomId(z.id)}
                aria-pressed={zoom.id === z.id}
                className={`rounded-lg px-3 py-1 whitespace-nowrap ${zoom.id === z.id ? "bg-brand-700 text-white" : "text-muted hover:text-ink"}`}
              >
                {z.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      {/* No auto scroll: it adds to the drag distance, which is what sets the new dates. */}
      <DndContext sensors={sensors} autoScroll={false} onDragStart={(e) => setDrag({ key: String(e.active.id), days: 0 })} onDragMove={onDragMove} onDragEnd={onDragEnd} onDragCancel={() => setDrag(null)}>
        <div ref={scroller} className="overflow-x-auto rounded-2xl border border-border bg-card shadow-xs [--label-w:9rem] sm:[--label-w:15rem]">
          <div className="relative" style={{ width: `calc(var(--label-w) + ${gridWidth}px)` }}>
            {/* Weekends and today, behind every row. */}
            <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-(--label-w)" style={{ width: gridWidth }}>
              {days.map((d, i) => isWeekend(d) && <div key={d} className="absolute inset-y-0 bg-surface" style={{ left: i * w, width: w }} />)}
              {todayIdx >= 0 && todayIdx < zoom.days && <div className="absolute inset-y-0 w-px bg-accent-500" style={{ left: todayIdx * w + w / 2 }} />}
            </div>

            <div className="relative z-10 border-b border-border bg-surface">
              <div className="flex">
                <div className="sticky left-0 z-10 w-(--label-w) shrink-0 bg-surface" />
                {months.map((m, i) => (
                  <div key={i} className="truncate border-l border-border px-1.5 pt-1.5 text-xs font-semibold text-muted" style={{ width: m.span * w }}>
                    {m.span * w >= 40 ? m.label : ""}
                  </div>
                ))}
              </div>
              <div className="flex">
                <div ref={labelCell} className="sticky left-0 z-10 w-(--label-w) shrink-0 bg-surface px-3 pb-1.5 text-xs font-semibold text-muted">
                  Task
                </div>
                {days.map((d) => {
                  const label = w >= 24 || weekday(d) === 1 ? String(Number(d.slice(8))) : "";
                  return (
                    <div
                      key={d}
                      className={`pb-1.5 text-center text-[10px] tabular-nums ${d === today ? "font-bold text-accent-600" : "text-muted"} ${w < 24 ? "text-left" : ""}`}
                      style={{ width: w }}
                    >
                      {w >= 48 && <span className="mr-0.5">{formatDay(d, { weekday: "narrow" })}</span>}
                      {label}
                    </div>
                  );
                })}
              </div>
            </div>

            {lanes.map((lane) => {
              const minutes = lane.items.reduce((n, t) => n + (t.estimateMinutes ?? 0), 0);
              return (
                <div key={lane.key}>
                  {lane.label && (
                    <div className="flex h-8 items-center border-b border-border bg-surface/60">
                      <div className="sticky left-0 z-10 flex h-full w-(--label-w) shrink-0 items-center gap-1.5 bg-surface px-3 text-xs font-semibold text-brand-900">
                        <span className="truncate">{lane.label}</span>
                        <span className="ml-auto shrink-0 font-normal text-muted tabular-nums" title="Tasks · estimated time">
                          {lane.items.length}
                          {minutes > 0 && ` · ${formatEstimate(minutes)}`}
                        </span>
                      </div>
                    </div>
                  )}
                  {lane.items.map((task) => {
                    const span = current(task, lane.key);
                    const fromIdx = diffDays(first, span.from);
                    const toIdx = diffDays(first, span.to);
                    const a = Math.max(0, fromIdx);
                    const b = Math.min(zoom.days - 1, toIdx);
                    const key = dragId("move", lane.key, task.id);
                    return (
                      <div key={key} className="flex h-9 border-b border-border last:border-b-0">
                        <div className="sticky left-0 z-10 flex w-(--label-w) shrink-0 items-center bg-card px-3">
                          <Link href={`/work/tasks/${task.id}`} className="truncate text-xs font-medium text-ink hover:text-brand-700 hover:underline">
                            {task.title}
                          </Link>
                        </div>
                        <div className="relative" style={{ width: gridWidth }}>
                          {b >= a && (
                            <Bar
                              id={key}
                              task={task}
                              lane={lane.key}
                              left={a * w}
                              width={(b - a + 1) * w}
                              clipped={{ start: fromIdx < 0, end: toIdx >= zoom.days }}
                              derived={span.derived}
                              dragging={drag?.key.endsWith(`|${lane.key}|${task.id}`) ?? false}
                              canResize={w >= 12}
                            />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}

            {shown.length === 0 && (
              <div className="sticky left-0 inline-block px-4 py-12 text-sm text-muted">
                Nothing planned in this period. Give tasks a start date or a deadline to see them here.
              </div>
            )}
          </div>
        </div>
      </DndContext>
    </div>
  );
}
