"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCorners,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { Handshake, Plus, X } from "lucide-react";
import { moveApplication, reorderStage } from "@/app/dashboard/vacancies/[id]/pipeline/actions";
import { bulkMoveApplications } from "@/app/dashboard/vacancies/[id]/pipeline/recruitment-actions";
import type { PipelineApplication } from "@/lib/data/applications";
import type { CandidateOption } from "@/lib/data/candidates";
import type { StaffMember } from "@/lib/data/staff";
import type { ApplicationStage } from "@/lib/database.types";
import { applicationStages, optionFor } from "@/lib/labels";
import {
  applyBoardFilter,
  defaultBoardFilter,
  isExitStage,
  isFiltered,
  selectRange,
  toggleColumn,
  type BoardFilter,
  type MoveTarget,
} from "@/lib/recruitment/pipeline";
import { Button, ButtonLink } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/field";
import type { InterviewerOption } from "@/lib/data/interviews";
import { BoardFilters, BulkBar } from "./board-toolbar";
import { ExitModal, type ExitMode } from "./exit-modal";
import { OverlayCard, type BoardCard, type CardAction } from "./pipeline-card";
import { PipelineColumn } from "./pipeline-column";
import { AddCandidateModal, ApplicationModal } from "./pipeline-modals";
import { PRESENTED_STAGES, PRESENTED_TARGET, positionAt } from "./stages";

type Columns = Record<ApplicationStage, BoardCard[]>;

const STAGES = applicationStages.map((s) => s.value);

function groupByStage(applications: PipelineApplication[]): Columns {
  const columns = Object.fromEntries(STAGES.map((s) => [s, [] as BoardCard[]])) as Columns;
  for (const application of applications) columns[application.stage].push(application);
  for (const stage of STAGES) columns[stage].sort((a, b) => a.position - b.position);
  return columns;
}

function isStage(id: UniqueIdentifier): id is ApplicationStage {
  return STAGES.includes(id as ApplicationStage);
}

/**
 * A pending park or reject, waiting for the reason: a dragged card (already
 * shown in its new lane) or cards chosen from a menu or the bulk bar.
 */
type PendingExit =
  | { kind: "drag"; mode: ExitMode; card: BoardCard; position: number; orderedIds: string[]; needsRebalance: boolean }
  | { kind: "ids"; mode: ExitMode; ids: string[]; subject: string };

const FLOW = applicationStages.filter((s) => !isExitStage(s.value));
const EXITS = applicationStages.filter((s) => isExitStage(s.value));

export function PipelineBoard({
  vacancyId,
  applications,
  candidates,
  staff,
  interviewers = [],
  initialOpenId,
}: {
  vacancyId: string;
  /** Team members with a booking link, for "Plan interview" on a card. */
  interviewers?: InterviewerOption[];
  applications: PipelineApplication[];
  candidates: CandidateOption[];
  /** Team members, to pick the interviewer. */
  staff: StaffMember[];
  initialOpenId?: string;
}) {
  const [columns, setColumns] = useState<Columns>(() => groupByStage(applications));
  const [source, setSource] = useState(applications);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(initialOpenId ?? null);
  const [adding, setAdding] = useState(false);
  const [exitOpen, setExitOpen] = useState<Record<"parked" | "rejected", boolean>>({ parked: false, rejected: false });
  const [pendingExit, setPendingExit] = useState<PendingExit | null>(null);
  const [placed, setPlaced] = useState<BoardCard | null>(null);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [filter, setFilter] = useState<BoardFilter>(defaultBoardFilter);
  const [selection, setSelection] = useState<Set<string>>(() => new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  /** Where the dragged card started, to detect a real move and to undo a cancel. */
  const dragStart = useRef<{ stage: ApplicationStage; index: number; columns: Columns } | null>(null);

  // Fresh server data (after any action) replaces local state, unless a drag is in progress.
  if (source !== applications && !activeId && pendingExit?.kind !== "drag") {
    setSource(applications);
    setColumns(groupByStage(applications));
  }

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const allCards = useMemo(() => STAGES.flatMap((s) => columns[s]), [columns]);
  const cardById = (id: UniqueIdentifier | null | undefined) =>
    id ? allCards.find((c) => c.id === id) : undefined;
  const onBoardIds = useMemo(() => new Set(allCards.map((c) => c.candidate.id)), [allCards]);
  // The promise counts everyone the client has seen, also those parked or rejected later.
  const presentedCount = allCards.filter((c) => PRESENTED_STAGES.includes(c.stage) || !!c.presented_at).length;
  const filtered = isFiltered(filter);
  const visible = useMemo(
    () => Object.fromEntries(STAGES.map((s) => [s, applyBoardFilter(columns[s], filter)])) as Columns,
    [columns, filter],
  );
  const visibleOrder = useMemo(() => STAGES.flatMap((s) => visible[s].map((c) => c.id)), [visible]);
  // Cards that left the board (moved by someone else, removed) drop out of the selection.
  const selected = useMemo(
    () => new Set([...selection].filter((id) => allCards.some((c) => c.id === id))),
    [selection, allCards],
  );
  const selectedCards = allCards.filter((c) => selected.has(c.id));

  function openExitLane(stage: ApplicationStage) {
    if (stage === "parked" || stage === "rejected") setExitOpen((v) => ({ ...v, [stage]: true }));
  }

  function onSelect(id: string, shift: boolean) {
    setSelection(shift ? selectRange(visibleOrder, selected, anchor, id) : selectRange([], selected, null, id));
    setAnchor(id);
  }

  function onSelectAll(stage: ApplicationStage) {
    setSelection(toggleColumn(selected, visible[stage].map((c) => c.id)));
  }

  /** Bulk move through move_applications(); the fresh board comes back from the server. */
  function runBulk(ids: string[], stage: MoveTarget, reason?: string, parkUntil?: string) {
    if (ids.length === 0) return;
    setError(undefined);
    setMessage(undefined);
    startSaving(async () => {
      const result = await bulkMoveApplications(vacancyId, { applicationIds: ids, stage, reason, parkUntil });
      if (result.error) {
        setError(result.error);
        return;
      }
      setMessage(result.message);
      setSelection(new Set());
      if (stage === "parked" || stage === "rejected") openExitLane(stage);
    });
  }

  function askExit(mode: ExitMode, ids: string[]) {
    if (ids.length === 0) return;
    const name = ids.length === 1 ? cardById(ids[0])?.candidate.full_name : undefined;
    setPendingExit({ kind: "ids", mode, ids, subject: name ?? `${ids.length} candidates` });
  }

  function findStage(id: UniqueIdentifier): ApplicationStage | undefined {
    if (isStage(id)) return id;
    return STAGES.find((s) => columns[s].some((c) => c.id === id));
  }

  function stageLabel(stage: ApplicationStage) {
    return optionFor(applicationStages, stage).label;
  }

  /** Persist a card that already sits at its new place in `next`. */
  function commit(next: Columns, card: BoardCard, fromStage: ApplicationStage) {
    const stage = card.stage;
    const items = next[stage];
    const index = items.findIndex((c) => c.id === card.id);
    let position = positionAt(
      items.map((c) => c.position),
      index,
    );
    const prev = items[index - 1]?.position;
    const after = items[index + 1]?.position;
    // Fractions ran out (or neighbours share a position): renumber the column.
    const needsRebalance =
      (prev !== undefined && after !== undefined && !(prev < position && position < after)) ||
      (prev !== undefined && after !== undefined && after - prev < 1e-6);
    if (needsRebalance) position = (index + 1) * 1024;

    const moved: BoardCard = {
      ...card,
      position,
      presented_at:
        PRESENTED_STAGES.includes(stage) && !card.presented_at ? new Date().toISOString() : card.presented_at,
    };
    const updated: Columns = {
      ...next,
      [stage]: items.map((c, i) =>
        c.id === card.id ? moved : needsRebalance ? { ...c, position: (i + 1) * 1024 } : c,
      ),
    };
    setColumns(updated);
    const orderedIds = updated[stage].map((c) => c.id);

    if (isExitStage(stage) && fromStage !== stage) {
      setPendingExit({
        kind: "drag",
        mode: stage === "parked" ? "park" : "reject",
        card: moved,
        position,
        orderedIds,
        needsRebalance,
      });
      return;
    }
    persist(moved, position, fromStage, orderedIds, needsRebalance);
  }

  function persist(
    card: BoardCard,
    position: number,
    fromStage: ApplicationStage,
    orderedIds: string[],
    needsRebalance: boolean,
    reason?: string,
    parkUntil?: string,
  ) {
    setError(undefined);
    setMessage(undefined);
    startSaving(async () => {
      const result = await moveApplication(card.id, card.stage, position, reason, parkUntil);
      if (result.error) {
        setError(result.error);
        // Back to what the server last told us.
        setColumns(groupByStage(source));
        return;
      }
      if (needsRebalance) await reorderStage(vacancyId, card.stage, orderedIds);
      if (card.stage === "placed" && fromStage !== "placed") setPlaced(card);
    });
  }

  /** The card menu: move to a stage, park, reject or resume. */
  function onCardAction(id: string, action: CardAction) {
    if (action === "park" || action === "parked") return askExit("park", [id]);
    if (action === "reject" || action === "rejected") return askExit("reject", [id]);
    if (action === "resume") return runBulk([id], "resume");
    moveTo(id, action);
  }

  /** Non-drag fallback: move one card to the bottom of a flow stage. */
  function moveTo(id: string, stage: ApplicationStage) {
    const fromStage = findStage(id);
    const card = cardById(id);
    if (!fromStage || !card || fromStage === stage) return;
    const movedCard = { ...card, stage };
    const next: Columns = {
      ...columns,
      [fromStage]: columns[fromStage].filter((c) => c.id !== id),
      [stage]: [...columns[stage], movedCard],
    };
    commit(next, movedCard, fromStage);
  }

  function onDragStart({ active }: DragStartEvent) {
    const stage = findStage(active.id);
    if (!stage) return;
    setActiveId(String(active.id));
    setError(undefined);
    // A short buzz on phones that support it, like a native long press.
    navigator.vibrate?.(10);
    dragStart.current = {
      stage,
      index: columns[stage].findIndex((c) => c.id === active.id),
      columns,
    };
  }

  function onDragOver({ active, over }: DragOverEvent) {
    if (!over) return;
    const from = findStage(active.id);
    const to = findStage(over.id);
    if (!from || !to || from === to) return;
    openExitLane(to);

    setColumns((prev) => {
      const fromItems = prev[from];
      const toItems = prev[to];
      const card = fromItems.find((c) => c.id === active.id);
      if (!card) return prev;

      let index = toItems.length;
      if (!isStage(over.id)) {
        const overIndex = toItems.findIndex((c) => c.id === over.id);
        const translated = active.rect.current.translated;
        const below = translated ? translated.top > over.rect.top + over.rect.height / 2 : false;
        if (overIndex >= 0) index = overIndex + (below ? 1 : 0);
      }

      return {
        ...prev,
        [from]: fromItems.filter((c) => c.id !== active.id),
        [to]: [...toItems.slice(0, index), { ...card, stage: to }, ...toItems.slice(index)],
      };
    });
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    const start = dragStart.current;
    dragStart.current = null;
    setActiveId(null);
    const stage = findStage(active.id);
    if (!start || !stage || !over) {
      if (start) setColumns(start.columns);
      return;
    }

    let items = columns[stage];
    const oldIndex = items.findIndex((c) => c.id === active.id);
    if (findStage(over.id) === stage && !isStage(over.id)) {
      const newIndex = items.findIndex((c) => c.id === over.id);
      if (newIndex >= 0 && newIndex !== oldIndex) items = arrayMove(items, oldIndex, newIndex);
    }

    const finalIndex = items.findIndex((c) => c.id === active.id);
    const next = { ...columns, [stage]: items };
    if (stage === start.stage && finalIndex === start.index) {
      setColumns(next);
      return;
    }
    commit(next, items[finalIndex], start.stage);
  }

  function onDragCancel() {
    if (dragStart.current) setColumns(dragStart.current.columns);
    dragStart.current = null;
    setActiveId(null);
  }

  const announcements: Announcements = {
    onDragStart: ({ active }) => `You picked up ${cardById(active.id)?.candidate.full_name ?? "the card"}.`,
    onDragOver: ({ active, over }) => {
      const name = cardById(active.id)?.candidate.full_name ?? "The card";
      if (!over) return `${name} is not over a column.`;
      const stage = findStage(over.id);
      return stage ? `${name} is over ${stageLabel(stage)}.` : undefined;
    },
    onDragEnd: ({ active, over }) => {
      const name = cardById(active.id)?.candidate.full_name ?? "The card";
      const stage = over ? findStage(over.id) : undefined;
      return stage ? `${name} is now in ${stageLabel(stage)}.` : `${name} was put back.`;
    },
    onDragCancel: ({ active }) =>
      `Move cancelled. ${cardById(active.id)?.candidate.full_name ?? "The card"} is back in its old place.`,
  };

  const activeCard = cardById(activeId);
  const openCard = cardById(openId) ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <PresentedCounter count={presentedCount} />
        <div className="flex items-center gap-3">
          {saving && (
            <span className="text-sm text-muted max-sm:order-last" role="status">
              Saving...
            </span>
          )}
          <Button onClick={() => setAdding(true)} className="max-sm:flex-1">
            <Plus aria-hidden="true" />
            Add candidate
          </Button>
        </div>
      </div>

      <BoardFilters filter={filter} onChange={setFilter} />
      {filtered && (
        <p className="text-xs text-muted">
          Sorted or filtered: dragging is off. Use Move to, the checkboxes or clear the filters.
        </p>
      )}

      {(error || message) && (
        <div className="flex items-start gap-2">
          <div className="flex-1">
            <FormMessage error={error} success={error ? undefined : message} />
          </div>
          <button
            type="button"
            onClick={() => {
              setError(undefined);
              setMessage(undefined);
            }}
            aria-label="Close message"
            className="flex size-9 items-center justify-center rounded-lg text-muted hover:bg-brand-50 active:bg-brand-50 pointer-coarse:size-11"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      )}

      {placed && (
        <div
          role="status"
          className="flex flex-col gap-3 rounded-2xl border border-emerald-600/20 bg-emerald-50 p-4 sm:flex-row sm:items-center"
        >
          <Handshake className="hidden size-6 shrink-0 text-emerald-700 sm:block" aria-hidden="true" />
          <p className="flex-1 text-sm text-emerald-900">
            <strong>{placed.candidate.full_name}</strong> is placed. Record the placement now to start
            the contract, payroll and the guarantee period.
          </p>
          <div className="flex gap-2 max-sm:*:flex-1">
            <ButtonLink href={`/dashboard/placements/new?application=${placed.id}`} size="sm">
              Record placement
            </ButtonLink>
            <Button variant="ghost" size="sm" onClick={() => setPlaced(null)}>
              Later
            </Button>
          </div>
        </div>
      )}

      {allCards.length === 0 && (
        <p className="rounded-2xl border border-dashed border-brand-200 bg-card px-4 py-3 text-sm text-muted">
          Nobody on this board yet. Add a candidate to start the selection.
        </p>
      )}

      {/* Until lg the board scrolls sideways: jump straight to a stage. */}
      <nav aria-label="Go to stage" className="-mx-4 sm:-mx-6 lg:hidden">
        <ul className="flex snap-strip scrollbar-none gap-2 px-4 py-0.5 sm:px-6">
          {applicationStages.map((s) => (
            <li key={s.value} className="shrink-0 snap-start scroll-ml-4">
              <button
                type="button"
                onClick={() => {
                  openExitLane(s.value);
                  document
                    .getElementById(`column-${s.value}`)
                    ?.closest("section")
                    ?.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
                }}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-border bg-white px-3 text-sm font-medium whitespace-nowrap text-ink transition active:scale-95 active:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 pointer-coarse:min-h-10"
              >
                {s.label}
                <span className="text-xs text-muted tabular-nums">{columns[s.value].length}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <p className="text-xs text-muted sm:hidden">
        Press and hold a card to drag it to another stage, or choose Move to. Tick cards to move many at once.
      </p>

      <DndContext
        id={`pipeline-${vacancyId}`}
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
        accessibility={{
          announcements,
          screenReaderInstructions: {
            draggable:
              "Press space or enter to pick up the card. Move it with the arrow keys, also to another column. Press space or enter again to drop it, or escape to cancel.",
          },
        }}
      >
        <div
          className="relative -mx-4 flex snap-x snap-mandatory scroll-px-4 items-stretch gap-3 overflow-x-auto overscroll-x-contain px-4 pb-4 max-sm:scrollbar-none sm:-mx-6 sm:scroll-px-6 sm:px-6 lg:mx-0 lg:snap-none lg:scroll-px-0 lg:px-0"
          aria-label="Pipeline"
          role="region"
        >
          {FLOW.map((s) => (
            <PipelineColumn
              key={s.value}
              stage={s.value}
              label={s.label}
              tone={s.tone}
              cards={visible[s.value]}
              hiddenCount={columns[s.value].length - visible[s.value].length}
              onOpen={setOpenId}
              onAction={onCardAction}
              onSelect={onSelect}
              onSelectAll={onSelectAll}
              selected={selected}
              busy={saving}
              dragDisabled={filtered}
            />
          ))}
          {/* Apart from the flow: parked and rejected, collapsed until needed. */}
          <div aria-hidden="true" className="w-px shrink-0 self-stretch bg-border" />
          {EXITS.map((s) => {
            const lane = s.value as "parked" | "rejected";
            return (
              <PipelineColumn
                key={s.value}
                stage={s.value}
                label={s.label}
                tone={s.tone}
                cards={visible[s.value]}
                hiddenCount={columns[s.value].length - visible[s.value].length}
                onOpen={setOpenId}
                onAction={onCardAction}
                onSelect={onSelect}
                onSelectAll={onSelectAll}
                selected={selected}
                busy={saving}
                dragDisabled={filtered}
                collapsible
                collapsed={!exitOpen[lane]}
                onToggle={() => setExitOpen((v) => ({ ...v, [lane]: !v[lane] }))}
              />
            );
          })}
        </div>
        <DragOverlay>{activeCard ? <OverlayCard card={activeCard} /> : null}</DragOverlay>
      </DndContext>

      <BulkBar
        count={selected.size}
        canResume={selectedCards.some((c) => isExitStage(c.stage))}
        busy={saving}
        onMove={(stage) => runBulk([...selected], stage as MoveTarget)}
        onPark={() => askExit("park", [...selected])}
        onReject={() => askExit("reject", [...selected])}
        onResume={() => runBulk(selectedCards.filter((c) => isExitStage(c.stage)).map((c) => c.id), "resume")}
        onClear={() => setSelection(new Set())}
        sendFormHref={`/dashboard/vacancies/${vacancyId}/form/tracking?applications=${[...selected].join(",")}`}
      />

      <ApplicationModal
        card={openCard}
        staff={staff}
        interviewers={interviewers}
        onClose={() => setOpenId(null)}
        onAction={(id, action) => {
          setOpenId(null);
          onCardAction(id, action);
        }}
      />

      <ExitModal
        request={
          pendingExit
            ? {
                mode: pendingExit.mode,
                subject: pendingExit.kind === "drag" ? pendingExit.card.candidate.full_name : pendingExit.subject,
              }
            : null
        }
        onCancel={() => {
          if (pendingExit?.kind === "drag") setColumns(groupByStage(source));
          setPendingExit(null);
        }}
        onConfirm={({ reason, parkUntil }) => {
          if (!pendingExit) return;
          const pending = pendingExit;
          setPendingExit(null);
          if (pending.kind === "drag") {
            const { card, position, orderedIds, needsRebalance } = pending;
            persist(card, position, card.stage, orderedIds, needsRebalance, reason || undefined, parkUntil);
          } else {
            runBulk(pending.ids, pending.mode === "park" ? "parked" : "rejected", reason || undefined, parkUntil);
          }
        }}
      />

      <AddCandidateModal
        open={adding}
        onClose={() => setAdding(false)}
        vacancyId={vacancyId}
        candidates={candidates}
        onBoardIds={onBoardIds}
      />
    </div>
  );
}

function PresentedCounter({ count }: { count: number }) {
  const done = count >= PRESENTED_TARGET;
  return (
    <div className="flex items-center gap-3">
      <div className="flex gap-1" aria-hidden="true">
        {Array.from({ length: PRESENTED_TARGET }, (_, i) => (
          <span
            key={i}
            className={`h-2 w-8 rounded-full ${i < count ? (done ? "bg-emerald-500" : "bg-accent-500") : "bg-brand-100"}`}
          />
        ))}
      </div>
      <p className="text-sm font-medium text-ink">
        {count} of {PRESENTED_TARGET} presented
        {count > PRESENTED_TARGET && <span className="text-muted"> (more than promised)</span>}
      </p>
    </div>
  );
}
