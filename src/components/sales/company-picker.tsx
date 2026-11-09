"use client";

import { useEffect, useId, useState, useTransition } from "react";
import { Check, LoaderCircle, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/field";
import type { CompanyOption } from "@/lib/data/sequences";
import { labelOf, leadStatuses } from "@/lib/sales/labels";

/**
 * Pick one or more companies by name or domain. Without a search it shows
 * the companies with lead status Ready. The chosen ids are posted as hidden
 * inputs with the given name.
 */
export function CompanyPicker({
  search,
  name = "company_ids",
  multiple = true,
  label = "Companies",
}: {
  search: (query: string) => Promise<CompanyOption[]>;
  name?: string;
  multiple?: boolean;
  label?: string;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<CompanyOption[]>([]);
  const [selected, setSelected] = useState<CompanyOption[]>([]);
  const [pending, start] = useTransition();

  useEffect(() => {
    const timer = setTimeout(() => {
      start(async () => setOptions(await search(query)));
    }, 250);
    return () => clearTimeout(timer);
  }, [query, search]);

  const isSelected = (c: CompanyOption) => selected.some((s) => s.id === c.id);
  const toggle = (c: CompanyOption) =>
    setSelected((prev) =>
      prev.some((s) => s.id === c.id) ? prev.filter((s) => s.id !== c.id) : multiple ? [...prev, c] : [c],
    );

  return (
    <div className="space-y-2">
      <label htmlFor={`${id}-search`} className="block text-sm font-medium text-ink">
        {label}
      </label>
      {selected.map((c) => (
        <input key={c.id} type="hidden" name={name} value={c.id} />
      ))}
      {selected.length > 0 && (
        <ul aria-label="Chosen companies" className="flex flex-wrap gap-1.5">
          {selected.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => toggle(c)}
                className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-1 text-sm text-brand-800 ring-1 ring-brand-100 hover:bg-brand-100 pointer-coarse:min-h-9"
                aria-label={`Remove ${c.name}`}
              >
                {c.name}
                <X className="size-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
        <Input
          id={`${id}-search`}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name or domain"
          className="pl-9"
          autoComplete="off"
          aria-controls={`${id}-results`}
        />
        {pending && (
          <LoaderCircle className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted" aria-hidden="true" />
        )}
      </div>
      <p className="text-xs text-muted">{query.trim().length < 2 ? "Companies with lead status Ready." : `Results for "${query.trim()}".`}</p>
      <ul
        id={`${id}-results`}
        aria-label="Search results"
        className="max-h-64 divide-y divide-border overflow-y-auto overscroll-contain rounded-xl border border-border bg-white"
      >
        {options.length === 0 ? (
          <li className="px-3 py-3 text-sm text-muted">{pending ? "Searching" : "No companies found."}</li>
        ) : (
          options.map((c) => {
            const on = isSelected(c);
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => toggle(c)}
                  aria-pressed={on}
                  className={`flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm transition hover:bg-brand-50 pointer-coarse:min-h-11 ${on ? "bg-brand-50" : ""}`}
                >
                  <span
                    className={`flex size-5 shrink-0 items-center justify-center rounded border ${on ? "border-brand-600 bg-brand-600 text-white" : "border-border"}`}
                    aria-hidden="true"
                  >
                    {on && <Check className="size-3.5" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-ink">{c.name}</span>
                    <span className="block truncate text-xs text-muted">
                      {[c.domain.startsWith("nodomain:") ? null : c.domain, c.city].filter(Boolean).join(", ")}
                    </span>
                  </span>
                  <Badge tone="neutral">{labelOf(leadStatuses, c.leadStatus)}</Badge>
                </button>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}
