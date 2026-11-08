"use client";

import { useId } from "react";
import { Ban, ListChecks, PauseCircle, RotateCcw, Search, Star, X } from "lucide-react";
import type { ApplicationStage } from "@/lib/database.types";
import { applicationStages, candidateOrigins, candidateSources } from "@/lib/labels";
import {
  boardSorts,
  defaultBoardFilter,
  isExitStage,
  isFiltered,
  type BoardFilter,
  type BoardSort,
} from "@/lib/recruitment/pipeline";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";

/** Search, sort and filters above the board. Sorting or filtering turns dragging off. */
export function BoardFilters({ filter, onChange }: { filter: BoardFilter; onChange: (next: BoardFilter) => void }) {
  const id = useId();
  const set = <K extends keyof BoardFilter>(key: K, value: BoardFilter[K]) => onChange({ ...filter, [key]: value });
  const toggle =
    "inline-flex min-h-10 items-center gap-1.5 rounded-xl border px-3 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-brand-500";

  return (
    <div
      role="search"
      aria-label="Filter the board"
      className="grid grid-cols-2 gap-2 rounded-2xl border border-border bg-card p-3 shadow-xs md:flex md:flex-wrap md:items-center"
    >
      <div className="relative col-span-2 md:min-w-56 md:flex-1">
        <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
        <label htmlFor={`${id}-q`} className="sr-only">
          Search by name, title or skill
        </label>
        <Input
          id={`${id}-q`}
          type="search"
          value={filter.query}
          onChange={(e) => set("query", e.target.value)}
          placeholder="Search on this board"
          className="pl-10"
        />
      </div>
      <div>
        <label htmlFor={`${id}-sort`} className="sr-only">
          Sort
        </label>
        <Select id={`${id}-sort`} value={filter.sort} onChange={(e) => set("sort", e.target.value as BoardSort)}>
          {boardSorts.map((s) => (
            <option key={s.value} value={s.value}>
              {s.value === "board" ? "Sort: board order" : `Sort: ${s.label.toLowerCase()}`}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <label htmlFor={`${id}-origin`} className="sr-only">
          Origin
        </label>
        <Select
          id={`${id}-origin`}
          value={filter.origin}
          onChange={(e) => set("origin", e.target.value as BoardFilter["origin"])}
        >
          <option value="all">Applied and headhunted</option>
          {candidateOrigins.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label} only
            </option>
          ))}
        </Select>
      </div>
      <div>
        <label htmlFor={`${id}-source`} className="sr-only">
          Source
        </label>
        <Select
          id={`${id}-source`}
          value={filter.source}
          onChange={(e) => set("source", e.target.value as BoardFilter["source"])}
        >
          <option value="all">All sources</option>
          {candidateSources.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </Select>
      </div>
      <button
        type="button"
        aria-pressed={filter.shortlistedOnly}
        onClick={() => set("shortlistedOnly", !filter.shortlistedOnly)}
        className={`${toggle} ${filter.shortlistedOnly ? "border-brand-500 bg-brand-50 text-brand-800" : "border-border bg-white text-ink"}`}
      >
        <ListChecks className="size-4" aria-hidden="true" />
        Shortlist
      </button>
      <button
        type="button"
        aria-pressed={filter.toppersOnly}
        onClick={() => set("toppersOnly", !filter.toppersOnly)}
        className={`${toggle} ${filter.toppersOnly ? "border-amber-500 bg-amber-50 text-amber-900" : "border-border bg-white text-ink"}`}
      >
        <Star className={`size-4 ${filter.toppersOnly ? "fill-amber-400 text-amber-500" : ""}`} aria-hidden="true" />
        Toppers
      </button>
      {isFiltered(filter) && (
        <Button variant="ghost" onClick={() => onChange(defaultBoardFilter)} className="col-span-2 md:col-span-1">
          <X aria-hidden="true" />
          Clear
        </Button>
      )}
    </div>
  );
}

const flowStages = applicationStages.filter((s) => !isExitStage(s.value));

/** Appears while cards are selected: move, park, reject or resume them all at once. */
export function BulkBar({
  count,
  canResume,
  busy,
  onMove,
  onPark,
  onReject,
  onResume,
  onClear,
}: {
  count: number;
  canResume: boolean;
  busy: boolean;
  onMove: (stage: ApplicationStage) => void;
  onPark: () => void;
  onReject: () => void;
  onResume: () => void;
  onClear: () => void;
}) {
  const id = useId();
  if (count === 0) return null;
  return (
    <div
      role="region"
      aria-label="Selected candidates"
      className="sticky bottom-[calc(env(safe-area-inset-bottom)+5rem)] z-20 flex flex-wrap items-center gap-2 rounded-2xl border border-brand-200 bg-white/95 p-3 shadow-xl backdrop-blur lg:bottom-4"
    >
      <p className="mr-auto text-sm font-semibold text-brand-900" aria-live="polite">
        {count === 1 ? "1 selected" : `${count} selected`}
      </p>
      <div className="max-sm:w-full">
        <label htmlFor={`${id}-move`} className="sr-only">
          Move the selected candidates to
        </label>
        <Select
          id={`${id}-move`}
          value=""
          disabled={busy}
          onChange={(e) => {
            if (e.target.value) onMove(e.target.value as ApplicationStage);
          }}
        >
          <option value="">Move to stage...</option>
          {flowStages.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex gap-2 max-sm:w-full max-sm:*:flex-1">
        <Button variant="secondary" size="sm" onClick={onPark} disabled={busy}>
          <PauseCircle aria-hidden="true" />
          Park
        </Button>
        <Button variant="secondary" size="sm" onClick={onReject} disabled={busy}>
          <Ban aria-hidden="true" />
          Reject
        </Button>
        {canResume && (
          <Button variant="secondary" size="sm" onClick={onResume} disabled={busy}>
            <RotateCcw aria-hidden="true" />
            Resume
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={onClear} aria-label="Clear the selection">
          <X aria-hidden="true" />
          <span className="sm:hidden">Clear</span>
        </Button>
      </div>
    </div>
  );
}
