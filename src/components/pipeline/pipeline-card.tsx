"use client";

import type { CSSProperties, HTMLAttributes, MouseEvent, ReactNode } from "react";
import Link from "next/link";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  CalendarClock,
  Clock,
  FileCheck2,
  FileClock,
  GripVertical,
  Handshake,
  ListChecks,
  RotateCcw,
  ShieldCheck,
  Star,
} from "lucide-react";
import type { PipelineApplication } from "@/lib/data/applications";
import type { ApplicationStage } from "@/lib/database.types";
import { formatDate, formatDateTime } from "@/lib/format";
import {
  applicationStages,
  backgroundCheckStatuses,
  candidateSources,
  clientDecisions,
  cvVerdicts,
  optionFor,
} from "@/lib/labels";
import { formStatus, isExitStage } from "@/lib/recruitment/pipeline";
import { Badge } from "@/components/ui/badge";
import { PRESENTED_STAGES } from "./stages";

export type BoardCard = PipelineApplication;

/** What the card menu can do besides moving to a flow stage. */
export type CardAction = ApplicationStage | "park" | "reject" | "resume";

type CardProps = {
  card: BoardCard;
  onOpen?: (id: string) => void;
  onAction?: (id: string, action: CardAction) => void;
  /** Checkbox: shift held selects the range from the last clicked card. */
  onSelect?: (id: string, shift: boolean) => void;
  selected?: boolean;
  disabled?: boolean;
  dragDisabled?: boolean;
};

/** A draggable card. Mouse and touch drag the whole card, the keyboard uses the grip. */
export function SortableCard(props: CardProps) {
  const { card, dragDisabled } = props;
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: card.id, data: { stage: card.stage }, disabled: dragDisabled });

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
      // No text selection or iOS callout on the long press that starts a drag.
      className={`touch-manipulation select-none [-webkit-touch-callout:none] md:select-auto ${isDragging ? "opacity-40" : ""}`}
    >
      <CardBody
        {...props}
        handle={
          dragDisabled ? null : (
            <button
              type="button"
              ref={setActivatorNodeRef}
              {...attributes}
              onKeyDown={onKeyDown as HTMLAttributes<HTMLButtonElement>["onKeyDown"]}
              aria-label={`Move ${card.candidate.full_name}`}
              className="-m-1 flex size-8 shrink-0 cursor-grab items-center justify-center rounded-lg text-muted hover:bg-brand-50 hover:text-brand-700 active:bg-brand-50 focus-visible:outline-2 focus-visible:outline-brand-500 active:cursor-grabbing"
            >
              <GripVertical className="size-4" aria-hidden="true" />
            </button>
          )
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

function stopDrag(event: { stopPropagation: () => void }) {
  event.stopPropagation();
}

const noDrag = { onMouseDown: stopDrag, onTouchStart: stopDrag, onPointerDown: stopDrag };

function CardBody({
  card,
  onOpen,
  onAction,
  onSelect,
  selected = false,
  disabled,
  handle,
  lifted = false,
}: CardProps & { handle: ReactNode; lifted?: boolean }) {
  const { candidate } = card;
  const presented = PRESENTED_STAGES.includes(card.stage) || !!card.presented_at;
  const decision = optionFor(clientDecisions, card.client_decision);
  const exit = isExitStage(card.stage);
  const selectId = `move-${card.id}`;
  const form = formStatus(card);
  const background = optionFor(backgroundCheckStatuses, card.background_check_status);

  return (
    <article
      className={`rounded-xl border bg-white p-3 text-sm transition ${
        lifted
          ? "border-brand-300 shadow-xl"
          : selected
            ? "border-brand-500 shadow-xs ring-2 ring-brand-100"
            : "border-border shadow-xs hover:border-brand-200"
      }`}
    >
      <div className="flex items-start gap-2">
        {onSelect && (
          <input
            type="checkbox"
            checked={selected}
            {...noDrag}
            onClick={(event: MouseEvent<HTMLInputElement>) => onSelect(card.id, event.shiftKey)}
            onChange={() => {}}
            aria-label={`Select ${candidate.full_name}`}
            className="mt-1 size-4 shrink-0 cursor-pointer rounded border-border accent-brand-600 pointer-coarse:size-5"
          />
        )}
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => onOpen?.(card.id)}
            className="flex max-w-full items-center gap-1 rounded text-left font-semibold text-brand-900 hover:text-brand-700 hover:underline active:text-brand-700 pointer-coarse:py-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
          >
            {candidate.is_topper && (
              <Star className="size-3.5 shrink-0 fill-amber-400 text-amber-500" aria-label="Topper" />
            )}
            <span className="truncate">{candidate.full_name}</span>
          </button>
          <p className="truncate text-xs text-muted">
            {candidate.current_title ?? "Title unknown"}
            {candidate.years_experience !== null && `, ${candidate.years_experience} yrs`}
          </p>
        </div>
        {handle}
      </div>

      {exit && <ExitInfo card={card} />}

      <ul className="mt-2 flex flex-wrap gap-1" aria-label="Details">
        {card.origin === "headhunted" && (
          <li>
            <Badge tone="accent">Headhunted</Badge>
          </li>
        )}
        {card.source && card.source !== "headhunted" && (
          <li>
            <Badge>{optionFor(candidateSources, card.source).label}</Badge>
          </li>
        )}
        {form !== "not_sent" && (
          <li>
            <Badge tone={form === "completed" ? "success" : "warning"}>
              {form === "completed" ? (
                <FileCheck2 className="size-3" aria-hidden="true" />
              ) : (
                <FileClock className="size-3" aria-hidden="true" />
              )}
              {form === "completed" ? "Form done" : "Form sent"}
            </Badge>
          </li>
        )}
        {card.shortlisted_at && (
          <li>
            <Badge tone="brand">
              <ListChecks className="size-3" aria-hidden="true" />
              Shortlist
            </Badge>
          </li>
        )}
        {card.background_check_status !== "not_started" && (
          <li>
            <Badge tone={background.tone}>
              <ShieldCheck className="size-3" aria-hidden="true" />
              Check: {background.label.toLowerCase()}
            </Badge>
          </li>
        )}
      </ul>

      <dl className="mt-2 grid grid-cols-3 gap-1.5 text-xs">
        <Score
          label="CV"
          value={card.cv_score}
          hint={card.cv_verdict ? optionFor(cvVerdicts, card.cv_verdict).label : undefined}
        />
        <Score label="Video" value={card.video_score} />
        <Score label="Test" value={card.testScore ?? card.technical_score} />
      </dl>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1 text-xs text-muted">
          <Clock className="size-3.5" aria-hidden="true" />
          {card.daysInPipeline === 1 ? "1 day" : `${card.daysInPipeline} days`}
        </span>
        {card.interview_at && (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-brand-700">
            <CalendarClock className="size-3.5" aria-hidden="true" />
            <span className="sr-only">Interview </span>
            {formatDateTime(card.interview_at)}
          </span>
        )}
        {presented && !exit && <Badge tone={decision.tone}>{decision.label}</Badge>}
      </div>

      {card.stage === "placed" && !lifted && (
        <Link
          href={`/dashboard/placements/new?application=${card.id}`}
          className="mt-2 inline-flex items-center gap-1.5 rounded text-xs font-semibold text-emerald-700 hover:underline pointer-coarse:min-h-9 focus-visible:outline-2 focus-visible:outline-brand-500"
        >
          <Handshake className="size-3.5" aria-hidden="true" />
          Record placement
        </Link>
      )}

      {onAction && (
        <div className="mt-3 flex items-center gap-2 border-t border-border pt-2">
          {exit && (
            <button
              type="button"
              {...noDrag}
              disabled={disabled}
              onClick={() => onAction(card.id, "resume")}
              className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-brand-50 px-2 py-1 text-xs font-semibold text-brand-700 hover:bg-brand-100 disabled:opacity-60 pointer-coarse:min-h-10 focus-visible:outline-2 focus-visible:outline-brand-500"
            >
              <RotateCcw className="size-3.5" aria-hidden="true" />
              Resume
            </button>
          )}
          <label htmlFor={selectId} className="sr-only">
            Move {candidate.full_name} to
          </label>
          <select
            id={selectId}
            value=""
            disabled={disabled}
            {...noDrag}
            onChange={(e) => {
              const value = e.target.value as CardAction;
              if (value) onAction(card.id, value);
            }}
            className="w-full min-w-0 rounded-lg border border-transparent bg-surface px-2 py-1 text-xs text-muted pointer-coarse:min-h-10 hover:border-border focus:border-brand-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-100"
          >
            <option value="">Move to...</option>
            <optgroup label="Stage">
              {applicationStages
                .filter((s) => s.value !== card.stage && !isExitStage(s.value))
                .map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
            </optgroup>
            <optgroup label="Apart from the flow">
              {card.stage !== "parked" && <option value="park">Park...</option>}
              {card.stage !== "rejected" && <option value="reject">Reject...</option>}
            </optgroup>
          </select>
        </div>
      )}
    </article>
  );
}

/** Parked or rejected: why, from which stage, and when to look again. */
function ExitInfo({ card }: { card: BoardCard }) {
  const parked = card.stage === "parked";
  const reason = parked ? card.park_reason : card.rejection_reason;
  const left = card.exit_from_stage ? optionFor(applicationStages, card.exit_from_stage).label : null;
  return (
    <div
      className={`mt-2 space-y-0.5 rounded-lg px-2 py-1.5 text-xs ${parked ? "bg-amber-50 text-amber-900" : "bg-danger-bg text-ink"}`}
    >
      <p className="line-clamp-3 whitespace-pre-line">{reason || <span className="text-muted">No reason given.</span>}</p>
      <p className="text-muted">
        {left ? `Left at ${left}` : "Stage unknown"}
        {parked && card.park_until && `. Look again on ${formatDate(card.park_until)}`}
      </p>
    </div>
  );
}

function Score({ label, value, hint }: { label: string; value: number | null; hint?: string }) {
  const tone =
    value === null ? "text-muted" : value >= 75 ? "text-emerald-700" : value >= 55 ? "text-amber-700" : "text-danger";
  return (
    <div className="min-w-0 rounded-lg bg-surface px-2 py-1" title={hint}>
      <dt className="truncate text-[11px] text-muted">{label}</dt>
      <dd className={`font-semibold tabular-nums ${tone}`}>
        {value ?? "n/a"}
        {hint && <span className="sr-only">, {hint}</span>}
      </dd>
    </div>
  );
}
