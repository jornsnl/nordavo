import type { ListFilter } from "@/lib/gtm/lists";

/** The active filter as hidden inputs, so an export uses exactly what the preview shows. */
export function FilterFields({ filter, omit = [] }: { filter: ListFilter; omit?: ("segment" | "signal" | "tier" | "min_score" | "limit")[] }) {
  const fields: [string, string | number | undefined][] = [
    ["segment", filter.segment],
    ["signal", filter.signalType],
    ["tier", filter.tier],
    ["min_score", filter.minScore],
    ["limit", filter.limit],
  ];
  return (
    <>
      {fields
        .filter(([name, value]) => value !== undefined && !omit.includes(name as (typeof omit)[number]))
        .map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={String(value)} />
        ))}
    </>
  );
}

/** Query string for links that keep the active filter. */
export function filterQuery(filter: ListFilter, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams();
  if (filter.segment) params.set("segment", filter.segment);
  if (filter.signalType) params.set("signal", filter.signalType);
  if (filter.tier) params.set("tier", String(filter.tier));
  if (filter.minScore) params.set("min_score", String(filter.minScore));
  params.set("limit", String(filter.limit));
  for (const [key, value] of Object.entries(extra)) params.set(key, value);
  return params.toString();
}
