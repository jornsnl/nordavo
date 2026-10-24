"use client";

import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import Link from "next/link";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Clock, GripVertical, Handshake } from "lucide-react";
import type { PipelineApplication } from "@/lib/data/applications";
import type { ApplicationStage } from "@/lib/database.types";
import { applicationStages, clientDecisions, optionFor } from "@/lib/labels";
import { Badge } from "@/components/ui/badge";
import { PRESENTED_STAGES } from "./stages";

export type BoardCard = PipelineApplication;

type CardProps = {
  card: BoardCard;
  onOpen?: (id: string) => void;
  onMoveTo?: (id: string, stage: ApplicationStage) => void;
  disabled?: boolean;
};

/** A draggable card. Mouse and touch drag the whole card, the keyboard uses the grip. */
export function SortableCard(props: CardProps) {
  const { card } = props;
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: card.id, data: { stage: card.stage } });

  const { onKeyDown, ...pointerListeners } = listeners ?? {};
  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      {...(pointerListeners as HTMLAttributes<HTMLLIElement>)}
      className={`touch-manipulation ${isDragging ? "opacity-40" : ""}`}
    >
      <CardBody
        {...props}
        handle={
          <button
            type="button"
            ref={setActivatorNodeRef}
            {...attributes}
            onKeyDown={onKeyDown as HTMLAttributes<HTMLButtonElement>["onKeyDown"]}
            aria-label={`Verplaats ${card.candidate.full_name}`}
            className="-m-1 flex size-8 shrink-0 cursor-grab items-center justify-center rounded-lg text-muted hover:bg-brand-50 hover:text-brand-700 focus-visible:outline-2 focus-visible:outline-brand-500 active:cursor-grabbing"
          >
            <GripVertical className="size-4" aria-hidden="true" />
          </button>
        }
      />
    </li>
  );
}

/** The floating copy that follows the pointer while dragging. */
export function OverlayCard({ card }: { card: BoardCard }) {
  return (
    <div className="rotate-2 cursor-grabbing">
      <CardBody
        card={card}
        lifted
        handle={
          <span className="-m-1 flex size-8 items-center justify-center text-muted">
            <GripVertical className="size-4" aria-hidden="true" />
          </span>
        }
      />
    </div>
  );
}

function CardBody({
  card,
  onOpen,
  onMoveTo,
  disabled,
  handle,
  lifted = false,
}: CardProps & { handle: ReactNode; lifted?: boolean }) {
  const { candidate } = card;
  const presented = PRESENTED_STAGES.includes(card.stage) || !!card.presented_at;
  const decision = optionFor(clientDecisions, card.client_decision);
  const selectId = `move-${card.id}`;

  return (
    <article
      className={`rounded-xl border bg-white p-3 text-sm transition ${
        lifted ? "border-brand-300 shadow-xl" : "border-border shadow-xs hover:border-brand-200"
      }`}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => onOpen?.(card.id)}
            className="block max-w-full truncate rounded text-left font-semibold text-brand-900 hover:text-brand-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
          >
            {candidate.full_name}
          </button>
          <p className="truncate text-xs text-muted">
            {candidate.current_title ?? "Functie onbekend"}
            {candidate.years_experience !== null && `, ${candidate.years_experience} jr`}
          </p>
        </div>
        {handle}
      </div>

      {candidate.skills.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1" aria-label="Skills">
          {candidate.skills.slice(0, 3).map((skill) => (
            <li key={skill}>
              <Badge>{skill}</Badge>
            </li>
          ))}
          {candidate.skills.length > 3 && (
            <li>
              <Badge tone="brand">+{candidate.skills.length - 3}</Badge>
            </li>
          )}
        </ul>
      )}

      <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
        <Score label="Techniek" value={card.technical_score} />
        <Score label="Engels" value={card.english_score} />
      </dl>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1 text-xs text-muted">
          <Clock className="size-3.5" aria-hidden="true" />
          {card.daysInPipeline === 1 ? "1 dag" : `${card.daysInPipeline} dagen`}
        </span>
        {presented && <Badge tone={decision.tone}>{decision.label}</Badge>}
      </div>

      {card.stage === "placed" && !lifted && (
        <Link
          href={`/dashboard/plaatsingen/nieuw?application=${card.id}`}
          className="mt-2 inline-flex items-center gap-1.5 rounded text-xs font-semibold text-emerald-700 hover:underline focus-visible:outline-2 focus-visible:outline-brand-500"
        >
          <Handshake className="size-3.5" aria-hidden="true" />
          Plaatsing vastleggen
        </Link>
      )}

      {onMoveTo && (
        <div className="mt-3 border-t border-border pt-2">
          <label htmlFor={selectId} className="sr-only">
            Verplaats {candidate.full_name} naar
          </label>
          <select
            id={selectId}
            value=""
            disabled={disabled}
            onMouseDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onChange={(e) => {
              const stage = e.target.value as ApplicationStage;
              if (stage) onMoveTo(card.id, stage);
            }}
            className="w-full rounded-lg border border-transparent bg-surface px-2 py-1 text-xs text-muted hover:border-border focus:border-brand-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-100"
          >
            <option value="">Verplaats naar...</option>
            {applicationStages
              .filter((s) => s.value !== card.stage)
              .map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
          </select>
        </div>
      )}
    </article>
  );
}

function Score({ label, value }: { label: string; value: number | null }) {
  const tone =
    value === null ? "text-muted" : value >= 75 ? "text-emerald-700" : value >= 55 ? "text-amber-700" : "text-danger";
  return (
    <div className="rounded-lg bg-surface px-2 py-1">
      <dt className="text-[11px] text-muted">{label}</dt>
      <dd className={`font-semibold tabular-nums ${tone}`}>{value ?? "nvt"}</dd>
    </div>
  );
}
