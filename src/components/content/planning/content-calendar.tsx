"use client";

import { useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DndContext, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { MouseAndPenSensor, TOUCH_DELAY_MS, TOUCH_TOLERANCE_PX } from "@/components/ui/dnd";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/toaster";
import { reschedulePostAction } from "@/app/content/actions/planning";
import { statusTone, weekday } from "@/lib/content/rules";

export type CalendarPost = {
  id: string;
  title: string;
  status: string;
  statusLabel: string;
  plannedDate: string | null;
  timeSlot: string | null;
  slotLabel: string | null;
};

export type CalendarSlot = { value: string; label: string; weekdays: number[] };

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const UNPLANNED = "unplanned";

/** Slots that apply on a day: the ones for its weekday, or every slot without weekdays. */
function slotsOn(day: string, slots: CalendarSlot[]) {
  const w = weekday(day);
  return slots.filter((s) => s.weekdays.length === 0 || s.weekdays.includes(w));
}

/** Keep the slot when it fits the new day, else the first slot of that weekday, else keep it. */
export function slotForDay(day: string, current: string | null, slots: CalendarSlot[]): string | null {
  const fitting = slotsOn(day, slots);
  if (current && (fitting.some((s) => s.value === current) || !slots.some((s) => s.value === current))) return current;
  return fitting[0]?.value ?? current;
}

function dayNumber(day: string) {
  return Number(day.slice(8, 10));
}

function Chip({ post, canEdit, slug, compact }: { post: CalendarPost; canEdit: boolean; slug: string; compact: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: post.id, disabled: !canEdit });
  return (
    <div
      ref={setNodeRef}
      style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 20 } : undefined}
      className={`touch-manipulation select-none ${isDragging ? "opacity-80 shadow-lg" : ""}`}
      {...(canEdit ? { ...attributes, ...listeners } : {})}
      aria-roledescription={canEdit ? "Draggable post" : undefined}
    >
      <Link
        href={`/content/w/${slug}/posts/${post.id}`}
        draggable={false}
        title={`${post.title} · ${post.statusLabel}`}
        className="block rounded-md bg-white px-1.5 py-1 text-xs shadow-xs ring-1 ring-border hover:bg-brand-50"
      >
        <span className="flex items-center gap-1">
          {post.slotLabel && <span className="shrink-0 font-semibold text-brand-700 tabular-nums">{post.slotLabel}</span>}
          <span className="truncate font-medium text-ink">{post.title}</span>
        </span>
        {!compact && (
          <span className="mt-1 block">
            <Badge tone={statusTone(post.status)}>{post.statusLabel}</Badge>
          </span>
        )}
      </Link>
    </div>
  );
}

function DayCell({
  day,
  inMonth,
  today,
  slots,
  tall,
  children,
}: {
  day: string;
  inMonth: boolean;
  today: string;
  slots: CalendarSlot[];
  tall: boolean;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `day:${day}` });
  const daySlots = slotsOn(day, slots).filter((s) => s.weekdays.length > 0);
  return (
    <div
      ref={setNodeRef}
      className={`flex min-w-0 flex-col gap-1 border-r border-b border-border p-1.5 transition-colors [&:nth-child(7n)]:border-r-0 ${
        tall ? "min-h-64" : "min-h-28"
      } ${inMonth ? "" : "bg-surface/70"} ${isOver ? "bg-brand-50" : ""}`}
    >
      <div className="flex items-center justify-between gap-1">
        <span
          className={`flex size-6 items-center justify-center rounded-full text-xs tabular-nums ${
            day === today ? "bg-brand-700 font-semibold text-white" : inMonth ? "text-ink" : "text-muted"
          }`}
        >
          {dayNumber(day)}
        </span>
        {daySlots.length > 0 && (
          <span className="truncate text-[10px] font-medium text-accent-600" title="Time slots on this day">
            {daySlots.map((s) => s.label).join(" · ")}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function Tray({ posts, canEdit, slug }: { posts: CalendarPost[]; canEdit: boolean; slug: string }) {
  const { setNodeRef, isOver } = useDroppable({ id: `day:${UNPLANNED}` });
  return (
    <div ref={setNodeRef} className={`rounded-2xl border border-dashed border-border p-3 transition-colors ${isOver ? "bg-brand-50" : "bg-card"}`}>
      <p className="mb-2 text-xs font-semibold text-muted">
        Not planned ({posts.length})
        {canEdit && <span className="font-normal"> · drag a post onto a day to plan it, or here to remove its date</span>}
      </p>
      {posts.length > 0 && (
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-4">
          {posts.slice(0, 40).map((post) => (
            <Chip key={post.id} post={post} canEdit={canEdit} slug={slug} compact={false} />
          ))}
        </div>
      )}
      {posts.length > 40 && <p className="mt-2 text-xs text-muted">and {posts.length - 40} more in Posts</p>}
    </div>
  );
}

/**
 * Posts on a week or month calendar. Drag a post to another day to
 * reschedule it: its time slot stays when it fits that weekday, otherwise
 * the first slot of the day is taken. The date field below each post in the
 * week view (and the publish panel) does the same without dragging.
 */
export function ContentCalendar({
  slug,
  view,
  days,
  month,
  today,
  posts,
  unplanned,
  slots,
  canEdit,
}: {
  slug: string;
  view: "week" | "month";
  days: string[];
  month: string;
  today: string;
  posts: CalendarPost[];
  unplanned: CalendarPost[];
  slots: CalendarSlot[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [moved, setMoved] = useState<Record<string, { plannedDate: string | null; timeSlot: string | null }>>({});
  const sensors = useSensors(
    useSensor(MouseAndPenSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: TOUCH_DELAY_MS, tolerance: TOUCH_TOLERANCE_PX } }),
  );

  const slotLabel = (value: string | null) => (value ? (slots.find((s) => s.value === value)?.label ?? null) : null);
  const all = [...posts, ...unplanned].map((p) => {
    const m = moved[p.id];
    return m ? { ...p, ...m, slotLabel: slotLabel(m.timeSlot) } : p;
  });
  const byDay = new Map<string, CalendarPost[]>();
  for (const post of all) {
    if (!post.plannedDate) continue;
    byDay.set(post.plannedDate, [...(byDay.get(post.plannedDate) ?? []), post]);
  }
  for (const list of byDay.values()) list.sort((a, b) => (a.slotLabel ?? "99").localeCompare(b.slotLabel ?? "99"));
  const tray = all.filter((p) => !p.plannedDate);

  function move(post: CalendarPost, plannedDate: string | null) {
    if (post.plannedDate === plannedDate) return;
    const timeSlot = plannedDate ? slotForDay(plannedDate, post.timeSlot, slots) : post.timeSlot;
    const previous = moved[post.id];
    setMoved((m) => ({ ...m, [post.id]: { plannedDate, timeSlot } }));
    startTransition(async () => {
      const result = await reschedulePostAction(post.id, plannedDate, timeSlot);
      if (result.error) {
        toast(result.error, { tone: "error" });
        setMoved((m) => {
          const next = { ...m };
          if (previous) next[post.id] = previous;
          else delete next[post.id];
          return next;
        });
      } else {
        router.refresh();
      }
    });
  }

  function onDragEnd(event: DragEndEvent) {
    const target = event.over?.id;
    if (typeof target !== "string" || !target.startsWith("day:")) return;
    const post = all.find((p) => p.id === event.active.id);
    if (!post) return;
    const day = target.slice(4);
    move(post, day === UNPLANNED ? null : day);
  }

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <div className={view === "week" ? "min-w-[56rem]" : "min-w-[42rem]"}>
          <div className="grid grid-cols-7 border-b border-border bg-surface/60">
            {WEEKDAYS.map((d) => (
              <div key={d} className="px-2 py-1.5 text-xs font-semibold text-muted">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {days.map((day) => (
              <DayCell key={day} day={day} inMonth={view === "week" || day.startsWith(month)} today={today} slots={slots} tall={view === "week"}>
                {(byDay.get(day) ?? []).map((post) => (
                  <div key={post.id} className="space-y-1">
                    <Chip post={post} canEdit={canEdit} slug={slug} compact={view === "month"} />
                    {view === "week" && canEdit && (
                      <label className="block">
                        <span className="sr-only">Move {post.title} to another day</span>
                        <input
                          type="date"
                          defaultValue={post.plannedDate ?? ""}
                          onChange={(e) => e.target.value && move(post, e.target.value)}
                          className="w-full rounded-md border border-border bg-white px-1 py-0.5 text-[11px] text-muted"
                        />
                      </label>
                    )}
                  </div>
                ))}
              </DayCell>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-4">
        <Tray posts={tray} canEdit={canEdit} slug={slug} />
      </div>
    </DndContext>
  );
}
