// Fillable worksheets: the fields Nordavo defines on a document of kind
// worksheet (academy_documents.worksheet_fields) and the answers of a person
// (academy_worksheet_answers.answers, an object by field key). Pure, used by
// the editor, the player and the server actions; tested in
// tests/academy-media.test.ts. The database checks required fields again on
// submit (academy_worksheet_answers_guard).

import type { Json } from "@/lib/database.types";

export const WORKSHEET_FIELD_TYPES = ["short_text", "long_text", "choice", "checkbox", "number", "date"] as const;
export type WorksheetFieldType = (typeof WORKSHEET_FIELD_TYPES)[number];

export const WORKSHEET_FIELD_LABELS: Record<WorksheetFieldType, string> = {
  short_text: "Short text",
  long_text: "Long text",
  choice: "Choice (one option)",
  checkbox: "Checkbox (one, or several options)",
  number: "Number",
  date: "Date",
};

export type WorksheetField = {
  key: string;
  label: string;
  type: WorksheetFieldType;
  help: string;
  required: boolean;
  /** choice: the options; checkbox: options to tick (empty = one checkbox). */
  options: string[];
  /** number: optional bounds. */
  min: number | null;
  max: number | null;
};

export type WorksheetAnswers = Record<string, string | number | boolean | string[]>;

export const MAX_FIELDS = 60;
export const MAX_OPTIONS = 30;
const SHORT_MAX = 500;
const LONG_MAX = 20_000;

/** Aliases from the foundation comment (text, textarea). */
const TYPE_ALIASES: Record<string, WorksheetFieldType> = { text: "short_text", textarea: "long_text" };

function str(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

/** A field key from a label: lower case, a to z, digits and underscores. */
export function fieldKey(label: string, taken: Set<string>): string {
  const base =
    label
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "field";
  let key = base;
  for (let i = 2; taken.has(key); i += 1) key = `${base}_${i}`;
  return key;
}

/** The fields as stored: known types only, unique keys, cleaned options and bounds. */
export function normalizeFields(raw: Json | unknown): WorksheetField[] {
  if (!Array.isArray(raw)) return [];
  const taken = new Set<string>();
  const out: WorksheetField[] = [];
  for (const item of raw.slice(0, MAX_FIELDS)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const f = item as Record<string, unknown>;
    const rawType = typeof f.type === "string" ? (TYPE_ALIASES[f.type] ?? f.type) : "";
    if (!(WORKSHEET_FIELD_TYPES as readonly string[]).includes(rawType)) continue;
    const type = rawType as WorksheetFieldType;
    const label = str(f.label, 300);
    if (!label) continue;
    const wanted = typeof f.key === "string" && /^[a-z0-9_]{1,40}$/.test(f.key) && !taken.has(f.key) ? f.key : fieldKey(label, taken);
    taken.add(wanted);
    const options =
      type === "choice" || type === "checkbox"
        ? [...new Set((Array.isArray(f.options) ? f.options : []).map((o) => str(o, 200)).filter(Boolean))].slice(0, MAX_OPTIONS)
        : [];
    if (type === "choice" && options.length === 0) continue;
    let min = type === "number" ? num(f.min) : null;
    let max = type === "number" ? num(f.max) : null;
    if (min !== null && max !== null && min > max) [min, max] = [max, min];
    out.push({ key: wanted, label, type, help: str(f.help, 1000), required: f.required === true, options, min, max });
  }
  return out;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function validDate(value: string) {
  if (!DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** One value cleaned for its field, or undefined when it is empty or invalid. */
export function normalizeValue(field: WorksheetField, value: unknown): WorksheetAnswers[string] | undefined {
  switch (field.type) {
    case "short_text":
    case "long_text": {
      if (typeof value !== "string") return undefined;
      const text = value.replace(/\r\n?/g, "\n").slice(0, field.type === "short_text" ? SHORT_MAX : LONG_MAX);
      return text.trim() === "" ? undefined : text;
    }
    case "choice":
      return typeof value === "string" && field.options.includes(value) ? value : undefined;
    case "checkbox":
      if (field.options.length === 0) return value === true ? true : undefined;
      if (!Array.isArray(value)) return undefined;
      {
        const picked = field.options.filter((o) => value.includes(o));
        return picked.length > 0 ? picked : undefined;
      }
    case "number": {
      const n = num(value);
      if (n === null) return undefined;
      if (field.min !== null && n < field.min) return undefined;
      if (field.max !== null && n > field.max) return undefined;
      return n;
    }
    case "date":
      return typeof value === "string" && validDate(value) ? value : undefined;
  }
}

/** Answers limited to the fields, each value cleaned; unknown keys dropped. */
export function normalizeAnswers(fields: WorksheetField[], raw: unknown): WorksheetAnswers {
  const input = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out: WorksheetAnswers = {};
  for (const field of fields) {
    const value = normalizeValue(field, input[field.key]);
    if (value !== undefined) out[field.key] = value;
  }
  return out;
}

/** Whether a stored value counts as filled in (same rule as the SQL guard). */
export function isFilled(value: unknown): boolean {
  if (typeof value === "string") return value.trim() !== "";
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.length > 0;
  return false;
}

/** Required fields that are still empty. */
export function missingRequired(fields: WorksheetField[], answers: WorksheetAnswers): WorksheetField[] {
  return fields.filter((f) => f.required && !isFilled(answers[f.key]));
}

/** An answer as text for overviews and exports. */
export function answerText(field: WorksheetField, value: unknown, yes = "Yes"): string {
  if (value === undefined || value === null || value === "") return "";
  if (field.type === "checkbox" && field.options.length === 0) return value === true ? yes : "";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

/** CSV of all answers to a worksheet: one row per person. */
export function answersCsv(fields: WorksheetField[], rows: { name: string; email: string; submittedAt: string | null; answers: unknown }[]): string {
  const cell = (v: string) => (/[",\n;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const header = ["Name", "E-mail", "Submitted", ...fields.map((f) => f.label)];
  const lines = rows.map((r) => {
    const answers = normalizeAnswers(fields, r.answers);
    return [r.name, r.email, r.submittedAt ?? "", ...fields.map((f) => answerText(f, answers[f.key]))];
  });
  return [header, ...lines].map((line) => line.map(cell).join(",")).join("\n");
}
