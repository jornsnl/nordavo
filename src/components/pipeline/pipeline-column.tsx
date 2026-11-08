"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ApplicationStage } from "@/lib/database.types";
import type { Tone } from "@/lib/labels";
import { SortableCard, type BoardCard, type CardAction } from "./pipeline-card";

const dotTones: Record<Tone, string> = {
  neutral: "bg-slate-400",
  brand: "bg-brand-500",
  accent: "bg-accent-500",
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  danger: "bg-danger",
};

export function PipelineColumn({
  stage,
  label,
  tone,
  cards,
  onOpen,
  onAction,
  onSelect,
  onSelectAll,
  selected,
  busy,
  dragDisabled = false,
  collapsible = false,
  collapsed = false,
  onToggle,
  hiddenCount = 0,
}: {
  stage: ApplicationStage;
  label: string;
  tone: Tone;
  cards: BoardCard[];
  onOpen: (id: string) => void;
  onAction: (id: string, action: CardAction) => void;
  onSelect: (id: string, shift: boolean) => void;
  onSelectAll: (stage: ApplicationStage) => void;
  selected: ReadonlySet<string>;
  busy: boolean;
  dragDisabled?: boolean;
  collapsible?: boolean;
  collapsed?: boolean;
  onToggle?: () => void;
  /** Cards in this stage hidden by the board filters. */
  hiddenCount?: number;
}) {
  const selectedHere = cards.filter((c) => selected.has(c.id)).length;
  const allSelected = cards.length > 0 && selectedHere === cards.length;
  const { setNodeRef, isOver } = useDroppable({ id: stage, data: { type: "column" } });
  const headingId = `column-${stage}`;

  if (collapsible && collapsed) {
    return (
      <section
        ref={setNodeRef}
        aria-labelledby={headingId}
        className={`flex w-14 shrink-0 snap-start flex-col max-lg:min-h-[60dvh] items-center gap-3 rounded-2xl border border-dashed py-3 transition ${
          isOver ? (stage === "parked" ? "border-amber-500 bg-amber-50" : "border-danger bg-danger-bg") : "border-border bg-surface/60"
        }`}
      >
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={false}
          aria-controls={`${headingId}-list`}
          aria-label={`Expand ${label}`}
          className="flex size-8 items-center justify-center rounded-lg text-muted hover:bg-white hover:text-ink active:bg-white pointer-coarse:size-10 focus-visible:outline-2 focus-visible:outline-brand-500"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
        </button>
        <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-ink tabular-nums ring-1 ring-border">
          {cards.length}
        </span>
        <h2
          id={headingId}
          className="text-xs font-semibold text-muted [writing-mode:vertical-rl]"
        >
          {label}
        </h2>
      </section>
    );
  }

  return (
    <section
      aria-labelledby={headingId}
      className={`flex shrink-0 snap-start flex-col rounded-2xl border border-border bg-surface/60 max-lg:min-h-[60dvh] ${
        collapsible ? "w-64" : "w-[17rem]"
      }`}
    >
      <header className="flex items-center justify-between gap-2 px-3 pt-3 pb-2">
        {cards.length > 0 && (
          <input
            type="checkbox"
            checked={allSelected}
            ref={(el) => {
              if (el) el.indeterminate = selectedHere > 0 && !allSelected;
            }}
            onChange={() => onSelectAll(stage)}
            aria-label={`Select all in ${label}`}
            className="size-4 shrink-0 cursor-pointer accent-brand-600 pointer-coarse:size-5"
          />
        )}
        <h2 id={headingId} className="flex min-w-0 flex-1 items-center gap-2 text-sm font-semibold text-brand-900">
          <span className={`size-2 shrink-0 rounded-full ${dotTones[tone]}`} aria-hidden="true" />
          <span className="truncate">{label}</span>
          <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-muted tabular-nums ring-1 ring-border">
            <span className="sr-only">Count: </span>
            {cards.length}
          </span>
          {hiddenCount > 0 && (
            <span className="text-xs font-normal text-muted">+{hiddenCount} hidden</span>
          )}
        </h2>
        {collapsible && (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded
            aria-controls={`${headingId}-list`}
            aria-label={`Collapse ${label}`}
            className="flex size-8 items-center justify-center rounded-lg text-muted hover:bg-white hover:text-ink active:bg-white pointer-coarse:size-10 focus-visible:outline-2 focus-visible:outline-brand-500"
          >
            <ChevronRight className="size-4" aria-hidden="true" />
          </button>
        )}
      </header>
      <SortableContext id={stage} items={cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
        <ul
          ref={setNodeRef}
          id={`${headingId}-list`}
          className={`mx-2 mb-2 flex min-h-32 flex-1 flex-col gap-2 rounded-xl p-1 transition ${
            isOver ? "bg-brand-50 ring-2 ring-brand-200" : ""
          }`}
        >
          {cards.map((card) => (
            <SortableCard
              key={card.id}
              card={card}
              onOpen={onOpen}
              onAction={onAction}
              onSelect={onSelect}
              selected={selected.has(card.id)}
              disabled={busy}
              dragDisabled={dragDisabled}
            />
          ))}
          {cards.length === 0 && (
            <li className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-border px-3 py-6 text-center text-xs text-muted">
              {hiddenCount > 0 ? "Hidden by the filters" : dragDisabled ? "Nobody here" : "Drag a candidate here"}
            </li>
          )}
        </ul>
      </SortableContext>
    </section>
  );
}
