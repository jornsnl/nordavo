// Custom fields: the rules the app applies before the database applies the
// same ones again (public.validate_custom_fields). Pure functions only, so
// the forms, the list filters and the tests share them.

import type { CustomFieldEntity, CustomFieldType, CustomFieldValues } from "@/lib/database.types";

export type { CustomFieldEntity, CustomFieldType, CustomFieldValues };
export type CustomFieldValue = CustomFieldValues[string];

export type CustomFieldDefinition = {
  id: string;
  entity: CustomFieldEntity;
  key: string;
  label: string;
  fieldType: CustomFieldType;
  options: string[];
  helpText: string | null;
  position: number;
  showInList: boolean;
  archivedAt: string | null;
  /** Block of the record page the field is shown in (layout.ts); "custom" by default. */
  blockKey: string;
};

export const customFieldEntities: { value: CustomFieldEntity; label: string; plural: string }[] = [
  { value: "candidate", label: "Candidate", plural: "Candidates" },
  { value: "vacancy", label: "Vacancy", plural: "Vacancies" },
  { value: "client", label: "Client", plural: "Clients" },
  { value: "placement", label: "Placement", plural: "Placements" },
  { value: "application", label: "Application", plural: "Applications (pipeline card)" },
];

export const customFieldTypes: { value: CustomFieldType; label: string; hint: string }[] = [
  { value: "text", label: "Text", hint: "One line, up to 500 characters" },
  { value: "long_text", label: "Long text", hint: "Several lines, up to 10,000 characters" },
  { value: "number", label: "Number", hint: "Whole or decimal number" },
  { value: "date", label: "Date", hint: "A calendar day" },
  { value: "boolean", label: "Yes/no", hint: "A checkbox" },
  { value: "single_choice", label: "Single choice", hint: "One of a list of options" },
  { value: "multi_choice", label: "Multiple choice", hint: "Any of a list of options" },
  { value: "url", label: "Link", hint: "A web address starting with http:// or https://" },
];

export const TEXT_MAX = 500;
export const LONG_TEXT_MAX = 10_000;
export const URL_MAX = 2000;
export const LABEL_MAX = 80;
export const OPTION_MAX = 80;
export const OPTIONS_MAX = 100;
export const KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;

export function isCustomFieldEntity(value: unknown): value is CustomFieldEntity {
  return customFieldEntities.some((e) => e.value === value);
}

export function isCustomFieldType(value: unknown): value is CustomFieldType {
  return customFieldTypes.some((t) => t.value === value);
}

export function isChoiceType(type: CustomFieldType): boolean {
  return type === "single_choice" || type === "multi_choice";
}

export function typeLabel(type: CustomFieldType): string {
  return customFieldTypes.find((t) => t.value === type)?.label ?? type;
}

/** "Expected salary (LPA)" to "expected_salary_lpa". Unique against `taken`. */
export function keyFromLabel(label: string, taken: Iterable<string> = []): string {
  const base =
    label
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .replace(/^(\d)/, "f_$1")
      .slice(0, 36)
      .replace(/_+$/, "") || "field";
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base}_${n}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${base}_${Date.now() % 100000}`;
}

/** Options typed one per line (or comma separated): trimmed, empty ones dropped. Duplicates are an error. */
export function parseOptions(input: string): { options: string[]; error?: string } {
  const raw = input.includes("\n") ? input.split("\n") : input.split(",");
  const options: string[] = [];
  for (const part of raw) {
    const option = part.trim();
    if (!option) continue;
    if (option.length > OPTION_MAX) return { options, error: `An option can be at most ${OPTION_MAX} characters.` };
    if (options.includes(option)) return { options, error: `Option "${option}" appears twice.` };
    options.push(option);
  }
  if (options.length > OPTIONS_MAX) return { options, error: `At most ${OPTIONS_MAX} options.` };
  return { options };
}

export type DefinitionInput = {
  entity: CustomFieldEntity;
  label: string;
  fieldType: CustomFieldType;
  options: string[];
  helpText: string | null;
  showInList: boolean;
  blockKey: string;
};

/** The default block of a field: "Custom fields". */
export const DEFAULT_BLOCK = "custom";

/** Checks a new or edited definition. Field errors by form field name. */
export function validateDefinition(input: {
  entity: unknown;
  label: unknown;
  field_type: unknown;
  options?: unknown;
  help_text?: unknown;
  show_in_list?: unknown;
  block_key?: unknown;
}): { ok: true; value: DefinitionInput } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const label = typeof input.label === "string" ? input.label.trim() : "";
  if (!label) errors.label = "Give the field a name.";
  else if (label.length > LABEL_MAX) errors.label = `At most ${LABEL_MAX} characters.`;
  if (!isCustomFieldEntity(input.entity)) errors.entity = "Pick where the field goes.";
  if (!isCustomFieldType(input.field_type)) errors.field_type = "Pick a type.";
  const helpText = typeof input.help_text === "string" ? input.help_text.trim() : "";
  if (helpText.length > 300) errors.help_text = "At most 300 characters.";

  let options: string[] = [];
  if (isCustomFieldType(input.field_type) && isChoiceType(input.field_type)) {
    const parsed = parseOptions(typeof input.options === "string" ? input.options : "");
    options = parsed.options;
    if (parsed.error) errors.options = parsed.error;
    else if (options.length === 0) errors.options = "Add at least one option.";
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      entity: input.entity as CustomFieldEntity,
      label,
      fieldType: input.field_type as CustomFieldType,
      options,
      helpText: helpText || null,
      showInList: input.show_in_list === true || input.show_in_list === "on" || input.show_in_list === "true",
      blockKey: typeof input.block_key === "string" && KEY_PATTERN.test(input.block_key) ? input.block_key : DEFAULT_BLOCK,
    },
  };
}

function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

const URL_PATTERN = /^https?:\/\/[^\s/$.?#][^\s]*$/i;

export type ValueResult = { ok: true; value: CustomFieldValue | null } | { ok: false; error: string };

/**
 * Checks one value against its definition, as the database does. `null`
 * means "empty": the key is removed. Accepts the raw JSON value.
 */
export function validateValue(def: Pick<CustomFieldDefinition, "label" | "fieldType" | "options">, value: unknown): ValueResult {
  if (value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) {
    return { ok: true, value: null };
  }
  const fail = (error: string): ValueResult => ({ ok: false, error });
  switch (def.fieldType) {
    case "text":
      if (typeof value !== "string" || value.length > TEXT_MAX) return fail(`At most ${TEXT_MAX} characters.`);
      return { ok: true, value };
    case "long_text":
      if (typeof value !== "string" || value.length > LONG_TEXT_MAX) return fail(`At most ${LONG_TEXT_MAX} characters.`);
      return { ok: true, value };
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) return fail("Enter a number.");
      return { ok: true, value };
    case "date":
      if (typeof value !== "string" || !isRealDate(value)) return fail("Enter a date.");
      return { ok: true, value };
    case "boolean":
      if (typeof value !== "boolean") return fail("Choose yes or no.");
      return { ok: true, value };
    case "single_choice":
      if (typeof value !== "string" || !def.options.includes(value)) return fail("Pick one of the options.");
      return { ok: true, value };
    case "multi_choice": {
      if (!Array.isArray(value)) return fail("Pick from the options.");
      const seen = new Set<string>();
      for (const item of value) {
        if (typeof item !== "string" || !def.options.includes(item) || seen.has(item)) return fail("Pick from the options, each once.");
        seen.add(item);
      }
      return { ok: true, value: value as string[] };
    }
    case "url":
      if (typeof value !== "string" || value.length > URL_MAX || !URL_PATTERN.test(value)) {
        return fail("Enter a link starting with http:// or https://.");
      }
      return { ok: true, value };
  }
}

/**
 * Turns what a form sent for a field into a value: text inputs give strings,
 * a checkbox "on" or nothing, multiple choice several entries.
 */
export function parseFormValue(def: Pick<CustomFieldDefinition, "label" | "fieldType" | "options">, raw: string[]): ValueResult {
  const first = (raw[0] ?? "").trim();
  switch (def.fieldType) {
    case "text":
    case "single_choice":
    case "date":
      return validateValue(def, first);
    case "long_text":
      return validateValue(def, (raw[0] ?? "").replace(/\r\n/g, "\n").trim());
    case "url": {
      // "github.com/asha" is meant as https://github.com/asha.
      const url = first && !/^[a-z][a-z0-9+.-]*:/i.test(first) ? `https://${first}` : first;
      return validateValue(def, url);
    }
    case "number": {
      if (!first) return { ok: true, value: null };
      const normalized = first.replace(/\s/g, "").replace(",", ".");
      if (!/^-?\d+(\.\d+)?$/.test(normalized)) return { ok: false, error: "Enter a number." };
      return validateValue(def, Number(normalized));
    }
    case "boolean": {
      // A yes/no select: "yes", "no" or "" (not set).
      if (first === "yes" || first === "on" || first === "true") return { ok: true, value: true };
      if (first === "no" || first === "false") return { ok: true, value: false };
      return { ok: true, value: null };
    }
    case "multi_choice":
      return validateValue(def, raw.map((r) => r.trim()).filter(Boolean));
  }
}

/** Plain text for showing a value. Options that no longer exist are marked. */
export function formatValue(def: Pick<CustomFieldDefinition, "fieldType" | "options">, value: CustomFieldValue | undefined | null): string {
  if (value === undefined || value === null || value === "") return "";
  switch (def.fieldType) {
    case "boolean":
      return value === true ? "Yes" : value === false ? "No" : "";
    case "number":
      return typeof value === "number" ? new Intl.NumberFormat("en-GB", { maximumFractionDigits: 6 }).format(value) : String(value);
    case "date": {
      if (typeof value !== "string" || !isRealDate(value)) return String(value);
      return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(
        new Date(`${value}T00:00:00Z`),
      );
    }
    case "multi_choice":
      return (Array.isArray(value) ? value : [String(value)])
        .map((v) => (def.options.includes(v) ? v : `${v} (removed option)`))
        .join(", ");
    case "single_choice":
      return typeof value === "string" && !def.options.includes(value) ? `${value} (removed option)` : String(value);
    default:
      return String(value);
  }
}

/** Value for a form control's default. */
export function inputValue(def: Pick<CustomFieldDefinition, "fieldType">, value: CustomFieldValue | undefined | null): string {
  if (value === undefined || value === null) return "";
  if (def.fieldType === "boolean") return value === true ? "yes" : value === false ? "no" : "";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

/** Read a jsonb value from the database into a value map, dropping anything that is not an object. */
export function asValues(raw: unknown): CustomFieldValues {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as CustomFieldValues) : {};
}

// ---------------------------------------------------------------------------
// List columns: filter and sort on custom fields (candidates list)
// ---------------------------------------------------------------------------

/** Search parameter for a filter on a field: cf_<key>. */
export const filterParam = (key: string) => `cf_${key}`;
/** Sort parameter value for a field: cf_<key>, with dir=asc|desc. */
export const sortParam = filterParam;

export type ListFilter = { def: CustomFieldDefinition; value: string };

/** Filters from search params, only for list fields. Empty values are ignored. */
export function filtersFromParams(defs: CustomFieldDefinition[], params: Record<string, string | string[] | undefined>): ListFilter[] {
  const filters: ListFilter[] = [];
  for (const def of defs) {
    const raw = params[filterParam(def.key)];
    const value = (Array.isArray(raw) ? raw[0] : raw)?.trim();
    if (value) filters.push({ def, value: value.slice(0, 200) });
  }
  return filters;
}

/**
 * Does a record's value pass a filter? Choice and yes/no fields match exactly
 * ("yes", "no", "none" for empty), numbers and dates take ">=10", "<=2027-01-01"
 * or an exact value, text matches part of the value (case insensitive).
 */
export function matchesFilter(def: CustomFieldDefinition, value: CustomFieldValue | undefined, filter: string): boolean {
  const empty = value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
  if (filter === "none") return empty;
  if (filter === "any") return !empty;
  if (empty) return false;
  switch (def.fieldType) {
    case "boolean":
      return filter === "yes" ? value === true : filter === "no" ? value === false : false;
    case "single_choice":
      return value === filter;
    case "multi_choice":
      return Array.isArray(value) && value.includes(filter);
    case "number": {
      if (typeof value !== "number") return false;
      const m = /^(>=|<=|>|<|=)?\s*(-?\d+(?:[.,]\d+)?)$/.exec(filter);
      if (!m) return false;
      const n = Number(m[2].replace(",", "."));
      switch (m[1]) {
        case ">=":
          return value >= n;
        case "<=":
          return value <= n;
        case ">":
          return value > n;
        case "<":
          return value < n;
        default:
          return value === n;
      }
    }
    case "date": {
      if (typeof value !== "string") return false;
      const m = /^(>=|<=|>|<|=)?\s*(\d{4}-\d{2}-\d{2})$/.exec(filter);
      if (!m) return value.startsWith(filter);
      switch (m[1]) {
        case ">=":
          return value >= m[2];
        case "<=":
          return value <= m[2];
        case ">":
          return value > m[2];
        case "<":
          return value < m[2];
        default:
          return value === m[2];
      }
    }
    default:
      return String(value).toLowerCase().includes(filter.toLowerCase());
  }
}

/** Order of two values of one field; empty values always last. */
export function compareValues(def: CustomFieldDefinition, a: CustomFieldValue | undefined, b: CustomFieldValue | undefined): number {
  const emptyA = a === undefined || a === null || a === "" || (Array.isArray(a) && a.length === 0);
  const emptyB = b === undefined || b === null || b === "" || (Array.isArray(b) && b.length === 0);
  if (emptyA || emptyB) return emptyA === emptyB ? 0 : emptyA ? 1 : -1;
  switch (def.fieldType) {
    case "number":
      return Number(a) - Number(b);
    case "boolean":
      return a === b ? 0 : a === true ? -1 : 1;
    case "single_choice": {
      // In the order of the options, as set up in Settings.
      const ia = def.options.indexOf(String(a));
      const ib = def.options.indexOf(String(b));
      return (ia < 0 ? Infinity : ia) - (ib < 0 ? Infinity : ib) || String(a).localeCompare(String(b));
    }
    case "multi_choice":
      return (a as string[]).join(", ").localeCompare((b as string[]).join(", "));
    default:
      return String(a).localeCompare(String(b), "en", { sensitivity: "base", numeric: true });
  }
}

export type ListSort = { def: CustomFieldDefinition; dir: "asc" | "desc" };

export function sortFromParams(defs: CustomFieldDefinition[], params: Record<string, string | string[] | undefined>): ListSort | null {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const sort = one(params.sort);
  if (!sort) return null;
  const def = defs.find((d) => sortParam(d.key) === sort);
  if (!def) return null;
  return { def, dir: one(params.dir) === "desc" ? "desc" : "asc" };
}

/**
 * Applies custom field filters and sort to rows. Rows without a match in
 * `values` count as empty. Keeps the incoming order when there is no sort
 * (and for equal values), so the list's own order stays the tie breaker.
 */
export function applyListFilters<T extends { id: string }>(
  rows: T[],
  values: Map<string, CustomFieldValues>,
  filters: ListFilter[],
  sort: ListSort | null,
): T[] {
  const filtered = rows.filter((row) => {
    const v = values.get(row.id) ?? {};
    return filters.every((f) => matchesFilter(f.def, v[f.def.key], f.value));
  });
  if (!sort) return filtered;
  const indexed = filtered.map((row, i) => ({ row, i }));
  indexed.sort((x, y) => {
    const a = values.get(x.row.id)?.[sort.def.key];
    const b = values.get(y.row.id)?.[sort.def.key];
    const emptyA = a === undefined || a === null || a === "";
    const emptyB = b === undefined || b === null || b === "";
    // Empty values stay last in both directions.
    if (emptyA || emptyB) return emptyA === emptyB ? x.i - y.i : emptyA ? 1 : -1;
    const c = compareValues(sort.def, a, b);
    return (sort.dir === "desc" ? -c : c) || x.i - y.i;
  });
  return indexed.map((x) => x.row);
}

/** Database error to a short message for the form. */
export function customFieldErrorMessage(error: { message?: string; code?: string } | null | undefined): string {
  const message = error?.message ?? "";
  if (error?.code === "23505") return "A field with this name already exists. Choose another name.";
  if (error?.code === "42501" || /row-level security|permission denied/i.test(message)) {
    return /admin/i.test(message) ? "Only an admin can archive or restore a field." : "You are not allowed to do this.";
  }
  if (error?.code === "22023" || error?.code === "P0002") return message.replace(/^ERROR:\s*/, "");
  return "Saving did not work. Try again.";
}
