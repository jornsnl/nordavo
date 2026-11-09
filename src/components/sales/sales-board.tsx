"use client";

import { useMemo, useState } from "react";
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
  type DragEndEvent,
} from "@dnd-kit/core";
import { CalendarClock, Clock, Phone, User } from "lucide-react";
import type { CompanyRow, ContactRow } from "@/lib/sales/rows";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { kinds, type AnyRow, type GridKind } from "./grid-kinds";

// The board of the sales tables (section 2.5): one column per status or
// stage, a card per company (Leads, Pipeline) or contact (Contacts). Dragging
// a card changes the status; Lost asks for a reason first.

const PER_COLUMN = 60;

function daysSince(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.now() - new Date(value).getTime();
  return Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 86_400_000)) : null;
}

function since(value: string | null | undefined): string {
  const d = daysSince(value);
  if (d === null) return "";
  if (d === 0) return "today";
  return d === 1 ? "1 day" : `${d} days`;
}

const prioChip: Record<number, string> = {
  1: "bg-red-600 text-white",
  2: "bg-orange-100 text-orange-800",
  3: "bg-sky-100 text-sky-800",
  4: "bg-slate-100 text-slate-700",
  5: "bg-slate-100 text-slate-500",
};

type CardData = {
  id: string;
  title: string;
  href: string;
  prio: number | null;
  person: string | null;
  phone: string | null;
  lastActivity: string | null;
  nextAction: string | null;
  nextActionDate: string | null;
  inColumnSince: string | null;
};

function cardFor(kind: GridKind, row: AnyRow): CardData {
  const k = kinds[kind];
  if (kind === "contacts") {
    const c = row as ContactRow;
    return {
      id: c.id,
      title: k.title(c),
      href: k.href(c),
      prio: c.company_prio,
      person: c.company_name,
      phone: c.phone,
      lastActivity: c.last_contacted_at ?? c.last_attempt_at,
      nextAction: c.callback_at ? "Call back" : null,
      nextActionDate: c.callback_at,
      inColumnSince: c.status_changed_at,
    };
  }
  const c = row as CompanyRow;
  return {
    id: c.id,
    title: c.name,
    href: k.href(c),
    prio: c.prio,
    person: c.primary_contact?.name ?? null,
    phone: c.primary_contact?.phone ?? c.general_phone,
    lastActivity: c.last_activity_at,
    nextAction: c.next_action,
    nextActionDate: c.next_action_date,
    inColumnSince: kind === "pipeline" ? c.pipeline_stage_changed_at : c.lead_status_changed_at,
  };
}

function Card({ card, dragging }: { card: CardData; dragging?: boolean }) {
  return (
    <div className={`rounded-xl border border-border bg-white p-3 text-sm shadow-xs ${dragging ? "rotate-1 shadow-lg ring-2 ring-brand-500" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <Link href={card.href} className="min-w-0 font-semibold text-brand-900 hover:underline" onPointerDown={(e) => e.stopPropagation()}>
          <span className="line-clamp-2">{card.title}</span>
        </Link>
        {card.prio != null && (
          <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-bold ${prioChip[card.prio] ?? "bg-slate-100"}`}>P{card.prio}</span>
        )}
      </div>
      <dl className="mt-2 space-y-1 text-xs text-muted">
        {card.person && (
          <div className="flex items-center gap-1.5">
            <User className="size-3.5 shrink-0" aria-hidden="true" />
            <dt className="sr-only">Contact person</dt>
            <dd className="truncate text-ink">{card.person}</dd>
          </div>
        )}
        {card.phone && (
          <div className="flex items-center gap-1.5">
            <Phone className="size-3.5 shrink-0" aria-hidden="true" />
            <dt className="sr-only">Phone</dt>
            <dd className="truncate tabular-nums">{card.phone}</dd>
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <Clock className="size-3.5 shrink-0" aria-hidden="true" />
          <dt className="sr-only">Last activity</dt>
          <dd>{card.lastActivity ? `Last activity ${since(card.lastActivity)} ago` : "No activity yet"}</dd>
        </div>
        {card.nextAction && (
          <div className="flex items-center gap-1.5">
            <CalendarClock className="size-3.5 shrink-0" aria-hidden="true" />
            <dt className="sr-only">Next action</dt>
            <dd className="truncate text-ink">
              {card.nextAction}
              {card.nextActionDate ? `, ${card.nextActionDate}` : ""}
            </dd>
          </div>
        )}
      </dl>
      {card.inColumnSince && <p className="mt-2 text-[11px] text-muted">In this column for {since(card.inColumnSince)}</p>}
    </div>
  );
}

function Draggable({ card }: { card: CardData }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: card.id });
  return (
    <li ref={setNodeRef} {...attributes} {...listeners} className={`touch-none ${isDragging ? "opacity-40" : ""}`} aria-roledescription="Draggable card">
      <Card card={card} />
    </li>
  );
}

function Column({
  value,
  label,
  cards,
}: {
  value: string;
  label: string;
  cards: CardData[];
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${value}` });
  const [all, setAll] = useState(false);
  const shown = all ? cards : cards.slice(0, PER_COLUMN);
  return (
    <section
      ref={setNodeRef}
      aria-label={`${label}, ${cards.length}`}
      className={`flex w-72 shrink-0 snap-start flex-col rounded-2xl border bg-surface ${isOver ? "border-brand-500 ring-4 ring-brand-100" : "border-border"}`}
    >
      <header className="flex items-center justify-between px-3 py-2.5">
        <h3 className="text-sm font-semibold text-brand-900">{label}</h3>
        <span className="rounded-full bg-white px-2 py-0.5 text-xs text-muted tabular-nums ring-1 ring-border">{cards.length}</span>
      </header>
      <ul className="flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2" style={{ maxHeight: "calc(100dvh - 22rem)" }}>
        {shown.map((card) => (
          <Draggable key={card.id} card={card} />
        ))}
        {!all && cards.length > PER_COLUMN && (
          <li>
            <Button size="sm" variant="ghost" className="w-full" onClick={() => setAll(true)}>
              Show all {cards.length}
            </Button>
          </li>
        )}
      </ul>
    </section>
  );
}

export function SalesBoard({
  kind,
  rows,
  onMove,
}: {
  kind: GridKind;
  rows: AnyRow[];
  /** extra is the lost reason when a company goes to Lost. */
  onMove: (row: AnyRow, value: string, extra?: string) => void;
}) {
  const k = kinds[kind];
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor),
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const [lost, setLost] = useState<AnyRow | null>(null);
  const [reason, setReason] = useState("");

  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const grouped = useMemo(() => {
    const map = new Map<string, CardData[]>(k.board.columns.map((c) => [c.value, []]));
    for (const row of rows) {
      const value = String((row as unknown as Record<string, unknown>)[k.board.key] ?? "");
      map.get(value)?.push(cardFor(kind, row));
    }
    return map;
  }, [rows, k, kind]);

  const onDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const row = byId.get(String(event.active.id));
    const over = event.over ? String(event.over.id) : null;
    if (!row || !over?.startsWith("col:")) return;
    const value = over.slice(4);
    if (String((row as unknown as Record<string, unknown>)[k.board.key]) === value) return;
    if (kind === "pipeline" && value === "lost") {
      setReason("");
      setLost(row);
      return;
    }
    onMove(row, value);
  };

  const active = activeId ? byId.get(activeId) : null;

  return (
    <>
      <p className="sr-only">Drag a card to another column to change its {kind === "pipeline" ? "stage" : "status"}. With the keyboard: space to pick up, arrows to move, space to drop.</p>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={(e) => setActiveId(String(e.active.id))}
        onDragCancel={() => setActiveId(null)}
        onDragEnd={onDragEnd}
      >
        <div className="snap-strip flex gap-3 pb-3">
          {k.board.columns.map((col) => (
            <Column key={col.value} value={col.value} label={col.label} cards={grouped.get(col.value) ?? []} />
          ))}
        </div>
        <DragOverlay>{active ? <Card card={cardFor(kind, active)} dragging /> : null}</DragOverlay>
      </DndContext>
      <Modal open={Boolean(lost)} onClose={() => setLost(null)} title="Why was this lost?" description={lost ? k.title(lost) : undefined}>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!lost || !reason.trim()) return;
            onMove(lost, "lost", reason.trim());
            setLost(null);
          }}
        >
          <label className="block space-y-1.5 text-sm font-medium">
            Reason
            <textarea required autoFocus maxLength={2000} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} className="block w-full rounded-xl border border-border px-3 py-2 font-normal" />
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setLost(null)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!reason.trim()}>
              Move to Lost
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
