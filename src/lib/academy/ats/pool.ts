// The talent pool with Academy columns (/dashboard/candidates/academy):
// URL parameters to filters, filters to the arguments of academy_ats_pool(),
// links for sorting and paging. Pure, tested in tests/academy-ats.test.ts.

import type { AtsPoolArgs } from "@/lib/academy/ats/database";

export const POOL_PAGE_SIZE = 50;

export const POOL_SORTS = [
  "name",
  "progress",
  "lessons",
  "check",
  "ai",
  "final",
  "watch",
  "last_activity",
  "lead_time",
  "started",
  "certificate",
] as const;
export type PoolSort = (typeof POOL_SORTS)[number];

export const POOL_STATES = [
  { value: "not_started", label: "Enrolled, not started" },
  { value: "in_progress", label: "In progress" },
  { value: "completed", label: "Completed" },
] as const;
export type PoolState = (typeof POOL_STATES)[number]["value"];

export type PoolFilters = {
  q?: string;
  enrolled?: boolean;
  state?: PoolState;
  inactive?: boolean;
  certificate?: boolean;
  top?: boolean;
  minProgress?: number;
  minCheck?: number;
  vacancy?: string;
  group?: string;
  sort: PoolSort;
  desc: boolean;
  page: number;
};

type Params = Record<string, string | string[] | undefined>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function one(value: string | string[] | undefined): string | undefined {
  const v = (Array.isArray(value) ? value[0] : value)?.trim();
  return v ? v : undefined;
}

function yesNo(value: string | undefined): boolean | undefined {
  if (value === "yes" || value === "1" || value === "true") return true;
  if (value === "no" || value === "0" || value === "false") return false;
  return undefined;
}

function percent(value: string | undefined): number | undefined {
  if (!value || !/^\d{1,3}$/.test(value)) return undefined;
  return Math.min(100, Number(value));
}

/** Search parameters of the page to filters; anything unknown is dropped. */
export function parsePoolParams(params: Params): PoolFilters {
  const sort = one(params.sort);
  const state = one(params.state);
  const page = Number(one(params.page) ?? "1");
  const vacancy = one(params.vacancy);
  const group = one(params.group);
  const q = one(params.q)?.slice(0, 100);
  return {
    q,
    enrolled: yesNo(one(params.enrolled)),
    state: POOL_STATES.some((s) => s.value === state) ? (state as PoolState) : undefined,
    inactive: yesNo(one(params.inactive)) === true ? true : undefined,
    certificate: yesNo(one(params.certificate)),
    top: yesNo(one(params.top)),
    minProgress: percent(one(params.min_progress)),
    minCheck: percent(one(params.min_check)),
    vacancy: vacancy && UUID.test(vacancy) ? vacancy : undefined,
    group: group && UUID.test(group) ? group : undefined,
    sort: POOL_SORTS.includes(sort as PoolSort) ? (sort as PoolSort) : "name",
    desc: one(params.dir) === "desc",
    page: Number.isInteger(page) && page >= 1 && page <= 1000 ? page : 1,
  };
}

/** The arguments of academy_ats_pool() for these filters and one page. */
export function poolArgs(filters: PoolFilters, pageSize = POOL_PAGE_SIZE): AtsPoolArgs {
  return {
    p_search: filters.q ?? null,
    p_enrolled: filters.enrolled ?? null,
    p_state: filters.state ?? null,
    p_inactive: filters.inactive ?? null,
    p_certificate: filters.certificate ?? null,
    p_top: filters.top ?? null,
    p_min_progress: filters.minProgress ?? null,
    p_min_check: filters.minCheck ?? null,
    p_vacancy_id: filters.vacancy ?? null,
    p_group_id: filters.group ?? null,
    p_sort: filters.sort,
    p_desc: filters.desc,
    p_limit: pageSize,
    p_offset: (filters.page - 1) * pageSize,
  };
}

/** Filters back to URL parameters (defaults left out). */
export function poolQuery(filters: PoolFilters): URLSearchParams {
  const q = new URLSearchParams();
  const bool = (key: string, value: boolean | undefined) => {
    if (value !== undefined) q.set(key, value ? "yes" : "no");
  };
  if (filters.q) q.set("q", filters.q);
  bool("enrolled", filters.enrolled);
  if (filters.state) q.set("state", filters.state);
  if (filters.inactive) q.set("inactive", "yes");
  bool("certificate", filters.certificate);
  bool("top", filters.top);
  if (filters.minProgress !== undefined) q.set("min_progress", String(filters.minProgress));
  if (filters.minCheck !== undefined) q.set("min_check", String(filters.minCheck));
  if (filters.vacancy) q.set("vacancy", filters.vacancy);
  if (filters.group) q.set("group", filters.group);
  if (filters.sort !== "name") q.set("sort", filters.sort);
  if (filters.desc) q.set("dir", "desc");
  if (filters.page > 1) q.set("page", String(filters.page));
  return q;
}

export function poolHref(base: string, filters: PoolFilters, changes: Partial<PoolFilters> = {}): string {
  const query = poolQuery({ ...filters, ...changes }).toString();
  return query ? `${base}?${query}` : base;
}

/**
 * The link of a column header: sort on it (numbers start high, names A to
 * Z), or flip the direction when it is already the sort. Back to page 1.
 */
export function sortHref(base: string, filters: PoolFilters, column: PoolSort): string {
  const desc = filters.sort === column ? !filters.desc : column !== "name";
  return poolHref(base, filters, { sort: column, desc, page: 1 });
}

/** Whether any filter narrows the list (sort and page do not). */
export function hasPoolFilter(filters: PoolFilters): boolean {
  const narrowing: (keyof PoolFilters)[] = ["q", "enrolled", "state", "inactive", "certificate", "top", "minProgress", "minCheck", "vacancy", "group"];
  return narrowing.some((key) => filters[key] !== undefined);
}

/** "today", "1 day", "12 days". */
export function formatDays(days: number | null | undefined): string {
  if (days === null || days === undefined) return "";
  if (days <= 0) return "today";
  return days === 1 ? "1 day" : `${days} days`;
}

/** "67%" or an empty string. */
export function formatPercent(value: number | null | undefined): string {
  return value === null || value === undefined ? "" : `${Math.round(value)}%`;
}

export function pageCount(total: number, pageSize = POOL_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/** A count as a share of the cohort, 0 to 100, for funnel bars. */
export function funnelShare(count: number, cohort: number): number {
  if (cohort <= 0 || count <= 0) return 0;
  return Math.min(100, Math.round((count * 100) / cohort));
}

export const SCORE_BUCKETS = ["0-49", "50-69", "70-89", "90-100"] as const;

/** The score distribution of a group report in bucket order, with each share of the scored people. */
export function scoreBuckets(distribution: Record<string, number> | null | undefined): { bucket: string; count: number; share: number }[] {
  const counts = SCORE_BUCKETS.map((bucket) => ({ bucket, count: Math.max(0, Number(distribution?.[bucket] ?? 0) || 0) }));
  const scored = counts.reduce((sum, c) => sum + c.count, 0);
  return counts.map((c) => ({ ...c, share: scored > 0 ? Math.round((c.count * 100) / scored) : 0 }));
}
