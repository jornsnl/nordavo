"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Select } from "@/components/ui/field";
import { SearchSelect } from "@/components/ui/search-select";

export type FilterOption = { value: string; label: string };
export type FilterDef = {
  name: string;
  label: string;
  options: FilterOption[];
  all: string;
  /** A list that can grow long (projects): a search field instead of a native select. */
  searchable?: boolean;
};

/** Short fixed lists (status, workspace, a few people) stay native selects. */
const SEARCH_FROM = 12;

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
    // On phones the filters share one row: equal parts while they fit, sideways scrolling when there are
    // more (with type and label up to five), so each keeps a readable width.
    <div
      className={`flex min-w-0 items-center gap-2 sm:flex-wrap sm:*:flex-none ${
        filters.length > 3 ? "snap-strip scrollbar-none -mx-4 px-4 *:w-40 *:shrink-0 sm:mx-0 sm:px-0" : "*:min-w-0 *:flex-1"
      }`}
    >
      {filters.map((filter) =>
        filter.searchable || filter.options.length > SEARCH_FROM ? (
          <div key={filter.name} className="min-w-0 sm:w-56">
            <SearchSelect
              value={params.get(filter.name) || null}
              onChange={(value) => change(filter.name, value ?? "")}
              aria-label={filter.label}
              placeholder={filter.all}
              searchPlaceholder={`Search ${filter.label.toLowerCase()}`}
              options={filter.options}
            />
          </div>
        ) : (
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
        ),
      )}
    </div>
  );
}
