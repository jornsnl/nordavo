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
import { moveApplication, reorderStage } from "@/app/dashboard/vacatures/[id]/pipeline/actions";
import type { PipelineApplication } from "@/lib/data/applications";
import type { CandidateOption } from "@/lib/data/candidates";
import type { ApplicationStage } from "@/lib/database.types";
import { applicationStages, optionFor } from "@/lib/labels";
import { Button, ButtonLink } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/field";
import { OverlayCard, type BoardCard } from "./pipeline-card";
import { PipelineColumn } from "./pipeline-column";
import { AddCandidateModal, ApplicationModal, RejectModal } from "./pipeline-modals";
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

/** A pending move into "rejected", waiting for the optional reason. */
type PendingReject = { card: BoardCard; position: number; orderedIds: string[]; needsRebalance: boolean };

export function PipelineBoard({
  vacancyId,
  applications,
  candidates,
  initialOpenId,
}: {
  vacancyId: string;
  applications: PipelineApplication[];
  candidates: CandidateOption[];
  initialOpenId?: string;
}) {
  const [columns, setColumns] = useState<Columns>(() => groupByStage(applications));
  const [source, setSource] = useState(applications);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(initialOpenId ?? null);
  const [adding, setAdding] = useState(false);
  const [rejectedOpen, setRejectedOpen] = useState(false);
  const [pendingReject, setPendingReject] = useState<PendingReject | null>(null);
  const [placed, setPlaced] = useState<BoardCard | null>(null);
  const [error, setError] = useState<string>();
  const [saving, startSaving] = useTransition();
  /** Where the dragged card started, to detect a real move and to undo a cancel. */
  const dragStart = useRef<{ stage: ApplicationStage; index: number; columns: Columns } | null>(null);

  // Fresh server data (after any action) replaces local state, unless a drag is in progress.
  if (source !== applications && !activeId && !pendingReject) {
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
  const presentedCount = allCards.filter((c) => PRESENTED_STAGES.includes(c.stage)).length;

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
        stage === "presented" && !card.presented_at ? new Date().toISOString() : card.presented_at,
    };
    const updated: Columns = {
      ...next,
      [stage]: items.map((c, i) =>
        c.id === card.id ? moved : needsRebalance ? { ...c, position: (i + 1) * 1024 } : c,
      ),
    };
    setColumns(updated);
    const orderedIds = updated[stage].map((c) => c.id);

    if (stage === "rejected" && fromStage !== "rejected") {
      setPendingReject({ card: moved, position, orderedIds, needsRebalance });
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
    rejectionReason?: string,
  ) {
    setError(undefined);
    startSaving(async () => {
      const result = await moveApplication(card.id, card.stage, position, rejectionReason);
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

  /** Non-drag fallback: the "Verplaats naar" select on each card. */
  function moveTo(id: string, stage: ApplicationStage) {
    const fromStage = findStage(id);
    const card = cardById(id);
    if (!fromStage || !card || fromStage === stage) return;
    if (stage === "rejected") setRejectedOpen(true);
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
    if (to === "rejected") setRejectedOpen(true);

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
    onDragStart: ({ active }) => `Je pakt ${cardById(active.id)?.candidate.full_name ?? "de kaart"} op.`,
    onDragOver: ({ active, over }) => {
      const name = cardById(active.id)?.candidate.full_name ?? "De kaart";
      if (!over) return `${name} is niet boven een kolom.`;
      const stage = findStage(over.id);
      return stage ? `${name} is boven ${stageLabel(stage)}.` : undefined;
    },
    onDragEnd: ({ active, over }) => {
      const name = cardById(active.id)?.candidate.full_name ?? "De kaart";
      const stage = over ? findStage(over.id) : undefined;
      return stage ? `${name} staat nu in ${stageLabel(stage)}.` : `${name} is teruggezet.`;
    },
    onDragCancel: ({ active }) =>
      `Verplaatsen geannuleerd. ${cardById(active.id)?.candidate.full_name ?? "De kaart"} staat weer op de oude plek.`,
  };

  const activeCard = cardById(activeId);
  const openCard = cardById(openId) ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <PresentedCounter count={presentedCount} />
        <div className="flex items-center gap-3">
          {saving && (
            <span className="text-sm text-muted" role="status">
              Opslaan...
            </span>
          )}
          <Button onClick={() => setAdding(true)}>
            <Plus aria-hidden="true" />
            Kandidaat toevoegen
          </Button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2">
          <div className="flex-1">
            <FormMessage error={error} />
          </div>
          <button
            type="button"
            onClick={() => setError(undefined)}
            aria-label="Melding sluiten"
            className="flex size-9 items-center justify-center rounded-lg text-muted hover:bg-brand-50"
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
            <strong>{placed.candidate.full_name}</strong> is geplaatst. Leg nu de plaatsing vast, dan starten
            contract, payroll en de garantieperiode.
          </p>
          <div className="flex gap-2">
            <ButtonLink href={`/dashboard/plaatsingen/nieuw?application=${placed.id}`} size="sm">
              Plaatsing vastleggen
            </ButtonLink>
            <Button variant="ghost" size="sm" onClick={() => setPlaced(null)}>
              Later
            </Button>
          </div>
        </div>
      )}

      {allCards.length === 0 && (
        <p className="rounded-2xl border border-dashed border-brand-200 bg-card px-4 py-3 text-sm text-muted">
          Nog niemand op dit bord. Voeg een kandidaat toe om de selectie te starten.
        </p>
      )}

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
              "Druk op spatie of enter om de kaart op te pakken. Verplaats met de pijltjestoetsen, ook naar een andere kolom. Druk nogmaals op spatie of enter om neer te zetten, of op escape om te annuleren.",
          },
        }}
      >
        <div
          className="relative -mx-4 flex snap-x snap-mandatory items-stretch gap-3 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6 lg:mx-0 lg:snap-none lg:px-0"
          aria-label="Pipeline"
          role="region"
        >
          {applicationStages.map((s) => (
            <PipelineColumn
              key={s.value}
              stage={s.value}
              label={s.label}
              tone={s.tone}
              cards={columns[s.value]}
              onOpen={setOpenId}
              onMoveTo={moveTo}
              busy={saving}
              collapsible={s.value === "rejected"}
              collapsed={s.value === "rejected" && !rejectedOpen}
              onToggle={() => setRejectedOpen((v) => !v)}
            />
          ))}
        </div>
        <DragOverlay>{activeCard ? <OverlayCard card={activeCard} /> : null}</DragOverlay>
      </DndContext>

      <ApplicationModal card={openCard} onClose={() => setOpenId(null)} />

      <RejectModal
        name={pendingReject?.card.candidate.full_name ?? null}
        onCancel={() => {
          setPendingReject(null);
          setColumns(groupByStage(source));
        }}
        onConfirm={(reason) => {
          if (!pendingReject) return;
          const { card, position, orderedIds, needsRebalance } = pendingReject;
          setPendingReject(null);
          persist(card, position, "rejected", orderedIds, needsRebalance, reason || undefined);
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
        {count} van {PRESENTED_TARGET} voorgesteld
        {count > PRESENTED_TARGET && <span className="text-muted"> (meer dan beloofd)</span>}
      </p>
    </div>
  );
}
