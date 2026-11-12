/**
 * Sorting the vacancy list (feedback round 3). Pure, so the page and the
 * tests share it. The sort lives in the URL (?sort=days_open&dir=desc).
 */

export const VACANCY_SORTS = ["role", "client", "seniority", "status", "stage", "pipeline", "days_open", "lead_time", "flow_deadline"] as const;
export type VacancySort = (typeof VACANCY_SORTS)[number];
export type SortDir = "asc" | "desc";

export function isVacancySort(value: unknown): value is VacancySort {
  return VACANCY_SORTS.includes(value as VacancySort);
}

/** Numbers and dates start high first; text starts A to Z. */
export function defaultDir(sort: VacancySort): SortDir {
  return sort === "pipeline" || sort === "days_open" || sort === "lead_time" ? "desc" : "asc";
}

export type SortableVacancy = {
  title: string;
  owner: string;
  seniorityRank: number;
  statusRank: number;
  stageRank: number;
  inPipeline: number;
  daysOpen: number;
  leadDays: number | null;
  flowDeadline: string | null;
};

function compareValues(a: string | number | null, b: string | number | null): number {
  // Empty values always go last, whatever the direction.
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), "en", { sensitivity: "base" });
}

function key(v: SortableVacancy, sort: VacancySort): string | number | null {
  switch (sort) {
    case "role":
      return v.title;
    case "client":
      return v.owner;
    case "seniority":
      return v.seniorityRank;
    case "status":
      return v.statusRank;
    case "stage":
      return v.stageRank;
    case "pipeline":
      return v.inPipeline;
    case "days_open":
      return v.daysOpen;
    case "lead_time":
      return v.leadDays;
    case "flow_deadline":
      return v.flowDeadline;
  }
}

/** A sorted copy; ties keep their original order. */
export function sortVacancies<T>(items: T[], view: (item: T) => SortableVacancy, sort: VacancySort | null, dir: SortDir): T[] {
  if (!sort) return items;
  return items
    .map((item, i) => ({ item, i, v: view(item) }))
    .sort((x, y) => {
      const a = key(x.v, sort);
      const b = key(y.v, sort);
      if (a === null || b === null) return compareValues(a, b) || x.i - y.i;
      const c = compareValues(a, b);
      return (dir === "desc" ? -c : c) || x.i - y.i;
    })
    .map((x) => x.item);
}

/** Next direction when a header is clicked: flip on the active column, else the column's default. */
export function nextDir(active: VacancySort | null, dir: SortDir, column: VacancySort): SortDir {
  if (active === column) return dir === "asc" ? "desc" : "asc";
  return defaultDir(column);
}
