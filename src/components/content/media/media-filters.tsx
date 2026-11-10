"use client";

import { useRouter, usePathname } from "next/navigation";
import { Input, Select } from "@/components/ui/field";
import type { MediaFacets, MediaFilters } from "@/lib/content/media-utils";

/** Filters of a media library, kept in the URL so a view can be shared. */
export function MediaFilterBar({ filters, facets }: { filters: MediaFilters; facets: MediaFacets }) {
  const router = useRouter();
  const pathname = usePathname();

  const apply = (form: HTMLFormElement) => {
    const params = new URLSearchParams();
    const data = new FormData(form);
    for (const [key, value] of data.entries()) {
      if (typeof value === "string" && value.trim()) params.set(key, value.trim());
    }
    router.replace(params.size ? `${pathname}?${params}` : pathname, { scroll: false });
  };

  return (
    <form
      role="search"
      className="mb-5 flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        apply(e.currentTarget);
      }}
      onChange={(e) => {
        const target = e.target as unknown as HTMLInputElement;
        if (target.tagName !== "INPUT" || target.type === "checkbox") apply(e.currentTarget);
      }}
    >
      <label className="sr-only" htmlFor="media-q">
        Search files
      </label>
      <Input id="media-q" name="q" type="search" placeholder="Search description, tags, people" defaultValue={filters.q ?? ""} className="max-w-64" />
      <FacetSelect name="person" label="Person" value={filters.person} values={facets.people} />
      <FacetSelect name="setting" label="Setting" value={filters.setting} values={facets.settings} />
      <FacetSelect name="tag" label="Tag" value={filters.tag} values={facets.tags} />
      <FacetSelect name="folder" label="Folder" value={filters.folder} values={facets.folders} />
      <label className="flex items-center gap-2 rounded-xl border border-border bg-white px-3 py-2 text-sm">
        <input type="checkbox" name="undescribed" value="1" defaultChecked={filters.undescribed} className="size-4 accent-brand-700" />
        Not described yet
      </label>
      <label className="flex items-center gap-2 rounded-xl border border-border bg-white px-3 py-2 text-sm">
        <input type="checkbox" name="unused" value="1" defaultChecked={filters.unused} className="size-4 accent-brand-700" />
        Not used yet
      </label>
    </form>
  );
}

function FacetSelect({ name, label, value, values }: { name: string; label: string; value?: string; values: string[] }) {
  if (values.length === 0) return null;
  return (
    <div className="w-40">
      <label className="sr-only" htmlFor={`media-${name}`}>
        {label}
      </label>
      <Select id={`media-${name}`} name={name} defaultValue={value ?? ""}>
        <option value="">Any {label.toLowerCase()}</option>
        {values.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </Select>
    </div>
  );
}
