"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Select } from "@/components/ui/field";

export type FilterOption = { value: string; label: string };
export type FilterDef = { name: string; label: string; options: FilterOption[]; all: string };

/**
 * Filters as select boxes that update the URL (?workspace=&status=...), so a
 * filtered view can be bookmarked and shared. Other params, like the tab, stay.
 */
export function FilterBar({ filters, basePath }: { filters: FilterDef[]; basePath: string }) {
  const router = useRouter();
  const params = useSearchParams();

  function change(name: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(name, value);
    else next.delete(name);
    // A project belongs to one workspace; changing the workspace resets it.
    if (name === "workspace") next.delete("project");
    const query = next.toString();
    router.replace(query ? `${basePath}?${query}` : basePath, { scroll: false });
  }

  return (
    <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
      {filters.map((filter) => (
        <label key={filter.name} className="min-w-0 sm:w-44">
          <span className="sr-only">{filter.label}</span>
          <Select
            value={params.get(filter.name) ?? ""}
            onChange={(e) => change(filter.name, e.target.value)}
            className="w-full py-2"
            aria-label={filter.label}
          >
            <option value="">{filter.all}</option>
            {filter.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </label>
      ))}
    </div>
  );
}
