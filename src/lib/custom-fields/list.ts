import "server-only";
import {
  applyListFilters,
  filterParam,
  filtersFromParams,
  sortFromParams,
  type CustomFieldDefinition,
  type CustomFieldValues,
  type ListFilter,
  type ListSort,
} from "@/lib/custom-fields";
import { listCandidateCustomValues, listCustomFieldDefinitions } from "@/lib/custom-fields/data";

type Params = Record<string, string | string[] | undefined>;

export type CandidateListFields = {
  /** Fields shown as columns ("Show as a column on the candidates list"). */
  defs: CustomFieldDefinition[];
  values: Map<string, CustomFieldValues>;
  filters: ListFilter[];
  sort: ListSort | null;
  /** Applies the custom field filters and sort to the list. */
  apply: <T extends { id: string }>(rows: T[]) => T[];
  /** Link to the list with these params changed (undefined removes one). */
  href: (change: Record<string, string | undefined>) => string;
  /** Current params that are not custom field filters, to keep in a filter form. */
  keep: Record<string, string>;
};

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;

/** Custom field columns, filters and sort for the candidates list. */
export async function candidateListFields(params: Params, basePath = "/dashboard/candidates"): Promise<CandidateListFields> {
  const defs = (await listCustomFieldDefinitions({ entity: "candidate" })).filter((d) => d.showInList);
  const filters = filtersFromParams(defs, params);
  const sort = sortFromParams(defs, params);
  const values = defs.length > 0 ? await listCandidateCustomValues() : new Map<string, CustomFieldValues>();

  const current: Record<string, string> = {};
  for (const key of ["q", "status", "skill", "sort", "dir"]) {
    const value = one(params[key]);
    if (value) current[key] = value;
  }
  for (const f of filters) current[filterParam(f.def.key)] = f.value;

  const keep = Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith("cf_")));

  return {
    defs,
    values,
    filters,
    sort,
    keep,
    apply: (rows) => (defs.length === 0 ? rows : applyListFilters(rows, values, filters, sort)),
    href: (change) => {
      const next = new URLSearchParams();
      for (const [key, value] of Object.entries({ ...current, ...change })) if (value) next.set(key, value);
      const query = next.toString();
      return query ? `${basePath}?${query}` : basePath;
    },
  };
}
