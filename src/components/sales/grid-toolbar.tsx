"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Eye, EyeOff, GripVertical, Plus, X } from "lucide-react";
import type { ColumnFilter, FilterOp, SortRule } from "@/lib/sales/grid";
import type { ColumnDef } from "@/lib/sales/rows";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import type { AnyRow } from "./grid-kinds";

// Filter editor, filter and sort chips and the column chooser of the table.

const textOps: { value: FilterOp; label: string }[] = [
  { value: "contains", label: "contains" },
  { value: "not_contains", label: "does not contain" },
  { value: "equals", label: "is" },
  { value: "not_equals", label: "is not" },
  { value: "empty", label: "is empty" },
  { value: "not_empty", label: "is not empty" },
];
const compareOps: { value: FilterOp; label: string }[] = [
  { value: "equals", label: "is" },
  { value: "gt", label: "after or more than" },
  { value: "gte", label: "on or after, at least" },
  { value: "lt", label: "before or less than" },
  { value: "lte", label: "on or before, at most" },
  { value: "empty", label: "is empty" },
  { value: "not_empty", label: "is not empty" },
];

export function opLabel(op: FilterOp): string {
  return [...textOps, ...compareOps].find((o) => o.value === op)?.label ?? (op === "in" ? "is one of" : "is none of");
}

export function filterSummary(filter: ColumnFilter, column: ColumnDef<AnyRow> | undefined): string {
  const name = column?.label ?? filter.column;
  if (filter.op === "empty" || filter.op === "not_empty") return `${name} ${opLabel(filter.op)}`;
  const values = Array.isArray(filter.value) ? filter.value : [String(filter.value ?? "")];
  const labels = values.map((v) => (v === "" ? "(empty)" : (column?.options?.find((o) => o.value === v)?.label ?? v)));
  return `${name} ${opLabel(filter.op)} ${labels.join(", ")}`;
}

/** Edits the filter of one column. Select columns pick values; others an operator and a value. */
export function FilterEditor({
  column,
  current,
  onApply,
  onClose,
}: {
  column: ColumnDef<AnyRow>;
  current: ColumnFilter | undefined;
  onApply: (filter: ColumnFilter | null) => void;
  onClose: () => void;
}) {
  const isChoice = column.type === "select" || column.type === "boolean";
  const isCompare = column.type === "number" || column.type === "date" || column.type === "datetime";
  const choiceOptions =
    column.type === "boolean"
      ? [
          { value: "true", label: "Yes" },
          { value: "false", label: "No" },
        ]
      : [...(column.options ?? []), { value: "", label: "(empty)" }];
  const [picked, setPicked] = useState<string[]>(
    Array.isArray(current?.value) ? current.value : current?.value != null ? [String(current.value)] : [],
  );
  const [exclude, setExclude] = useState(current?.op === "not_in");
  const ops = isCompare ? compareOps : textOps;
  const [op, setOp] = useState<FilterOp>(current && !isChoice ? current.op : isCompare ? "equals" : "contains");
  const [value, setValue] = useState(current && !isChoice && !Array.isArray(current.value) ? String(current.value ?? "") : "");

  const apply = () => {
    if (isChoice) {
      onApply(picked.length === 0 ? null : { column: column.key, op: exclude ? "not_in" : "in", value: picked });
    } else if (op === "empty" || op === "not_empty") {
      onApply({ column: column.key, op });
    } else if (value.trim() === "") {
      onApply(null);
    } else {
      onApply({ column: column.key, op, value: column.type === "number" ? Number(value) : value.trim() });
    }
    onClose();
  };

  return (
    <Modal open onClose={onClose} title={`Filter: ${column.label}`}>
      <div className="space-y-4">
        {isChoice ? (
          <>
            <div className="flex gap-2 text-sm">
              <label className="inline-flex items-center gap-2">
                <input type="radio" checked={!exclude} onChange={() => setExclude(false)} /> Show only
              </label>
              <label className="inline-flex items-center gap-2">
                <input type="radio" checked={exclude} onChange={() => setExclude(true)} /> Hide
              </label>
            </div>
            <ul className="grid max-h-72 gap-1 overflow-y-auto sm:grid-cols-2">
              {choiceOptions.map((o) => (
                <li key={o.value}>
                  <label className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-brand-50">
                    <input
                      type="checkbox"
                      checked={picked.includes(o.value)}
                      onChange={(e) =>
                        setPicked((prev) => (e.target.checked ? [...prev, o.value] : prev.filter((v) => v !== o.value)))
                      }
                    />
                    {o.label}
                  </label>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <div className="grid gap-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
            <select
              aria-label="Condition"
              className="rounded-xl border border-border bg-white px-3 py-2 text-sm"
              value={op}
              onChange={(e) => setOp(e.target.value as FilterOp)}
            >
              {ops.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            {op !== "empty" && op !== "not_empty" && (
              <input
                aria-label="Value"
                autoFocus
                type={column.type === "date" || column.type === "datetime" ? "date" : "text"}
                className="rounded-xl border border-border bg-white px-3 py-2 text-sm"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") apply();
                }}
              />
            )}
          </div>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          {current && (
            <Button
              variant="ghost"
              onClick={() => {
                onApply(null);
                onClose();
              }}
            >
              Remove filter
            </Button>
          )}
          <Button onClick={apply}>Apply</Button>
        </div>
      </div>
    </Modal>
  );
}

export function Chips({
  filters,
  sort,
  columns,
  onRemoveFilter,
  onEditFilter,
  onRemoveSort,
  onFlipSort,
}: {
  filters: ColumnFilter[];
  sort: SortRule[];
  columns: ColumnDef<AnyRow>[];
  onRemoveFilter: (index: number) => void;
  onEditFilter: (column: string) => void;
  onRemoveSort: (index: number) => void;
  onFlipSort: (index: number) => void;
}) {
  if (filters.length === 0 && sort.length === 0) return null;
  const byKey = new Map(columns.map((c) => [c.key, c]));
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      {sort.map((s, i) => (
        <span key={`s-${s.column}`} className="inline-flex items-center gap-1 rounded-full bg-brand-50 py-1 pr-1 pl-2.5 font-medium text-brand-800 ring-1 ring-brand-100">
          <button type="button" onClick={() => onFlipSort(i)} className="inline-flex items-center gap-1" title="Flip direction">
            {sort.length > 1 && <span className="tabular-nums">{i + 1}.</span>}
            {byKey.get(s.column)?.label ?? s.column}
            {s.dir === "asc" ? <ArrowUp className="size-3" aria-label="ascending" /> : <ArrowDown className="size-3" aria-label="descending" />}
          </button>
          <button type="button" onClick={() => onRemoveSort(i)} className="rounded-full p-0.5 hover:bg-brand-100" aria-label="Remove sort">
            <X className="size-3" />
          </button>
        </span>
      ))}
      {filters.map((f, i) => (
        <span key={`f-${i}`} className="inline-flex items-center gap-1 rounded-full bg-accent-100 py-1 pr-1 pl-2.5 font-medium text-brand-900 ring-1 ring-accent-500/20">
          <button type="button" onClick={() => onEditFilter(f.column)} className="max-w-72 truncate">
            {filterSummary(f, byKey.get(f.column))}
          </button>
          <button type="button" onClick={() => onRemoveFilter(i)} className="rounded-full p-0.5 hover:bg-accent-500/20" aria-label="Remove filter">
            <X className="size-3" />
          </button>
        </span>
      ))}
    </div>
  );
}

/** Show, hide and reorder columns (drag or the arrows). */
export function ColumnChooser({
  columns,
  visible,
  onChange,
  onClose,
  onAddColumn,
}: {
  columns: ColumnDef<AnyRow>[];
  visible: string[];
  onChange: (next: string[]) => void;
  onClose: () => void;
  /** Opens the form for an own column (custom field), when the table allows it. */
  onAddColumn?: () => void;
}) {
  const [dragKey, setDragKey] = useState<string | null>(null);
  const hidden = columns.filter((c) => !visible.includes(c.key));
  const byKey = new Map(columns.map((c) => [c.key, c]));
  const move = (key: string, to: number) => {
    const next = visible.filter((k) => k !== key);
    next.splice(Math.max(0, Math.min(to, next.length)), 0, key);
    onChange(next);
  };
  return (
    <Modal open onClose={onClose} title="Columns" description="Drag to reorder. Hidden columns stay available.">
      <ol className="space-y-1">
        {visible.map((key, index) => (
          <li
            key={key}
            draggable
            onDragStart={() => setDragKey(key)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (dragKey && dragKey !== key) move(dragKey, index);
              setDragKey(null);
            }}
            className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 text-sm ${dragKey === key ? "border-brand-500 bg-brand-50" : "border-border bg-white"}`}
          >
            <GripVertical className="size-4 cursor-grab text-muted" aria-hidden="true" />
            <span className="flex-1">{byKey.get(key)?.label ?? key}</span>
            <button type="button" className="rounded p-1 hover:bg-brand-50 disabled:opacity-30" disabled={index === 0} onClick={() => move(key, index - 1)} aria-label="Move up">
              <ArrowUp className="size-4" />
            </button>
            <button type="button" className="rounded p-1 hover:bg-brand-50 disabled:opacity-30" disabled={index === visible.length - 1} onClick={() => move(key, index + 1)} aria-label="Move down">
              <ArrowDown className="size-4" />
            </button>
            <button type="button" className="rounded p-1 hover:bg-brand-50 disabled:opacity-30" disabled={visible.length <= 1} onClick={() => onChange(visible.filter((k) => k !== key))} aria-label={`Hide ${byKey.get(key)?.label}`}>
              <EyeOff className="size-4" />
            </button>
          </li>
        ))}
      </ol>
      {hidden.length > 0 && (
        <>
          <h3 className="mt-5 mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Hidden</h3>
          <ul className="grid gap-1 sm:grid-cols-2">
            {hidden.map((c) => (
              <li key={c.key}>
                <button
                  type="button"
                  onClick={() => onChange([...visible, c.key])}
                  className="flex w-full items-center gap-2 rounded-lg border border-dashed border-border px-2 py-1.5 text-left text-sm text-muted hover:border-brand-200 hover:text-ink"
                >
                  <Eye className="size-4" aria-hidden="true" />
                  {c.label}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {onAddColumn && (
        <div className="mt-5 border-t border-border pt-4">
          <button
            type="button"
            onClick={onAddColumn}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-brand-700 hover:bg-brand-50"
          >
            <Plus className="size-4" aria-hidden="true" />
            Add your own column
          </button>
          <p className="mt-1 text-xs text-muted">
            Own columns are filled like any cell, can be filtered and sorted, and show on the lead page. Rename or archive them in Settings, Fields.
          </p>
        </div>
      )}
    </Modal>
  );
}
