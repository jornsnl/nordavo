// Saved views of the sales tables (feedback Julius, section 2.3 and 2.4).
//
// A view is { filters, sort, columns, widths, manualOrder }. The same pure
// engine runs in the browser (the spreadsheet table) and on the server (the
// call queue of a caller, a call list), so a call list is exactly what the
// table shows for that view. No server-only imports: safe everywhere.

import type { Json } from "@/lib/database.types";

export type FilterOp =
  | "contains"
  | "not_contains"
  | "equals"
  | "not_equals"
  | "in"
  | "not_in"
  | "empty"
  | "not_empty"
  | "gt"
  | "gte"
  | "lt"
  | "lte";

export type ColumnFilter = {
  column: string;
  op: FilterOp;
  /** A string for text ops, a number or date (YYYY-MM-DD) for comparisons, a list for in / not_in. */
  value?: string | number | string[] | null;
};

export type SortRule = { column: string; dir: "asc" | "desc" };

export type ViewConfig = {
  filters: ColumnFilter[];
  /** Applied in order: the first rule wins, the next breaks ties (multi-column sort). */
  sort: SortRule[];
  /** Visible columns in their order; undefined shows the defaults. */
  columns?: string[];
  /** Column widths in pixels. */
  widths?: Record<string, number>;
  /** Rows follow manual_position (dragged rows) when no sort is set. */
  manualOrder?: boolean;
  /** Free text over every visible column. */
  search?: string;
};

export const emptyView: ViewConfig = { filters: [], sort: [] };

const ops: FilterOp[] = [
  "contains",
  "not_contains",
  "equals",
  "not_equals",
  "in",
  "not_in",
  "empty",
  "not_empty",
  "gt",
  "gte",
  "lt",
  "lte",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads a stored config defensively: unknown keys and bad values are dropped. */
export function parseViewConfig(raw: Json | unknown): ViewConfig {
  if (!isRecord(raw)) return { filters: [], sort: [] };
  const filters: ColumnFilter[] = Array.isArray(raw.filters)
    ? raw.filters.flatMap((f) => {
        if (!isRecord(f) || typeof f.column !== "string" || !ops.includes(f.op as FilterOp)) return [];
        const value = f.value;
        const ok =
          value === undefined ||
          value === null ||
          typeof value === "string" ||
          typeof value === "number" ||
          (Array.isArray(value) && value.every((v) => typeof v === "string"));
        return ok ? [{ column: f.column, op: f.op as FilterOp, value: value as ColumnFilter["value"] }] : [];
      })
    : [];
  const sort: SortRule[] = Array.isArray(raw.sort)
    ? raw.sort.flatMap((s) =>
        isRecord(s) && typeof s.column === "string" && (s.dir === "asc" || s.dir === "desc")
          ? [{ column: s.column, dir: s.dir as "asc" | "desc" }]
          : [],
      )
    : [];
  const columns = Array.isArray(raw.columns) ? raw.columns.filter((c): c is string => typeof c === "string") : undefined;
  const widths = isRecord(raw.widths)
    ? Object.fromEntries(
        Object.entries(raw.widths).filter(([, w]) => typeof w === "number" && w >= 40 && w <= 1200) as [string, number][],
      )
    : undefined;
  return {
    filters,
    sort,
    columns,
    widths,
    manualOrder: raw.manualOrder === true,
    search: typeof raw.search === "string" ? raw.search.slice(0, 200) : undefined,
  };
}

export function viewConfigToJson(config: ViewConfig): Json {
  return JSON.parse(JSON.stringify(config)) as Json;
}

/** A value as the table compares it: strings lower case, arrays joined, dates as ISO strings. */
export type Accessor<T> = (row: T) => string | number | boolean | null | undefined | string[];

function asText(value: ReturnType<Accessor<unknown>>): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.join(", ").toLowerCase();
  return String(value).toLowerCase();
}

function isEmpty(value: ReturnType<Accessor<unknown>>): boolean {
  return value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
}

function compareValues(a: ReturnType<Accessor<unknown>>, b: ReturnType<Accessor<unknown>>): number {
  const aEmpty = isEmpty(a);
  const bEmpty = isEmpty(b);
  // Empty cells always sort last, whatever the direction (handled by the caller).
  if (aEmpty || bEmpty) return aEmpty === bEmpty ? 0 : aEmpty ? 1 : -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return a === b ? 0 : a ? -1 : 1;
  return asText(a).localeCompare(asText(b), "nl", { numeric: true });
}

export function matchesFilter(value: ReturnType<Accessor<unknown>>, filter: ColumnFilter): boolean {
  const target = filter.value;
  switch (filter.op) {
    case "empty":
      return isEmpty(value);
    case "not_empty":
      return !isEmpty(value);
    case "contains":
      return asText(value).includes(asText(target as string));
    case "not_contains":
      return !asText(value).includes(asText(target as string));
    case "equals":
      return Array.isArray(value)
        ? value.map((v) => v.toLowerCase()).includes(asText(target as string))
        : asText(value) === asText(target as string);
    case "not_equals":
      return Array.isArray(value)
        ? !value.map((v) => v.toLowerCase()).includes(asText(target as string))
        : asText(value) !== asText(target as string);
    case "in":
    case "not_in": {
      const list = (Array.isArray(target) ? target : target == null ? [] : [String(target)]).map((v) => v.toLowerCase());
      const values = Array.isArray(value) ? value.map((v) => v.toLowerCase()) : [asText(value)];
      const hit = values.some((v) => list.includes(v)) || (list.includes("") && isEmpty(value));
      return filter.op === "in" ? hit : !hit;
    }
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      if (isEmpty(value) || target === null || target === undefined || target === "") return false;
      const cmp =
        typeof value === "number" && !Number.isNaN(Number(target))
          ? value - Number(target)
          : asText(value).localeCompare(asText(target as string), "nl", { numeric: true });
      if (filter.op === "gt") return cmp > 0;
      if (filter.op === "gte") return cmp >= 0;
      if (filter.op === "lt") return cmp < 0;
      return cmp <= 0;
    }
  }
}

export type ApplyOptions<T> = {
  accessors: Record<string, Accessor<T>>;
  /** Used when the view has no sort and no manual order. */
  defaultSort?: SortRule[];
  /** Pinned rows stay on top (section 2.4 point 3). */
  pinnedAt?: (row: T) => string | null | undefined;
  /** Dragged order (section 2.4 point 2). */
  manualPosition?: (row: T) => number | null | undefined;
  /** Columns the free text search looks in; defaults to every accessor. */
  searchColumns?: string[];
};

/** Filters and sorts rows for a view. Stable: equal rows keep their input order. */
export function applyView<T>(rows: T[], config: ViewConfig, options: ApplyOptions<T>): T[] {
  const { accessors } = options;
  const filters = config.filters.filter((f) => accessors[f.column]);
  const search = config.search?.trim().toLowerCase();
  const searchColumns = (options.searchColumns ?? config.columns ?? Object.keys(accessors)).filter((c) => accessors[c]);

  const filtered = rows.filter((row) => {
    for (const f of filters) {
      if (!matchesFilter(accessors[f.column](row), f)) return false;
    }
    if (search) {
      return searchColumns.some((c) => asText(accessors[c](row)).includes(search));
    }
    return true;
  });

  const sort = (config.sort.length > 0 ? config.sort : config.manualOrder ? [] : (options.defaultSort ?? [])).filter(
    (s) => accessors[s.column],
  );
  const indexed = filtered.map((row, index) => ({ row, index }));
  indexed.sort((a, b) => {
    if (options.pinnedAt) {
      const pa = options.pinnedAt(a.row) ?? null;
      const pb = options.pinnedAt(b.row) ?? null;
      if (pa && !pb) return -1;
      if (!pa && pb) return 1;
      if (pa && pb && pa !== pb) return pa < pb ? -1 : 1;
    }
    for (const rule of sort) {
      const va = accessors[rule.column](a.row);
      const vb = accessors[rule.column](b.row);
      if (isEmpty(va) || isEmpty(vb)) {
        const c = compareValues(va, vb);
        if (c !== 0) return c;
        continue;
      }
      const c = compareValues(va, vb);
      if (c !== 0) return rule.dir === "asc" ? c : -c;
    }
    if (config.manualOrder && config.sort.length === 0 && options.manualPosition) {
      const ma = options.manualPosition(a.row);
      const mb = options.manualPosition(b.row);
      if (ma != null && mb != null && ma !== mb) return ma - mb;
      if (ma != null && mb == null) return -1;
      if (ma == null && mb != null) return 1;
    }
    return a.index - b.index;
  });
  return indexed.map((i) => i.row);
}

/** A position between two neighbours, for dragging a row (fractional ordering). */
export function positionBetween(before: number | null | undefined, after: number | null | undefined): number {
  if (before == null && after == null) return 1024;
  if (before == null) return (after as number) - 1024;
  if (after == null) return before + 1024;
  return (before + after) / 2;
}

/** Tab separated text, as Excel copies cells. Quotes cells that need it. */
export function toTsv(rows: (string | number | null | undefined)[][]): string {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          const text = cell === null || cell === undefined ? "" : String(cell);
          return /[\t\n"]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
        })
        .join("\t"),
    )
    .join("\n");
}

/** Parses what Excel or Google Sheets put on the clipboard (TSV with quoted cells). */
export function parseTsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const input = text.replace(/\r\n?/g, "\n");
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"' && cell === "") {
      quoted = true;
    } else if (ch === "\t") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
