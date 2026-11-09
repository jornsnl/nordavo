"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  Columns3,
  Filter as FilterIcon,
  GripVertical,
  KanbanSquare,
  ListRestart,
  Pin,
  PinOff,
  Rows3,
  Save,
  Search,
  Table2,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import type { Json } from "@/lib/database.types";
import { applyView, parseTsv, positionBetween, toTsv, type ColumnFilter, type SortRule, type ViewConfig } from "@/lib/sales/grid";
import type { ColumnDef, CompanyRow, ContactRow } from "@/lib/sales/rows";
import { accessorsFor } from "@/lib/sales/rows";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { applyEdits, deleteView, saveView, setPositions, type Edit } from "./actions";
import { CellEditor, CellView, displayText, editText } from "./cell";
import { ColumnChooser, Chips, FilterEditor } from "./grid-toolbar";
import { kinds, type AnyRow, type GridKind } from "./grid-kinds";
import { LostReasonDialog } from "./lost-reason-dialog";
import { SalesBoard } from "./sales-board";
import { AssignCallersDialog, type CallerOption } from "@/components/calls/assign-callers-dialog";

const ROW_H = 36;
const LEAD_W = 76; // checkbox, pin and drag handle
const OVERSCAN = 12;

export type GridView = { id: string; name: string; config: ViewConfig; isCallList: boolean; isShared: boolean };

/** One changed cell, with its old value for undo. */
type Change = { row: AnyRow; column: ColumnDef<AnyRow>; value: unknown; old: unknown };

type Range = { r1: number; c1: number; r2: number; c2: number };

/** The changes that move a company without a lost reason to Lost. */
function lostRows(changes: Change[]): Change[] {
  if (changes.some((c) => c.column.field === "lost_reason" && c.value)) return [];
  return changes.filter(
    (c) => c.column.field === "pipeline_stage" && c.value === "lost" && c.old !== "lost" && !(c.row as CompanyRow).lost_reason,
  );
}

/** Written next to the stage when a company goes to Lost from the table. */
const lostReasonColumn: ColumnDef<AnyRow> = {
  key: "lost_reason",
  label: "Lost reason",
  type: "text",
  field: "lost_reason",
  entity: "company",
  get: (r) => (r as CompanyRow).lost_reason,
};

function rowKey(row: AnyRow) {
  return row.id;
}

function companyIdOf(kind: GridKind, row: AnyRow): string {
  return kind === "contacts" ? (row as ContactRow).company_id : row.id;
}

/** Writes value into the row field the column reads (the column key). */
function patchRow(row: AnyRow, key: string, value: unknown): AnyRow {
  return { ...row, [key]: value } as AnyRow;
}

function rawValue(row: AnyRow, column: ColumnDef<AnyRow>): unknown {
  return (row as unknown as Record<string, unknown>)[column.key] ?? null;
}

/**
 * The sales table (feedback Julius, sections 2.3 to 2.5): edit cells like a
 * spreadsheet, sort on several columns, filter every column, show, hide,
 * move and widen columns, save views, select rows and change them at once,
 * copy and paste with Excel, undo, pin rows on top, drag rows into a manual
 * order, and switch to a board with one click.
 */
export function SalesWorkspace({
  kind,
  rows: initialRows,
  views: initialViews,
  initialViewId,
  initialMode = "table",
  bulkActions,
  emptyText,
  callers,
}: {
  kind: GridKind;
  /** Active callers, only for admins: opens selected rows for callers (2.10). */
  callers?: CallerOption[];
  rows: AnyRow[];
  views: GridView[];
  initialViewId: string | null;
  initialMode?: "table" | "board";
  /** Extra buttons for the selected rows (for example assign to callers). */
  bulkActions?: (selected: AnyRow[], clear: () => void) => ReactNode;
  emptyText?: string;
}) {
  const k = kinds[kind];
  const router = useRouter();
  const searchParams = useSearchParams();
  const [rows, setRows] = useState(initialRows);
  const [views, setViews] = useState(initialViews);
  const [viewId, setViewId] = useState<string | null>(initialViewId);
  const savedConfig = useMemo<ViewConfig>(
    () => views.find((v) => v.id === viewId)?.config ?? { filters: [], sort: [] },
    [views, viewId],
  );
  const [config, setConfig] = useState<ViewConfig>(savedConfig);
  const [mode, setMode] = useState<"table" | "board">(initialMode);
  const [message, setMessage] = useState<{ tone: "error" | "ok"; text: string } | null>(null);
  const [undoStack, setUndoStack] = useState<Change[][]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const [saveAs, setSaveAs] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [filterColumn, setFilterColumn] = useState<string | null>(null);

  // New rows from the server (after a refresh) replace the local copy.
  const [serverRows, setServerRows] = useState(initialRows);
  if (serverRows !== initialRows) {
    setServerRows(initialRows);
    setRows(initialRows);
  }

  const dirty = JSON.stringify(config) !== JSON.stringify(savedConfig);

  const allColumns = k.columns;
  const visibleKeys = useMemo(() => {
    const keys = config.columns?.filter((key) => allColumns.some((c) => c.key === key));
    return keys && keys.length > 0 ? keys : allColumns.filter((c) => c.defaultVisible).map((c) => c.key);
  }, [config.columns, allColumns]);
  const columns = useMemo(
    () => visibleKeys.map((key) => allColumns.find((c) => c.key === key)).filter((c): c is ColumnDef<AnyRow> => Boolean(c)),
    [visibleKeys, allColumns],
  );
  const accessors = useMemo(() => accessorsFor(allColumns), [allColumns]);
  const viewRows = useMemo(
    () =>
      applyView(rows, config, {
        accessors,
        defaultSort: k.defaultSort,
        pinnedAt: (r) => r.pinned_at,
        manualPosition: (r) => r.manual_position,
        searchColumns: visibleKeys,
      }),
    [rows, config, accessors, k.defaultSort, visibleKeys],
  );

  const flash = (tone: "error" | "ok", text: string) => setMessage({ tone, text });

  /** Applies changes locally at once and saves them; reverts and reports on failure. */
  const commit = useCallback(
    (changes: Change[], options: { recordUndo?: boolean } = {}) => {
      const real = changes.filter(
        (c) => c.column.field && c.column.entity && JSON.stringify(c.value ?? null) !== JSON.stringify(c.old ?? null),
      );
      if (real.length === 0) return;

      const apply = (list: Change[], pick: (c: Change) => unknown) =>
        setRows((prev) => {
          let next = prev;
          for (const c of list) {
            const entity = c.column.entity!;
            const target = k.idFor(c.row, entity);
            next = next.map((r) => {
              const hit = entity === "company" ? companyIdOf(kind, r) === target : r.id === target;
              if (hit) return patchRow(r, c.column.key, pick(c));
              // One primary contact per company.
              if (c.column.field === "is_primary" && pick(c) === true && kind === "contacts" && (r as ContactRow).company_id === (c.row as ContactRow).company_id) {
                return patchRow(r, "is_primary", false);
              }
              return r;
            });
          }
          return next;
        });

      apply(real, (c) => c.value);

      // Group into as few calls as possible: same entity and same fields.
      const perRecord = new Map<string, { entity: "company" | "contact"; id: string; fields: Record<string, Json> }>();
      for (const c of real) {
        const entity = c.column.entity!;
        const id = k.idFor(c.row, entity);
        const key = `${entity}:${id}`;
        const entry = perRecord.get(key) ?? { entity, id, fields: {} };
        entry.fields[c.column.field!] = (c.value ?? null) as Json;
        perRecord.set(key, entry);
      }
      const grouped = new Map<string, Edit>();
      for (const entry of perRecord.values()) {
        const key = `${entry.entity}:${JSON.stringify(entry.fields)}`;
        const edit = grouped.get(key) ?? { entity: entry.entity, ids: [], fields: entry.fields };
        edit.ids.push(entry.id);
        grouped.set(key, edit);
      }

      startTransition(async () => {
        const result = await applyEdits([...grouped.values()]);
        if (!result.ok) {
          apply(real, (c) => c.old);
          flash("error", result.error);
          return;
        }
        if (options.recordUndo !== false) setUndoStack((s) => [...s.slice(-49), real]);
        setMessage(null);
      });
    },
    [k, kind],
  );

  // Lost needs a reason (section 2.5): a cell, paste or bulk edit that sets
  // the stage to Lost waits for the reason dialog, like the board does.
  const [lostChanges, setLostChanges] = useState<Change[] | null>(null);
  const commitChecked = useCallback(
    (changes: Change[]) => {
      if (lostRows(changes).length > 0) {
        setLostChanges(changes);
        return;
      }
      commit(changes);
    },
    [commit],
  );
  const confirmLost = (reason: string) => {
    const changes = lostChanges ?? [];
    setLostChanges(null);
    const reasons: Change[] = lostRows(changes).map((c) => ({
      row: c.row,
      column: lostReasonColumn,
      value: reason,
      old: (c.row as CompanyRow).lost_reason ?? null,
    }));
    commit([...reasons, ...changes]);
  };

  const undo = useCallback(() => {
    const last = undoStack.at(-1);
    if (!last) return;
    setUndoStack((stack) => stack.slice(0, -1));
    commit(
      last.map((c) => ({ ...c, value: c.old, old: c.value })),
      { recordUndo: false },
    );
    flash("ok", last.length === 1 ? "Change undone." : `${last.length} changes undone.`);
  }, [commit, undoStack]);

  const selectView = (id: string | null) => {
    setViewId(id);
    const next = views.find((v) => v.id === id)?.config ?? { filters: [], sort: [] };
    setConfig(next);
    setSelected(new Set());
    const params = new URLSearchParams(searchParams.toString());
    if (id) params.set("view", id);
    else params.delete("view");
    router.replace(`?${params.toString()}`, { scroll: false });
  };

  const setModeAndUrl = (next: "table" | "board") => {
    setMode(next);
    const params = new URLSearchParams(searchParams.toString());
    if (next === "board") params.set("mode", "board");
    else params.delete("mode");
    router.replace(`?${params.toString()}`, { scroll: false });
  };

  const persistView = (input: { name: string; isCallList: boolean; isShared: boolean; asNew: boolean }) => {
    startTransition(async () => {
      const current = views.find((v) => v.id === viewId);
      const result = await saveView({
        id: input.asNew ? undefined : (viewId ?? undefined),
        entity: kind,
        name: input.name,
        config,
        isCallList: input.isCallList,
        isShared: input.isShared,
      });
      if (!result.ok) return flash("error", result.error);
      const saved: GridView = { id: result.id, name: input.name, config, isCallList: input.isCallList, isShared: input.isShared };
      setViews((prev) => (input.asNew || !current ? [...prev, saved] : prev.map((v) => (v.id === saved.id ? saved : v))));
      setViewId(result.id);
      const params = new URLSearchParams(searchParams.toString());
      params.set("view", result.id);
      router.replace(`?${params.toString()}`, { scroll: false });
      flash("ok", input.isCallList ? `Call list "${input.name}" saved.` : `View "${input.name}" saved.`);
      setSaveAs(false);
    });
  };

  const removeView = () => {
    if (!viewId) return;
    const current = views.find((v) => v.id === viewId);
    if (!current || !window.confirm(`Delete the view "${current.name}"? The rows stay as they are.`)) return;
    startTransition(async () => {
      const result = await deleteView(viewId);
      if (!result.ok) return flash("error", result.error);
      setViews((prev) => prev.filter((v) => v.id !== viewId));
      selectView(null);
      flash("ok", "View deleted.");
    });
  };

  const setFilter = (column: string, filter: ColumnFilter | null) =>
    setConfig((c) => ({
      ...c,
      filters: [...c.filters.filter((f) => f.column !== column), ...(filter ? [filter] : [])],
    }));

  const togglePin = (row: AnyRow) => {
    const column: ColumnDef<AnyRow> = { key: "pinned_at", label: "Pinned", type: "datetime", field: "pinned_at", entity: k.rowEntity, get: (r) => r.pinned_at };
    commit([{ row, column, value: row.pinned_at ? null : new Date().toISOString(), old: row.pinned_at }]);
  };

  /** Stores a dragged order. The first drag in a view numbers every row of it. */
  const moveRow = (fromId: string, toIndex: number) => {
    const list = viewRows.filter((r) => r.id !== fromId);
    const moving = viewRows.find((r) => r.id === fromId);
    if (!moving) return;
    list.splice(toIndex, 0, moving);
    const needsAll = list.some((r) => r.manual_position == null);
    let ids: string[];
    let positions: number[];
    if (needsAll) {
      ids = list.map((r) => r.id);
      positions = list.map((_, i) => (i + 1) * 1024);
    } else {
      const before = list[toIndex - 1]?.manual_position;
      const after = list[toIndex + 1]?.manual_position;
      ids = [moving.id];
      positions = [positionBetween(before, after)];
    }
    const byId = new Map(ids.map((id, i) => [id, positions[i]]));
    const previous = new Map(rows.map((r) => [r.id, r.manual_position]));
    setRows((prev) => prev.map((r) => (byId.has(r.id) ? ({ ...r, manual_position: byId.get(r.id)! } as AnyRow) : r)));
    startTransition(async () => {
      const result = await setPositions({ entity: k.rowEntity, ids, positions, moved: moving.id });
      if (!result.ok) {
        setRows((prev) => prev.map((r) => (byId.has(r.id) ? ({ ...r, manual_position: previous.get(r.id) ?? null } as AnyRow) : r)));
        flash("error", result.error);
      }
    });
  };

  const selectedRows = useMemo(() => viewRows.filter((r) => selected.has(r.id)), [viewRows, selected]);
  const manual = Boolean(config.manualOrder) && config.sort.length === 0;
  const current = views.find((v) => v.id === viewId);

  return (
    <div className="space-y-3">
      {/* Views */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={`${kind}-view`}>
          View
        </label>
        <select
          id={`${kind}-view`}
          value={viewId ?? ""}
          onChange={(e) => selectView(e.target.value || null)}
          className="h-9 max-w-64 rounded-xl border border-border bg-white px-3 text-sm font-medium"
        >
          <option value="">All {k.noun}</option>
          {views.map((v) => (
            <option key={v.id} value={v.id}>
              {v.isCallList ? `Call list: ${v.name}` : v.name}
            </option>
          ))}
        </select>
        {current && dirty && (
          <Button size="sm" onClick={() => persistView({ name: current.name, isCallList: current.isCallList, isShared: current.isShared, asNew: false })} disabled={pending}>
            <Save aria-hidden="true" />
            Save view
          </Button>
        )}
        <Button size="sm" variant="secondary" onClick={() => setSaveAs(true)}>
          <Save aria-hidden="true" />
          {kind === "contacts" ? "Save as view or call list" : "Save as view"}
        </Button>
        {current && (
          <Button size="sm" variant="ghost" onClick={removeView} aria-label={`Delete view ${current.name}`}>
            <Trash2 aria-hidden="true" />
          </Button>
        )}
        <div className="ml-auto flex items-center gap-1 rounded-xl border border-border bg-white p-0.5" role="group" aria-label="Layout">
          <button
            type="button"
            onClick={() => setModeAndUrl("table")}
            aria-pressed={mode === "table"}
            className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium ${mode === "table" ? "bg-brand-700 text-white" : "text-brand-800 hover:bg-brand-50"}`}
          >
            <Table2 className="size-4" aria-hidden="true" />
            Table
          </button>
          <button
            type="button"
            onClick={() => setModeAndUrl("board")}
            aria-pressed={mode === "board"}
            className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium ${mode === "board" ? "bg-brand-700 text-white" : "text-brand-800 hover:bg-brand-50"}`}
          >
            <KanbanSquare className="size-4" aria-hidden="true" />
            Board
          </button>
        </div>
      </div>

      {/* Search, columns, order */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1 sm:max-w-80">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
          <input
            type="search"
            aria-label={`Search ${k.noun}`}
            placeholder={`Search ${k.noun}`}
            value={config.search ?? ""}
            onChange={(e) => setConfig((c) => ({ ...c, search: e.target.value || undefined }))}
            className="h-9 w-full rounded-xl border border-border bg-white pr-3 pl-9 text-sm"
          />
        </div>
        {mode === "table" && (
          <>
        <Button size="sm" variant="secondary" onClick={() => setChoosing(true)}>
          <Columns3 aria-hidden="true" />
          Columns
        </Button>
        <Button
          size="sm"
          variant={manual ? "primary" : "secondary"}
          onClick={() => setConfig((c) => ({ ...c, sort: [], manualOrder: !manual }))}
          title="Drag rows into your own order"
        >
          <Rows3 aria-hidden="true" />
          {manual ? "Manual order on" : "Manual order"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setConfig((c) => ({ ...c, sort: [], manualOrder: false }))}
          disabled={config.sort.length === 0 && !config.manualOrder}
          title="Back to the standard order"
        >
          <ListRestart aria-hidden="true" />
          Standard order
        </Button>
          </>
        )}
        <Button size="sm" variant="ghost" onClick={undo} disabled={undoStack.length === 0 || pending} title="Undo the last change (Ctrl+Z)">
          <Undo2 aria-hidden="true" />
          Undo
        </Button>
        <span className="text-xs text-muted tabular-nums" aria-live="polite">
          {viewRows.length === rows.length ? `${rows.length} ${k.noun}` : `${viewRows.length} of ${rows.length} ${k.noun}`}
          {pending ? ", saving" : ""}
        </span>
      </div>

      <Chips
        filters={config.filters}
        sort={config.sort}
        columns={allColumns}
        onRemoveFilter={(i) => setConfig((c) => ({ ...c, filters: c.filters.filter((_, j) => j !== i) }))}
        onEditFilter={(column) => setFilterColumn(column)}
        onRemoveSort={(i) => setConfig((c) => ({ ...c, sort: c.sort.filter((_, j) => j !== i) }))}
        onFlipSort={(i) =>
          setConfig((c) => ({ ...c, sort: c.sort.map((s, j) => (j === i ? { ...s, dir: s.dir === "asc" ? "desc" : "asc" } : s)) }))
        }
      />

      {message && (
        <p
          role={message.tone === "error" ? "alert" : "status"}
          className={`flex items-start justify-between gap-3 rounded-xl border px-3 py-2 text-sm ${
            message.tone === "error" ? "border-danger/20 bg-danger-bg text-danger" : "border-emerald-600/20 bg-emerald-50 text-emerald-800"
          }`}
        >
          {message.text}
          <button type="button" onClick={() => setMessage(null)} aria-label="Dismiss">
            <X className="size-4" />
          </button>
        </p>
      )}

      {selectedRows.length > 0 && (
        <BulkBar
          kind={kind}
          selected={selectedRows}
          columns={allColumns}
          onClear={() => setSelected(new Set())}
          onApply={(column, value) => commitChecked(selectedRows.map((row) => ({ row, column, value, old: rawValue(row, column) })))}
          onPin={(pin) => {
            const column: ColumnDef<AnyRow> = { key: "pinned_at", label: "Pinned", type: "datetime", field: "pinned_at", entity: k.rowEntity, get: (r) => r.pinned_at };
            const now = new Date().toISOString();
            commit(selectedRows.map((row) => ({ row, column, value: pin ? now : null, old: row.pinned_at })));
          }}
          extra={
            <>
              {callers && callers.length > 0 && kind !== "pipeline" && (
                <AssignCallersDialog
                  callers={callers}
                  contactIds={kind === "contacts" ? selectedRows.map((r) => r.id) : undefined}
                  companyIds={kind === "companies" ? selectedRows.map((r) => r.id) : undefined}
                  onDone={(result) => {
                    if (result.ok) {
                      setSelected(new Set());
                      router.refresh();
                    }
                  }}
                />
              )}
              {bulkActions?.(selectedRows, () => setSelected(new Set()))}
            </>
          }
        />
      )}

      {mode === "table" ? (
        <Grid
          kind={kind}
          rows={viewRows}
          columns={columns}
          config={config}
          setConfig={setConfig}
          selected={selected}
          setSelected={setSelected}
          manual={manual}
          onCommit={commitChecked}
          onUndo={undo}
          onPin={togglePin}
          onMove={moveRow}
          onFilter={(key) => setFilterColumn(key)}
          onError={(text) => flash("error", text)}
          emptyText={emptyText}
        />
      ) : (
        <SalesBoard kind={kind} rows={viewRows} onMove={(row, value, extra) => {
          const column = allColumns.find((c) => c.key === k.board.key)!;
          const changes: Change[] = [{ row, column, value, old: rawValue(row, column) }];
          if (extra) {
            const reason = allColumns.find((c) => c.key === "lost_reason");
            if (reason) changes.unshift({ row, column: reason, value: extra, old: rawValue(row, reason) });
          }
          commit(changes);
        }} />
      )}

      <LostReasonDialog
        open={Boolean(lostChanges)}
        description={
          lostChanges
            ? (() => {
                const names = [...new Set(lostRows(lostChanges).map((c) => k.title(c.row)))];
                return names.length === 1 ? names[0] : `${names.length} companies`;
              })()
            : undefined
        }
        onCancel={() => setLostChanges(null)}
        onConfirm={confirmLost}
      />

      {saveAs && (
        <SaveViewDialog
          kind={kind}
          initialName={current ? `${current.name} (copy)` : ""}
          pending={pending}
          onClose={() => setSaveAs(false)}
          onSave={(name, isCallList, isShared) => persistView({ name, isCallList, isShared, asNew: true })}
        />
      )}
      {choosing && (
        <ColumnChooser
          columns={allColumns}
          visible={visibleKeys}
          onChange={(next) => setConfig((c) => ({ ...c, columns: next }))}
          onClose={() => setChoosing(false)}
        />
      )}
      {filterColumn && allColumns.find((c) => c.key === filterColumn) && (
        <FilterEditor
          column={allColumns.find((c) => c.key === filterColumn)!}
          current={config.filters.find((f) => f.column === filterColumn)}
          onApply={(f) => setFilter(filterColumn, f)}
          onClose={() => setFilterColumn(null)}
        />
      )}
    </div>
  );
}

function SaveViewDialog({
  kind,
  initialName,
  pending,
  onClose,
  onSave,
}: {
  kind: GridKind;
  initialName: string;
  pending: boolean;
  onClose: () => void;
  onSave: (name: string, isCallList: boolean, isShared: boolean) => void;
}) {
  const [name, setName] = useState(initialName);
  const [callList, setCallList] = useState(false);
  const [shared, setShared] = useState(true);
  return (
    <Modal open onClose={onClose} title="Save view" description="Saves the filters, sort, columns and order.">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) onSave(name.trim(), callList, shared);
        }}
      >
        <label className="block space-y-1.5 text-sm font-medium">
          Name
          <input autoFocus required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} className="block w-full rounded-xl border border-border px-3 py-2 font-normal" />
        </label>
        {kind === "contacts" && (
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5" checked={callList} onChange={(e) => setCallList(e.target.checked)} />
            <span>
              <span className="font-medium">Use as call list</span>
              <span className="block text-muted">Callers work through it on the call screen, in this order. Open it for callers under Call lists.</span>
            </span>
          </label>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
          Visible for the whole team
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending || !name.trim()}>
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function BulkBar({
  kind,
  selected,
  columns,
  onClear,
  onApply,
  onPin,
  extra,
}: {
  kind: GridKind;
  selected: AnyRow[];
  columns: ColumnDef<AnyRow>[];
  onClear: () => void;
  onApply: (column: ColumnDef<AnyRow>, value: unknown) => void;
  onPin: (pin: boolean) => void;
  extra?: ReactNode;
}) {
  const editable = columns.filter((c) => c.field && c.parse && c.key !== "name");
  const [key, setKey] = useState(editable[0]?.key ?? "");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const column = editable.find((c) => c.key === key);
  const prio = columns.find((c) => c.key === (kind === "contacts" ? "company_prio" : "prio"));

  const apply = () => {
    if (!column?.parse) return;
    const parsed = column.parse(text);
    if ("error" in parsed) return setError(parsed.error);
    setError(null);
    onApply(column, parsed.value);
  };

  return (
    <div className="sticky top-14 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-brand-200 bg-brand-50 px-3 py-2 text-sm lg:top-2" role="region" aria-label="Selected rows">
      <span className="font-semibold text-brand-900 tabular-nums">{selected.length} selected</span>
      {prio && (
        <span className="flex items-center gap-1" role="group" aria-label="Set prio">
          {(prio.options ?? []).map((o) => (
            <button key={o.value} type="button" onClick={() => onApply(prio, Number(o.value))} className="rounded-lg border border-border bg-white px-2 py-1 text-xs font-semibold hover:border-brand-500">
              {o.label}
            </button>
          ))}
        </span>
      )}
      <select aria-label="Field to change" value={key} onChange={(e) => { setKey(e.target.value); setText(""); setError(null); }} className="h-8 rounded-lg border border-border bg-white px-2 text-sm">
        {editable.map((c) => (
          <option key={c.key} value={c.key}>
            {c.label}
          </option>
        ))}
      </select>
      {column?.type === "select" || column?.type === "boolean" ? (
        <select aria-label="New value" value={text} onChange={(e) => setText(e.target.value)} className="h-8 rounded-lg border border-border bg-white px-2 text-sm">
          <option value="">(empty)</option>
          {(column.type === "boolean" ? [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }] : (column.options ?? [])).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <input aria-label="New value" type={column?.type === "date" ? "date" : "text"} value={text} onChange={(e) => setText(e.target.value)} className="h-8 w-44 rounded-lg border border-border bg-white px-2 text-sm" />
      )}
      <Button size="sm" onClick={apply}>
        Apply to {selected.length}
      </Button>
      <Button size="sm" variant="secondary" onClick={() => onPin(true)}>
        <Pin aria-hidden="true" />
        Pin
      </Button>
      <Button size="sm" variant="secondary" onClick={() => onPin(false)}>
        <PinOff aria-hidden="true" />
        Unpin
      </Button>
      {extra}
      <Button size="sm" variant="ghost" onClick={onClear}>
        Clear selection
      </Button>
      {error && <span className="w-full text-xs font-medium text-danger">{error}</span>}
    </div>
  );
}

function Grid({
  kind,
  rows,
  columns,
  config,
  setConfig,
  selected,
  setSelected,
  manual,
  onCommit,
  onUndo,
  onPin,
  onMove,
  onFilter,
  onError,
  emptyText,
}: {
  kind: GridKind;
  rows: AnyRow[];
  columns: ColumnDef<AnyRow>[];
  config: ViewConfig;
  setConfig: React.Dispatch<React.SetStateAction<ViewConfig>>;
  selected: Set<string>;
  setSelected: React.Dispatch<React.SetStateAction<Set<string>>>;
  manual: boolean;
  onCommit: (changes: Change[]) => void;
  onUndo: () => void;
  onPin: (row: AnyRow) => void;
  onMove: (rowId: string, toIndex: number) => void;
  onFilter: (key: string) => void;
  onError: (text: string) => void;
  emptyText?: string;
}) {
  const k = kinds[kind];
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(600);
  const [active, setActive] = useState<{ r: number; c: number } | null>(null);
  const [anchor, setAnchor] = useState<{ r: number; c: number } | null>(null);
  const [editing, setEditing] = useState<{ r: number; c: number; initial: string } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const lastClicked = useRef<number | null>(null);

  const widths = columns.map((c) => config.widths?.[c.key] ?? c.width ?? 140);
  const totalWidth = LEAD_W + widths.reduce((a, b) => a + b, 0);
  const filtered = new Set(config.filters.map((f) => f.column));

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setHeight(el.clientHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Keep the active cell inside the table when rows or columns change.
  const safeActive = active && active.r < rows.length && active.c < columns.length ? active : null;
  const range: Range | null = safeActive
    ? {
        r1: Math.min(safeActive.r, anchor?.r ?? safeActive.r),
        r2: Math.max(safeActive.r, anchor?.r ?? safeActive.r),
        c1: Math.min(safeActive.c, anchor?.c ?? safeActive.c),
        c2: Math.max(safeActive.c, anchor?.c ?? safeActive.c),
      }
    : null;

  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const last = Math.min(rows.length, Math.ceil((scrollTop + height) / ROW_H) + OVERSCAN);

  const scrollIntoView = (r: number) => {
    const el = scrollRef.current;
    if (!el) return;
    const top = r * ROW_H;
    const header = ROW_H;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ROW_H + header > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW_H + header - el.clientHeight;
  };

  const moveTo = (r: number, c: number, extend = false) => {
    const nr = Math.max(0, Math.min(rows.length - 1, r));
    const nc = Math.max(0, Math.min(columns.length - 1, c));
    if (!extend) setAnchor({ r: nr, c: nc });
    setActive({ r: nr, c: nc });
    scrollIntoView(nr);
  };

  const startEdit = (r: number, c: number, initial?: string) => {
    const column = columns[c];
    const row = rows[r];
    if (!column?.field || !column.parse || !row) return;
    if (column.type === "boolean" && initial === undefined) {
      onCommit([{ row, column, value: !column.get(row), old: rawValue(row, column) }]);
      return;
    }
    setEditing({ r, c, initial: initial ?? editText(column, row) });
  };

  const commitText = (r: number, c: number, text: string) => {
    const column = columns[c];
    const row = rows[r];
    if (!column?.parse || !row) return;
    const parsed = column.parse(text);
    if ("error" in parsed) return onError(`${column.label}: ${parsed.error}`);
    onCommit([{ row, column, value: parsed.value, old: rawValue(row, column) }]);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (editing) return;
    const mod = event.ctrlKey || event.metaKey;
    if (mod && event.key.toLowerCase() === "z") {
      event.preventDefault();
      onUndo();
      return;
    }
    if (!safeActive) {
      if (["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Enter"].includes(event.key) && rows.length > 0) {
        event.preventDefault();
        moveTo(0, 0);
      }
      return;
    }
    const { r, c } = safeActive;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (event.altKey && manual) return onMove(rows[r].id, Math.min(rows.length - 1, r + 1)), moveTo(r + 1, c);
        return moveTo(r + 1, c, event.shiftKey);
      case "ArrowUp":
        event.preventDefault();
        if (event.altKey && manual) return onMove(rows[r].id, Math.max(0, r - 1)), moveTo(r - 1, c);
        return moveTo(r - 1, c, event.shiftKey);
      case "ArrowLeft":
        event.preventDefault();
        return moveTo(r, c - 1, event.shiftKey);
      case "ArrowRight":
      case "Tab":
        event.preventDefault();
        return moveTo(r, event.key === "Tab" && event.shiftKey ? c - 1 : c + 1, event.key !== "Tab" && event.shiftKey);
      case "Enter":
      case "F2":
        event.preventDefault();
        return startEdit(r, c);
      case "Escape":
        setAnchor(safeActive);
        return;
      case "Delete":
      case "Backspace": {
        event.preventDefault();
        if (!range) return;
        const changes: Change[] = [];
        for (let ri = range.r1; ri <= range.r2; ri += 1) {
          for (let ci = range.c1; ci <= range.c2; ci += 1) {
            const column = columns[ci];
            if (!column.field || !column.parse) continue;
            const parsed = column.parse("");
            if ("error" in parsed) continue;
            changes.push({ row: rows[ri], column, value: parsed.value, old: rawValue(rows[ri], column) });
          }
        }
        onCommit(changes);
        return;
      }
      case " ":
        if (event.shiftKey) {
          event.preventDefault();
          toggleSelect(rows[r].id);
        }
        return;
    }
    if (!mod && !event.altKey && event.key.length === 1) {
      const column = columns[c];
      if (column?.type === "select" || column?.type === "boolean") return startEdit(r, c);
      event.preventDefault();
      startEdit(r, c, event.key);
    }
  };

  const onCopy = (event: React.ClipboardEvent<HTMLDivElement>) => {
    if (editing) return;
    let lines: string[][] = [];
    if (range && (range.r1 !== range.r2 || range.c1 !== range.c2 || selected.size === 0)) {
      for (let ri = range.r1; ri <= range.r2; ri += 1) {
        const line: string[] = [];
        for (let ci = range.c1; ci <= range.c2; ci += 1) line.push(displayText(columns[ci], rows[ri]));
        lines.push(line);
      }
    } else if (selected.size > 0) {
      lines = [columns.map((c) => c.label), ...rows.filter((r) => selected.has(r.id)).map((r) => columns.map((c) => displayText(c, r)))];
    }
    if (lines.length === 0) return;
    event.preventDefault();
    event.clipboardData.setData("text/plain", toTsv(lines));
  };

  const onPaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    if (editing || !safeActive) return;
    const text = event.clipboardData.getData("text/plain");
    if (!text) return;
    event.preventDefault();
    const grid = parseTsv(text.replace(/\n$/, ""));
    const changes: Change[] = [];
    const errors: string[] = [];
    // One value pasted on a selection fills every selected cell, like Excel.
    const fill = grid.length === 1 && grid[0].length === 1 && range ? range : null;
    const height = fill ? fill.r2 - fill.r1 + 1 : grid.length;
    const width = fill ? fill.c2 - fill.c1 + 1 : Math.max(...grid.map((g) => g.length));
    const top = fill ? fill.r1 : safeActive.r;
    const leftCol = fill ? fill.c1 : safeActive.c;
    for (let i = 0; i < height; i += 1) {
      const row = rows[top + i];
      if (!row) break;
      for (let j = 0; j < width; j += 1) {
        const column = columns[leftCol + j];
        if (!column) break;
        const cell = fill ? grid[0][0] : grid[i]?.[j];
        if (cell === undefined || !column.field || !column.parse) continue;
        const parsed = column.parse(cell);
        if ("error" in parsed) {
          errors.push(`${column.label} row ${top + i + 1}: ${parsed.error}`);
          continue;
        }
        changes.push({ row, column, value: parsed.value, old: rawValue(row, column) });
      }
    }
    if (changes.length > 0) onCommit(changes);
    if (errors.length > 0) onError(`${errors.length} cell${errors.length === 1 ? "" : "s"} not pasted. ${errors.slice(0, 3).join(" ")}`);
  };

  const toggleSelect = (id: string, index?: number, shift?: boolean) => {
    const from = lastClicked.current;
    setSelected((prev) => {
      const next = new Set(prev);
      if (shift && index !== undefined && from !== null) {
        const [a, b] = [Math.min(index, from), Math.max(index, from)];
        const on = !prev.has(id);
        for (let i = a; i <= b; i += 1) {
          if (on) next.add(rows[i].id);
          else next.delete(rows[i].id);
        }
      } else if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    if (index !== undefined) lastClicked.current = index;
  };

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));

  const sortClick = (key: string, shift: boolean) =>
    setConfig((c) => {
      const existing = c.sort.find((s) => s.column === key);
      let sort: SortRule[];
      if (shift) {
        sort = existing
          ? existing.dir === "asc"
            ? c.sort.map((s) => (s.column === key ? { ...s, dir: "desc" as const } : s))
            : c.sort.filter((s) => s.column !== key)
          : [...c.sort, { column: key, dir: "asc" }];
      } else {
        sort = existing && c.sort.length === 1 ? (existing.dir === "asc" ? [{ column: key, dir: "desc" }] : []) : [{ column: key, dir: "asc" }];
      }
      return { ...c, sort, manualOrder: sort.length > 0 ? false : c.manualOrder };
    });

  const startResize = (key: string, startX: number, startWidth: number) => {
    const onMoveEvent = (e: PointerEvent) => {
      const w = Math.max(60, Math.min(800, startWidth + e.clientX - startX));
      setConfig((c) => ({ ...c, widths: { ...(c.widths ?? {}), [key]: Math.round(w) } }));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMoveEvent);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMoveEvent);
    window.addEventListener("pointerup", onUp);
  };

  const [headerDrag, setHeaderDrag] = useState<string | null>(null);
  const moveColumn = (from: string, to: string) =>
    setConfig((c) => {
      const keys = columns.map((col) => col.key);
      const next = keys.filter((x) => x !== from);
      next.splice(next.indexOf(to), 0, from);
      return { ...c, columns: next };
    });

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card px-6 py-12 text-center text-sm text-muted">
        {emptyText ?? `No ${k.noun} match this view.`}
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      tabIndex={0}
      role="grid"
      aria-label={`${k.noun} table`}
      aria-rowcount={rows.length + 1}
      aria-colcount={columns.length}
      onKeyDown={onKeyDown}
      onCopy={onCopy}
      onPaste={onPaste}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      className="relative h-[calc(100dvh-20rem)] min-h-96 overflow-auto rounded-2xl border border-border bg-card text-sm shadow-xs outline-none focus-visible:ring-4 focus-visible:ring-brand-100"
    >
      <div style={{ width: totalWidth, height: (rows.length + 1) * ROW_H }} className="relative">
        {/* Header */}
        <div role="row" className="sticky top-0 z-20 flex border-b border-border bg-surface font-semibold text-brand-900" style={{ height: ROW_H }}>
          <div className="sticky left-0 z-10 flex items-center gap-1 border-r border-border bg-surface px-2" style={{ width: LEAD_W }}>
            <input
              type="checkbox"
              aria-label="Select all rows"
              checked={allSelected}
              onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))}
            />
          </div>
          {columns.map((column, ci) => {
            const sortIndex = config.sort.findIndex((s) => s.column === column.key);
            const sortRule = config.sort[sortIndex];
            return (
              <div
                key={column.key}
                role="columnheader"
                aria-sort={sortRule ? (sortRule.dir === "asc" ? "ascending" : "descending") : undefined}
                draggable
                onDragStart={() => setHeaderDrag(column.key)}
                onDragOver={(e) => headerDrag && e.preventDefault()}
                onDrop={() => {
                  if (headerDrag && headerDrag !== column.key) moveColumn(headerDrag, column.key);
                  setHeaderDrag(null);
                }}
                className={`group relative flex items-center gap-1 border-r border-border px-2 ${headerDrag === column.key ? "opacity-50" : ""}`}
                style={{ width: widths[ci] }}
              >
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-1 truncate text-left"
                  onClick={(e) => sortClick(column.key, e.shiftKey)}
                  title="Sort. Shift+click adds a second sort column."
                >
                  <span className="truncate">{column.label}</span>
                  {sortRule && (
                    <span className="inline-flex items-center text-brand-600">
                      {sortRule.dir === "asc" ? <ArrowUp className="size-3.5" aria-hidden="true" /> : <ArrowDown className="size-3.5" aria-hidden="true" />}
                      {config.sort.length > 1 && <span className="text-[10px] tabular-nums">{sortIndex + 1}</span>}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => onFilter(column.key)}
                  className={`rounded p-0.5 ${filtered.has(column.key) ? "text-accent-600" : "text-muted opacity-0 group-hover:opacity-100 focus:opacity-100"}`}
                  aria-label={`Filter ${column.label}`}
                >
                  <FilterIcon className="size-3.5" />
                </button>
                <span
                  role="separator"
                  aria-orientation="vertical"
                  aria-label={`Resize ${column.label}`}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    startResize(column.key, e.clientX, widths[ci]);
                  }}
                  className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize hover:bg-brand-200"
                />
              </div>
            );
          })}
        </div>

        {/* Rows (only the ones in view are rendered) */}
        {rows.slice(first, last).map((row, offset) => {
          const r = first + offset;
          const isSelected = selected.has(row.id);
          return (
            <div
              key={rowKey(row)}
              role="row"
              aria-rowindex={r + 2}
              aria-selected={isSelected}
              onDragOver={(e) => {
                if (!dragId) return;
                e.preventDefault();
                setDropIndex(r);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragId) onMove(dragId, r);
                setDragId(null);
                setDropIndex(null);
              }}
              className={`absolute left-0 flex border-b border-border/70 ${isSelected ? "bg-brand-50" : row.pinned_at ? "bg-accent-100/40" : "bg-card hover:bg-surface"} ${dropIndex === r ? "border-t-2 border-t-brand-500" : ""}`}
              style={{ top: (r + 1) * ROW_H, height: ROW_H, width: totalWidth }}
            >
              <div className={`sticky left-0 z-10 flex items-center gap-1 border-r border-border px-2 ${isSelected ? "bg-brand-50" : "bg-inherit"}`} style={{ width: LEAD_W, backgroundColor: isSelected ? undefined : "var(--card)" }}>
                <input
                  type="checkbox"
                  aria-label={`Select ${k.title(row)}`}
                  checked={isSelected}
                  onChange={() => undefined}
                  onClick={(e) => toggleSelect(row.id, r, e.shiftKey)}
                />
                <button
                  type="button"
                  onClick={() => onPin(row)}
                  className={`rounded p-0.5 ${row.pinned_at ? "text-accent-600" : "text-muted/50 hover:text-brand-700"}`}
                  aria-label={row.pinned_at ? `Unpin ${k.title(row)}` : `Pin ${k.title(row)} on top`}
                  title={row.pinned_at ? "Unpin" : "Pin on top"}
                >
                  {row.pinned_at ? <Pin className="size-3.5 fill-current" /> : <Pin className="size-3.5" />}
                </button>
                {manual && (
                  <span
                    draggable
                    onDragStart={(e) => {
                      setDragId(row.id);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragEnd={() => {
                      setDragId(null);
                      setDropIndex(null);
                    }}
                    className="cursor-grab text-muted"
                    title="Drag to move. Alt+arrow keys move the active row."
                    aria-label={`Drag ${k.title(row)}`}
                  >
                    <GripVertical className="size-4" />
                  </span>
                )}
              </div>
              {columns.map((column, ci) => {
                const inRange = range && r >= range.r1 && r <= range.r2 && ci >= range.c1 && ci <= range.c2;
                const isActive = safeActive?.r === r && safeActive?.c === ci;
                const isEditing = editing?.r === r && editing?.c === ci;
                const editable = Boolean(column.field && column.parse);
                return (
                  <div
                    key={column.key}
                    role="gridcell"
                    aria-colindex={ci + 1}
                    aria-readonly={!editable}
                    onMouseDown={(e) => {
                      if (e.button !== 0) return;
                      if (e.shiftKey && safeActive) {
                        e.preventDefault();
                        setActive({ r, c: ci });
                      } else {
                        setActive({ r, c: ci });
                        setAnchor({ r, c: ci });
                      }
                    }}
                    onDoubleClick={() => startEdit(r, ci)}
                    className={`relative flex items-center overflow-hidden border-r border-border/50 px-2 ${inRange ? "bg-brand-100/50" : ""} ${isActive ? "z-10 outline-2 -outline-offset-2 outline-brand-500" : ""} ${editable ? "" : "text-muted"}`}
                    style={{ width: widths[ci] }}
                  >
                    {isEditing ? (
                      <CellEditor
                        column={column}
                        initial={editing.initial}
                        onCancel={() => {
                          setEditing(null);
                          scrollRef.current?.focus();
                        }}
                        onCommit={(text, move) => {
                          setEditing(null);
                          commitText(r, ci, text);
                          scrollRef.current?.focus();
                          if (move === "down") moveTo(r + 1, ci);
                          if (move === "right") moveTo(r, ci + 1);
                        }}
                      />
                    ) : ci === 0 ? (
                      <Link href={k.href(row)} className="truncate font-medium text-brand-800 hover:underline" onClick={(e) => e.stopPropagation()}>
                        {displayText(column, row) || k.title(row)}
                      </Link>
                    ) : (
                      <CellView column={column} row={row} />
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
