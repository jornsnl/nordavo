// CSV exports of candidates, vacancies, clients and placements, with every
// custom field as a column (feedback Julius: "Eigen velden meenemen in export
// en MCP"). Pure, so the routes and the tests share it. A field the team
// adds, renames or archives shows up, changes or disappears in the next export
// by itself: the columns are built from the definitions at export time.

import { asValues, type CustomFieldDefinition, type CustomFieldValue } from "@/lib/custom-fields";

export type CsvValue = string | number | boolean | string[] | null | undefined;

export type ExportColumn<T> = { header: string; value: (row: T) => CsvValue };

/** One cell, safe for Excel: formulas are neutralised, quotes doubled. */
export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  const text = Array.isArray(value) ? value.join("; ") : typeof value === "boolean" ? (value ? "Yes" : "No") : String(value);
  // A leading = + - @ would run as a formula in Excel; numbers stay numbers.
  const safe = typeof value !== "number" && /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** The value of a custom field in a cell: raw (ISO dates, plain numbers), lists joined with "; ". */
export function customFieldCell(def: Pick<CustomFieldDefinition, "fieldType">, value: CustomFieldValue | undefined): CsvValue {
  if (value === undefined || value === null || value === "") return null;
  if (def.fieldType === "boolean") return value === true;
  return value;
}

/**
 * Columns for the active custom fields, in their order. Headers are the
 * labels; a label that clashes with a fixed column (or another field) gets
 * "(custom)" so no column is ambiguous.
 */
export function customFieldColumns<T>(
  defs: CustomFieldDefinition[],
  valuesOf: (row: T) => unknown,
  taken: Iterable<string> = [],
): ExportColumn<T>[] {
  const used = new Set([...taken].map((h) => h.toLowerCase()));
  return defs
    .filter((d) => !d.archivedAt)
    .sort((a, b) => a.position - b.position)
    .map((def) => {
      let header = def.label;
      if (used.has(header.toLowerCase())) header = `${def.label} (custom)`;
      if (used.has(header.toLowerCase())) header = `${def.label} (${def.key})`;
      used.add(header.toLowerCase());
      return { header, value: (row: T) => customFieldCell(def, asValues(valuesOf(row))[def.key]) };
    });
}

/** Rows to CSV text with a header line (no BOM; the route adds one for Excel). */
export function toCsv<T>(columns: ExportColumn<T>[], rows: T[]): string {
  const lines = [columns.map((c) => csvCell(c.header)).join(",")];
  for (const row of rows) lines.push(columns.map((c) => csvCell(c.value(row))).join(","));
  return lines.join("\r\n");
}

/** File name: nordavo-candidates-2026-11-12.csv */
export function exportFileName(what: string, today: string): string {
  return `nordavo-${what.replace(/[^a-z0-9-]+/gi, "-").toLowerCase()}-${today}.csv`;
}
