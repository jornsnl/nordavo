"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Input, Select } from "@/components/ui/field";
import type { TimeZoneGroup } from "@/lib/work/time-zones";

/**
 * Every IANA time zone, grouped by region with the popular ones first, and a
 * search box that narrows the list (city, region or offset such as "+05:30").
 * The current zone always stays in the list so the select never jumps.
 */
export function TimeZonePicker({
  id,
  name,
  value,
  groups,
}: {
  id: string;
  name: string;
  value: string;
  groups: TimeZoneGroup[];
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(value);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/_/g, " ");
    if (!q) return groups;
    return groups
      .filter((g) => g.region !== "Popular")
      .map((g) => ({
        ...g,
        zones: g.zones.filter((z) => z.value === selected || z.search.includes(q) || g.region.toLowerCase().includes(q)),
      }))
      .filter((g) => g.zones.length > 0);
  }, [groups, query, selected]);

  const count = filtered.reduce((n, g) => n + (g.region === "Popular" ? 0 : g.zones.length), 0);

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
        <Input
          type="search"
          aria-label="Search time zones"
          aria-controls={id}
          placeholder="Search city or offset, e.g. Kolkata or +05:30"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-9"
        />
      </div>
      <Select id={id} name={name} value={selected} onChange={(e) => setSelected(e.target.value)}>
        {filtered.map((group) => (
          <optgroup key={group.region} label={group.region}>
            {group.zones.map((zone) => (
              <option key={`${group.region}:${zone.value}`} value={zone.value}>
                {zone.label} ({zone.offset})
              </option>
            ))}
          </optgroup>
        ))}
      </Select>
      {query && (
        <p className="text-xs text-muted" aria-live="polite">
          {count === 1 ? "1 zone matches" : `${count} zones match`}
        </p>
      )}
    </div>
  );
}
