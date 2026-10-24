import Form from "next/form";
import type { ListExportType } from "@/lib/database.types";
import type { ListFilter } from "@/lib/gtm/lists";
import { MAX_LIMIT } from "@/lib/gtm/lists";
import { FilterSheet } from "@/components/leads/filter-sheet";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { optionFor, segments, signalTypes } from "@/lib/labels";

/** Inline filter card on desktop; on phones a summary with a Filters button that opens a sheet. */
export function ListFilters({ filter, list }: { filter: ListFilter; list: ListExportType }) {
  const active = [filter.segment, filter.signalType, filter.tier, filter.minScore].filter(Boolean).length;
  const summary = [
    filter.segment ? optionFor(segments, filter.segment).label : null,
    filter.signalType ? optionFor(signalTypes, filter.signalType).label : null,
    filter.tier ? `tier ${filter.tier}` : null,
    filter.minScore ? `score ${filter.minScore}+` : null,
    `max ${filter.limit}`,
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <Form
      action="/dashboard/lijsten"
      className="mb-6 flex items-center gap-3 max-md:justify-between md:block md:rounded-2xl md:border md:border-border md:bg-card md:p-4 md:shadow-xs"
    >
      <input type="hidden" name="lijst" value={list} />
      <p className="min-w-0 text-sm text-muted md:hidden">
        <span className="font-medium text-ink">Filter:</span> {summary}
      </p>
      <FilterSheet activeCount={active} resetHref={`/dashboard/lijsten?lijst=${list}`} title="Lijsten filteren">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(5,minmax(0,1fr))_auto] lg:items-end">
          <Field label="Segment" htmlFor="filter-segment">
            <Select id="filter-segment" name="segment" defaultValue={filter.segment ?? ""}>
              <option value="">Alle segmenten</option>
              {segments.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Signaal" htmlFor="filter-signal">
            <Select id="filter-signal" name="signal" defaultValue={filter.signalType ?? ""}>
              <option value="">Alle signalen</option>
              {signalTypes.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Tier" htmlFor="filter-tier">
            <Select id="filter-tier" name="tier" defaultValue={filter.tier ? String(filter.tier) : ""}>
              <option value="">Alle tiers</option>
              <option value="1">Tier 1</option>
              <option value="2">Tier 2</option>
              <option value="3">Tier 3</option>
            </Select>
          </Field>
          <Field label="Minimale score" htmlFor="filter-score">
            <Input id="filter-score" name="min_score" type="number" min={0} max={100} inputMode="numeric" enterKeyHint="done" defaultValue={filter.minScore ?? ""} placeholder="0" />
          </Field>
          <Field label="Maximaal aantal" htmlFor="filter-limit">
            <Input id="filter-limit" name="limit" type="number" min={1} max={MAX_LIMIT} inputMode="numeric" enterKeyHint="done" defaultValue={filter.limit} />
          </Field>
          <Button type="submit" variant="secondary" className="max-md:hidden">
            Filteren
          </Button>
        </div>
      </FilterSheet>
    </Form>
  );
}
