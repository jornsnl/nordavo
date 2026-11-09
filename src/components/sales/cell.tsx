"use client";

import { useEffect, useRef, useState } from "react";
import type { ColumnDef } from "@/lib/sales/rows";
import type { AnyRow } from "./grid-kinds";

// Display and editing of one cell of the sales table.

const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Amsterdam" });
const dateTimeFmt = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Amsterdam",
});

/** The text of a cell as shown and as copied to Excel. */
export function displayText(column: ColumnDef<AnyRow>, row: AnyRow): string {
  const value = column.get(row);
  if (value === null || value === undefined || value === "") return "";
  if (Array.isArray(value)) return value.join(", ");
  if (column.type === "select") {
    return column.options?.find((o) => o.value === String(value))?.label ?? String(value);
  }
  if (column.type === "boolean") return value ? "Yes" : "";
  if (column.type === "date" && typeof value === "string") {
    const d = new Date(`${value}T12:00:00Z`);
    return Number.isNaN(d.getTime()) ? value : dateFmt.format(d);
  }
  if (column.type === "datetime" && typeof value === "string") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? value : dateTimeFmt.format(d);
  }
  return String(value);
}

/** The text an editor starts with (raw value, not the label). */
export function editText(column: ColumnDef<AnyRow>, row: AnyRow): string {
  const value = column.get(row);
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.join(", ");
  if (column.type === "boolean") return value ? "yes" : "no";
  return String(value);
}

const selectTone: Record<string, string> = {
  // Lead status, stage and contact status chips follow the badge tones.
  new: "bg-slate-100 text-slate-700",
  review: "bg-amber-50 text-amber-800",
  ready: "bg-brand-50 text-brand-700",
  enrich: "bg-amber-50 text-amber-800",
  in_sequence: "bg-accent-100 text-accent-600",
  cooled_down: "bg-slate-100 text-slate-600",
  no_go: "bg-danger-bg text-danger",
  do_not_contact: "bg-danger-bg text-danger",
  qualified: "bg-brand-50 text-brand-700",
  enriched: "bg-brand-50 text-brand-700",
  in_outreach: "bg-accent-100 text-accent-600",
  reached: "bg-emerald-50 text-emerald-700",
  not_reached: "bg-amber-50 text-amber-800",
  not_interested: "bg-slate-100 text-slate-600",
  interested: "bg-brand-50 text-brand-700",
  meeting_planned: "bg-brand-50 text-brand-700",
  meeting_held: "bg-accent-100 text-accent-600",
  intake_done: "bg-accent-100 text-accent-600",
  profiles_sent: "bg-accent-100 text-accent-600",
  candidate_interviews: "bg-accent-100 text-accent-600",
  won: "bg-emerald-50 text-emerald-700",
  lost: "bg-danger-bg text-danger",
  GO: "bg-emerald-50 text-emerald-700",
  NO_GO: "bg-danger-bg text-danger",
  REVIEW: "bg-amber-50 text-amber-800",
};

const prioTone: Record<string, string> = {
  "1": "bg-red-600 text-white",
  "2": "bg-orange-100 text-orange-800",
  "3": "bg-sky-100 text-sky-800",
  "4": "bg-slate-100 text-slate-700",
  "5": "bg-slate-100 text-slate-500",
};

export function CellView({ column, row }: { column: ColumnDef<AnyRow>; row: AnyRow }) {
  const text = displayText(column, row);
  if (!text) return null;
  const raw = column.get(row);
  if (column.type === "select") {
    const tone = column.key.endsWith("prio") ? prioTone[String(raw)] : selectTone[String(raw)];
    return (
      <span className={`inline-block max-w-full truncate rounded-full px-2 py-0.5 text-xs font-medium ${tone ?? "bg-slate-100 text-slate-700"}`}>
        {text}
      </span>
    );
  }
  if (column.type === "url") {
    const href = /^https?:\/\//i.test(text) ? text : `https://${text}`;
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="truncate text-brand-700 hover:underline" onClick={(e) => e.stopPropagation()}>
        {text.replace(/^https?:\/\/(www\.)?/i, "")}
      </a>
    );
  }
  if (column.type === "phone") {
    return (
      <a href={`tel:${text.replace(/[^+\d]/g, "")}`} className="truncate text-brand-700 tabular-nums hover:underline" onClick={(e) => e.stopPropagation()}>
        {text}
      </a>
    );
  }
  if (column.type === "email") {
    return (
      <a href={`mailto:${text}`} className="truncate text-brand-700 hover:underline" onClick={(e) => e.stopPropagation()}>
        {text}
      </a>
    );
  }
  if (column.type === "boolean") return <span aria-label="Yes">✓</span>;
  if (column.type === "number") return <span className="tabular-nums">{text}</span>;
  return <span className="truncate">{text}</span>;
}

/** An inline editor; commits with Enter, Tab or leaving the cell, cancels with Escape. */
export function CellEditor({
  column,
  initial,
  onCommit,
  onCancel,
}: {
  column: ColumnDef<AnyRow>;
  initial: string;
  onCommit: (text: string, move: "down" | "right" | "none") => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  const ref = useRef<HTMLInputElement & HTMLSelectElement & HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    if ("setSelectionRange" in el && column.type !== "select" && column.type !== "date") {
      try {
        el.setSelectionRange(el.value.length, el.value.length);
      } catch {
        // Some input types do not support a selection.
      }
    }
  }, [column.type]);

  const commit = (move: "down" | "right" | "none") => {
    if (done.current) return;
    done.current = true;
    onCommit(value, move);
  };
  const cancel = () => {
    if (done.current) return;
    done.current = true;
    onCancel();
  };
  const onKeyDown = (event: React.KeyboardEvent) => {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
    } else if (event.key === "Enter" && !(column.type === "longtext" && event.shiftKey)) {
      event.preventDefault();
      commit("down");
    } else if (event.key === "Tab") {
      event.preventDefault();
      commit("right");
    }
  };
  const className =
    "h-full w-full rounded-md border border-brand-500 bg-white px-2 text-sm text-ink shadow-sm outline-none ring-4 ring-brand-100";

  if (column.type === "select" || column.type === "boolean") {
    const options =
      column.type === "boolean"
        ? [
            { value: "yes", label: "Yes" },
            { value: "no", label: "No" },
          ]
        : (column.options ?? []);
    return (
      <select
        ref={ref}
        aria-label={column.label}
        className={className}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          done.current = true;
          onCommit(e.target.value, "none");
        }}
        onBlur={() => commit("none")}
        onKeyDown={onKeyDown}
      >
        {column.type === "select" && <option value="">(empty)</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }
  if (column.type === "longtext") {
    return (
      <textarea
        ref={ref}
        aria-label={column.label}
        className={`${className} absolute top-0 left-0 z-30 h-28 w-[min(28rem,80vw)] py-1.5`}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => commit("none")}
        onKeyDown={onKeyDown}
      />
    );
  }
  return (
    <input
      ref={ref}
      aria-label={column.label}
      type={column.type === "date" ? "date" : column.type === "number" ? "text" : "text"}
      inputMode={column.type === "number" ? "numeric" : undefined}
      className={className}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => commit("none")}
      onKeyDown={onKeyDown}
    />
  );
}
