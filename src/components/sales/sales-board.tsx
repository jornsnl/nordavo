"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  DndContext,
  DragOverlay,
  useDraggable,
  useDroppable,
  type DragEndEvent,
} from "@dnd-kit/core";
import { Briefcase, CalendarClock, Clock, PauseCircle, Phone, Send, User } from "lucide-react";
import { columnUnderPointer, swallowClickAfterTouchDrag, useDragSensors } from "@/components/ui/dnd";
import { Button } from "@/components/ui/button";
import { daysOpen, type CompanyRow, type CompanyVacancy, type ContactRow } from "@/lib/sales/rows";
import { kinds, type AnyRow, type GridKind } from "./grid-kinds";
import { LostReasonDialog, ParkDialog } from "./lost-reason-dialog";

// The board of the sales tables (section 2.5): one column per status or
// stage, a card per company (Leads, Pipeline) or contact (Contacts). Dragging
// a card changes the status. On the pipeline, Lost and Parked sit apart as
// ways off it from any stage: Lost asks for a reason, Parked for a date.

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
  /** Pipeline only. */
  stage?: string | null;
  vacancies?: CompanyVacancy[];
  profilesDueOn?: string | null;
  parkedUntil?: string | null;
};

/** Days from today to a YYYY-MM-DD date; negative is in the past. */
function daysUntil(date: string): number {
  const today = new Date().toISOString().slice(0, 10);
  return Math.round((new Date(`${date}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) / 86_400_000);
}

function dueText(date: string): { text: string; late: boolean; soon: boolean } {
  const d = daysUntil(date);
  if (d < 0) return { text: `Send profiles by ${date}, ${-d} ${-d === 1 ? "day" : "days"} late`, late: true, soon: false };
  if (d === 0) return { text: `Send profiles today (${date})`, late: false, soon: true };
  return { text: `Send profiles by ${date}, in ${d} ${d === 1 ? "day" : "days"}`, late: false, soon: d <= 3 };
}

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
    ...(kind === "pipeline"
      ? { stage: c.pipeline_stage, vacancies: c.open_vacancies, profilesDueOn: c.profiles_due_on, parkedUntil: c.parked_until }
      : {}),
  };
}

const VACANCIES_SHOWN = 3;

function Vacancies({ list }: { list: CompanyVacancy[] }) {
  if (list.length === 0) return null;
  const oldest = daysOpen(list[0].openedAt);
  return (
    <div className="mt-2 rounded-lg bg-surface px-2 py-1.5 text-xs">
      <p className="flex items-center gap-1.5 font-medium text-ink">
        <Briefcase className="size-3.5 shrink-0" aria-hidden="true" />
        {list.length} open {list.length === 1 ? "vacancy" : "vacancies"}
        {oldest != null && <span className="font-normal text-muted">, oldest {oldest === 1 ? "1 day" : `${oldest} days`}</span>}
      </p>
      <ul className="mt-1 space-y-0.5">
        {list.slice(0, VACANCIES_SHOWN).map((v) => (
          <li key={v.id} className="flex justify-between gap-2">
            <Link
              href={`/dashboard/vacancies/${v.id}`}
              className="truncate text-brand-700 hover:underline"
              onPointerDown={(e) => e.stopPropagation()}
            >
              {v.title}
            </Link>
            <span className="shrink-0 text-muted tabular-nums">{daysOpen(v.openedAt) ?? 0}d</span>
          </li>
        ))}
        {list.length > VACANCIES_SHOWN && <li className="text-muted">and {list.length - VACANCIES_SHOWN} more</li>}
      </ul>
    </div>
  );
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
        {card.stage === "agreed_paid" && card.profilesDueOn && (() => {
          const due = dueText(card.profilesDueOn);
          return (
            <div className={`flex items-center gap-1.5 ${due.late ? "font-semibold text-danger" : due.soon ? "text-amber-800" : "text-ink"}`}>
              <Send className="size-3.5 shrink-0" aria-hidden="true" />
              <dt className="sr-only">Send profiles on</dt>
              <dd>{due.text}</dd>
            </div>
          );
        })()}
        {card.stage === "parked" && card.parkedUntil && (
          <div className="flex items-center gap-1.5 text-ink">
            <PauseCircle className="size-3.5 shrink-0" aria-hidden="true" />
            <dt className="sr-only">Parked until</dt>
            <dd>Get in touch again on {card.parkedUntil}</dd>
          </div>
        )}
      </dl>
      {card.vacancies && <Vacancies list={card.vacancies} />}
      {card.stage === "won" && (
        <p className="mt-2 text-[11px] text-muted">
          Onboarding goes on in{" "}
          <Link href="/dashboard/placements" className="text-brand-700 hover:underline" onPointerDown={(e) => e.stopPropagation()}>
            Placements
          </Link>
        </p>
      )}
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
  description,
  cards,
  exit = false,
}: {
  value: string;
  label: string;
  description?: string;
  cards: CardData[];
  /** A way off the pipeline: dashed, with its cards folded away until asked. */
  exit?: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${value}` });
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState(!exit);
  const shown = !open ? [] : all ? cards : cards.slice(0, PER_COLUMN);
  return (
    <section
      ref={setNodeRef}
      aria-label={`${label}, ${cards.length}`}
      className={`flex shrink-0 snap-start flex-col rounded-2xl border ${exit ? "w-60 border-dashed bg-white" : "w-72 bg-surface"} ${isOver ? "border-brand-500 ring-4 ring-brand-100" : "border-border"}`}
    >
      <header className="px-3 py-2.5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-brand-900">{label}</h3>
          <span className="rounded-full bg-white px-2 py-0.5 text-xs text-muted tabular-nums ring-1 ring-border">{cards.length}</span>
        </div>
        {description && <p className="mt-0.5 text-[11px] leading-snug text-muted">{description}</p>}
      </header>
      <ul className="flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2" style={{ maxHeight: "calc(100dvh - 22rem)" }}>
        {exit && cards.length > 0 && (
          <li>
            <Button size="sm" variant="ghost" className="w-full" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
              {open ? "Hide" : `Show ${cards.length}`}
            </Button>
          </li>
        )}
        {exit && cards.length === 0 && <li className="px-1 text-xs text-muted">Drop a card here from any stage.</li>}
        {shown.map((card) => (
          <Draggable key={card.id} card={card} />
        ))}
        {open && !all && cards.length > PER_COLUMN && (
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
  /** extra holds the lost reason or the parked date when a company goes there. */
  onMove: (row: AnyRow, value: string, extra?: { lost_reason?: string; parked_until?: string }) => void;
}) {
  const k = kinds[kind];
  const sensors = useDragSensors();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [lost, setLost] = useState<AnyRow | null>(null);
  const [parked, setParked] = useState<AnyRow | null>(null);

  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const grouped = useMemo(() => {
    const map = new Map<string, CardData[]>([...k.board.columns, ...(k.board.exits ?? [])].map((c) => [c.value, []]));
    for (const row of rows) {
      const value = String((row as unknown as Record<string, unknown>)[k.board.key] ?? "");
      map.get(value)?.push(cardFor(kind, row));
    }
    return map;
  }, [rows, k, kind]);

  const onDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    swallowClickAfterTouchDrag(event.activatorEvent);
    const row = byId.get(String(event.active.id));
    const over = event.over ? String(event.over.id) : null;
    if (!row || !over?.startsWith("col:")) return;
    const value = over.slice(4);
    if (String((row as unknown as Record<string, unknown>)[k.board.key]) === value) return;
    if (kind === "pipeline" && value === "lost") {
      setLost(row);
      return;
    }
    if (kind === "pipeline" && value === "parked") {
      setParked(row);
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
        collisionDetection={columnUnderPointer({ isColumn: (c) => String(c.id).startsWith("col:") })}
        onDragStart={(e) => setActiveId(String(e.active.id))}
        onDragCancel={() => setActiveId(null)}
        onDragEnd={onDragEnd}
      >
        <div className="snap-strip flex gap-3 pb-3">
          {k.board.columns.map((col) => (
            <Column key={col.value} value={col.value} label={col.label} description={col.description} cards={grouped.get(col.value) ?? []} />
          ))}
          {k.board.exits && (
            <div role="group" aria-label="Off the pipeline, from any stage" className="ml-2 flex shrink-0 gap-3 border-l border-border pl-5">
              {k.board.exits.map((col) => (
                <Column
                  key={col.value}
                  value={col.value}
                  label={col.label}
                  description={col.description}
                  cards={grouped.get(col.value) ?? []}
                  exit
                />
              ))}
            </div>
          )}
        </div>
        <DragOverlay>{active ? <Card card={cardFor(kind, active)} dragging /> : null}</DragOverlay>
      </DndContext>
      <LostReasonDialog
        open={Boolean(lost)}
        description={lost ? k.title(lost) : undefined}
        onCancel={() => setLost(null)}
        onConfirm={(reason) => {
          if (lost) onMove(lost, "lost", { lost_reason: reason });
          setLost(null);
        }}
      />
      <ParkDialog
        open={Boolean(parked)}
        description={parked ? k.title(parked) : undefined}
        onCancel={() => setParked(null)}
        onConfirm={(date) => {
          if (parked) onMove(parked, "parked", { parked_until: date });
          setParked(null);
        }}
      />
    </>
  );
}
