/**
 * Bulk candidate import from the candidates list (feedback round 3): the
 * template to download and reading an Excel sheet into the same rows as a
 * CSV. Pure, so the wizard and the tests share it.
 */

export const TEMPLATE_HEADERS = [
  "Full name",
  "Email",
  "Phone",
  "LinkedIn URL",
  "Location",
  "Current title",
  "Current company",
  "Years of experience",
  "Skills",
  "Summary",
  "Video link",
] as const;

const EXAMPLE = [
  "Priya Sharma",
  "priya@example.com",
  "+91 98765 43210",
  "https://www.linkedin.com/in/example",
  "Bangalore",
  "Senior data engineer",
  "Example Tech",
  "6",
  "Python, dbt, Snowflake",
  "Builds data platforms",
  "",
];

function csvCell(value: string): string {
  return /[",\n;]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** The template as CSV text, with one example row. Opens in Excel and Google Sheets. */
export function candidateTemplateCsv(): string {
  return [TEMPLATE_HEADERS.join(","), EXAMPLE.map(csvCell).join(",")].join("\r\n") + "\r\n";
}

type Cell = string | number | boolean | Date | null | undefined;

function cellText(value: Cell): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "" : value.toISOString().slice(0, 10);
  return String(value).trim();
}

/**
 * The first sheet of a workbook to headers and rows like Papa.parse with a
 * header row: empty rows dropped, header names trimmed, duplicate or empty
 * headers made unique.
 */
export function rowsFromSheet(data: Cell[][]): { headers: string[]; rows: Record<string, string>[] } {
  const nonEmpty = data.filter((row) => row.some((c) => cellText(c) !== ""));
  if (nonEmpty.length === 0) return { headers: [], rows: [] };
  const seen = new Map<string, number>();
  const headers = nonEmpty[0].map((h, i) => {
    const base = cellText(h) || `Column ${i + 1}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base} (${count + 1})`;
  });
  const rows = nonEmpty.slice(1).map((row) => {
    const out: Record<string, string> = {};
    headers.forEach((h, i) => (out[h] = cellText(row[i])));
    return out;
  });
  return { headers, rows };
}
