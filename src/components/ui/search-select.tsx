"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";

export type SearchOption = { value: string; label: string; hint?: string; group?: string };

/**
 * A dropdown with a search field, for every pick list that can grow long
 * (clients, companies, candidates; feedback Julius, point 5). Works inside a
 * form through `name` (a hidden input) and on its own through `onChange`.
 */
export function SearchSelect({
  options,
  value: controlled,
  defaultValue = null,
  onChange,
  name,
  id,
  placeholder = "Choose",
  searchPlaceholder = "Search",
  allowClear = true,
  disabled,
  required,
  className = "",
  emptyText = "Nothing found",
  "aria-labelledby": labelledBy,
  "aria-label": ariaLabel,
  "aria-invalid": invalid,
  "aria-describedby": describedBy,
}: {
  options: SearchOption[];
  value?: string | null;
  defaultValue?: string | null;
  onChange?: (value: string | null) => void;
  name?: string;
  id?: string;
  placeholder?: string;
  searchPlaceholder?: string;
  allowClear?: boolean;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  emptyText?: string;
  "aria-labelledby"?: string;
  "aria-label"?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}) {
  const [uncontrolled, setUncontrolled] = useState<string | null>(defaultValue);
  const value = controlled !== undefined ? controlled : uncontrolled;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const autoId = useId();
  const listId = `${id ?? autoId}-list`;

  const selected = options.find((o) => o.value === value) ?? null;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options.slice(0, 300);
    const words = q.split(/\s+/);
    return options
      .filter((o) => {
        const hay = `${o.label} ${o.hint ?? ""} ${o.group ?? ""}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      })
      .slice(0, 300);
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${highlight}"]`)?.scrollIntoView({ block: "nearest" });
  }, [highlight]);

  const choose = (next: string | null) => {
    if (controlled === undefined) setUncontrolled(next);
    onChange?.(next);
    setOpen(false);
    setQuery("");
  };

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      {name && <input type="hidden" name={name} value={value ?? ""} required={required} />}
      <button
        type="button"
        id={id}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-labelledby={labelledBy}
        aria-label={ariaLabel}
        data-invalid={invalid ? "" : undefined}
        aria-describedby={describedBy}
        onClick={() => {
          setOpen((o) => !o);
          setHighlight(Math.max(0, filtered.findIndex((o) => o.value === value)));
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className="flex w-full items-center justify-between gap-2 rounded-xl border border-border bg-white px-3.5 py-2.5 text-left text-sm text-ink shadow-xs outline-none transition focus:border-brand-500 focus:ring-4 focus:ring-brand-100 disabled:bg-surface data-invalid:border-danger"
      >
        <span className={`truncate ${selected ? "" : "text-muted/70"}`}>{selected ? selected.label : placeholder}</span>
        <span className="flex shrink-0 items-center gap-1">
          {allowClear && selected && !disabled && (
            <span
              role="button"
              tabIndex={-1}
              aria-label="Clear"
              onClick={(e) => {
                e.stopPropagation();
                choose(null);
              }}
              className="rounded p-0.5 text-muted hover:bg-brand-50 hover:text-ink"
            >
              <X className="size-3.5" />
            </span>
          )}
          <ChevronDown className="size-4 text-muted" aria-hidden="true" />
        </span>
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full min-w-64 rounded-xl border border-border bg-white shadow-xl">
          <div className="relative border-b border-border p-2">
            <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
            <input
              ref={inputRef}
              role="combobox"
              aria-expanded
              aria-controls={listId}
              aria-activedescendant={filtered[highlight] ? `${listId}-${highlight}` : undefined}
              aria-autocomplete="list"
              aria-label={searchPlaceholder}
              placeholder={searchPlaceholder}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setHighlight(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setHighlight((h) => Math.min(filtered.length - 1, h + 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setHighlight((h) => Math.max(0, h - 1));
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  const hit = filtered[highlight];
                  if (hit) choose(hit.value);
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setOpen(false);
                }
              }}
              className="w-full rounded-lg border border-border py-2 pr-3 pl-8 text-sm outline-none focus:border-brand-500"
            />
          </div>
          <ul ref={listRef} id={listId} role="listbox" className="max-h-64 overflow-y-auto p-1">
            {filtered.length === 0 && <li className="px-3 py-2 text-sm text-muted">{emptyText}</li>}
            {filtered.map((o, i) => (
              <li
                key={o.value}
                id={`${listId}-${i}`}
                data-index={i}
                role="option"
                aria-selected={o.value === value}
                onMouseEnter={() => setHighlight(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(o.value);
                }}
                className={`flex cursor-pointer items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm ${i === highlight ? "bg-brand-50" : ""}`}
              >
                <span className="min-w-0">
                  <span className="block truncate">{o.label}</span>
                  {o.hint && <span className="block truncate text-xs text-muted">{o.hint}</span>}
                </span>
                {o.value === value && <Check className="size-4 shrink-0 text-brand-700" aria-hidden="true" />}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
