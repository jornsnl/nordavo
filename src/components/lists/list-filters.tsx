import Form from "next/form";
import type { ListExportType } from "@/lib/database.types";
import type { ListFilter } from "@/lib/gtm/lists";
import { MAX_LIMIT } from "@/lib/gtm/lists";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { segments, signalTypes } from "@/lib/labels";

export function ListFilters({ filter, list }: { filter: ListFilter; list: ListExportType }) {
  return (
    <Form action="/dashboard/lijsten" className="mb-6 rounded-2xl border border-border bg-card p-4 shadow-xs">
      <input type="hidden" name="lijst" value={list} />
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
          <Input id="filter-score" name="min_score" type="number" min={0} max={100} inputMode="numeric" defaultValue={filter.minScore ?? ""} placeholder="0" />
        </Field>
        <Field label="Maximaal aantal" htmlFor="filter-limit">
          <Input id="filter-limit" name="limit" type="number" min={1} max={MAX_LIMIT} inputMode="numeric" defaultValue={filter.limit} />
        </Field>
        <Button type="submit" variant="secondary">
          Filteren
        </Button>
      </div>
    </Form>
  );
}
