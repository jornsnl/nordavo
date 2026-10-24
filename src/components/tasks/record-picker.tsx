"use client";

import { useId, useRef, useState } from "react";
import { LoaderCircle, Search, X } from "lucide-react";
import type { EntityType } from "@/lib/database.types";
import type { RecordHit } from "@/lib/data/search";
import { entityTypes } from "@/lib/labels";
import { Field, Input, Select } from "@/components/ui/field";
import { searchRecords } from "@/components/search/actions";

const pickableTypes = ["company", "client", "vacancy", "candidate", "placement"] as const;

export type PickedRecord = { type: EntityType; id: string; label: string };

/**
 * Optional link from a task to a record: pick a type, search, choose.
 * Submits `entity_type` and `entity_id` as hidden inputs.
 */
export function RecordPicker({ initial, error }: { initial: PickedRecord | null; error?: string }) {
  const id = useId();
  const [type, setType] = useState<EntityType | "">(initial?.type ?? "");
  const [picked, setPicked] = useState<PickedRecord | null>(initial);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<RecordHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const requestId = useRef(0);

  const typeOptions: EntityType[] =
    initial && !pickableTypes.includes(initial.type as (typeof pickableTypes)[number])
      ? [...pickableTypes, initial.type]
      : [...pickableTypes];

  function runSearch(nextType: EntityType | "", nextQuery: string) {
    clearTimeout(timer.current);
    const current = ++requestId.current;
    if (!nextType || nextQuery.trim().length < 2) {
      setHits([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    timer.current = setTimeout(async () => {
      const result = await searchRecords(nextType, nextQuery);
      if (current !== requestId.current) return;
      setHits(result);
      setActive(0);
      setLoading(false);
    }, 250);
  }

  function choose(hit: RecordHit) {
    setPicked({ type: hit.type, id: hit.id, label: hit.label });
    setQuery("");
    setHits([]);
  }

  const listId = `${id}-results`;
  const showResults = !picked && type !== "" && query.trim().length >= 2;

  return (
    <fieldset className="space-y-3 rounded-xl border border-border p-4">
      <legend className="px-1 text-sm font-medium text-ink">Koppelen aan</legend>
      {picked && <input type="hidden" name="entity_type" value={picked.type} />}
      {picked && <input type="hidden" name="entity_id" value={picked.id} />}

      <Field label="Soort record" htmlFor={`${id}-type`}>
        <Select
          id={`${id}-type`}
          value={type}
          onChange={(event) => {
            const next = event.target.value as EntityType | "";
            setType(next);
            setPicked(null);
            runSearch(next, query);
          }}
        >
          <option value="">Geen koppeling</option>
          {typeOptions.map((t) => (
            <option key={t} value={t}>
              {entityTypes[t].label}
            </option>
          ))}
        </Select>
      </Field>

      {type !== "" && picked && (
        <div className="flex items-center justify-between gap-2 rounded-xl bg-brand-50 px-3 py-2 text-sm">
          <span className="min-w-0 truncate">
            <span className="text-muted">{entityTypes[picked.type].label}:</span>{" "}
            <span className="font-medium text-brand-900">{picked.label}</span>
          </span>
          <button
            type="button"
            onClick={() => setPicked(null)}
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-white hover:text-ink active:bg-white pointer-coarse:-my-1.5 pointer-coarse:size-11 focus-visible:outline-2 focus-visible:outline-brand-500"
            aria-label="Koppeling weghalen"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      )}

      {type !== "" && !picked && (
        <Field label={`Zoek ${entityTypes[type].label.toLowerCase()}`} htmlFor={`${id}-query`} error={error}>
          <div className="relative">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted"
              aria-hidden="true"
            />
            <Input
              id={`${id}-query`}
              type="search"
              autoComplete="off"
              enterKeyHint="search"
              placeholder="Typ minstens 2 letters"
              className="pl-9"
              value={query}
              role="combobox"
              aria-expanded={showResults}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={showResults && hits[active] ? `${listId}-${active}` : undefined}
              aria-invalid={error ? true : undefined}
              onChange={(event) => {
                setQuery(event.target.value);
                runSearch(type, event.target.value);
              }}
              onKeyDown={(event) => {
                if (!showResults || hits.length === 0) return;
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setActive((i) => (i + 1) % hits.length);
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setActive((i) => (i - 1 + hits.length) % hits.length);
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  choose(hits[active]);
                }
              }}
            />
            {loading && (
              <LoaderCircle
                className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted"
                aria-hidden="true"
              />
            )}
          </div>
          {showResults && (
            <ul id={listId} role="listbox" className="mt-1 max-h-56 overflow-y-auto rounded-xl border border-border bg-white p-1">
              {hits.map((hit, index) => (
                <li
                  key={hit.id}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={index === active}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(hit)}
                  onMouseEnter={() => setActive(index)}
                  className={`cursor-pointer rounded-lg px-3 py-2 text-sm active:bg-brand-100 pointer-coarse:py-2.5 ${
                    index === active ? "bg-brand-50 text-brand-900" : "text-ink"
                  }`}
                >
                  <span className="block truncate font-medium">{hit.label}</span>
                  {hit.sublabel && <span className="block truncate text-xs text-muted">{hit.sublabel}</span>}
                </li>
              ))}
              {!loading && hits.length === 0 && (
                <li className="px-3 py-2 text-sm text-muted">Niets gevonden.</li>
              )}
            </ul>
          )}
        </Field>
      )}
    </fieldset>
  );
}
