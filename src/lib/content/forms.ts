import type { Json } from "@/lib/database.types";
import { cleanCustomFields, type CustomValue, type FieldDef } from "@/lib/content/rules";

/** The cf_<key> inputs of CustomFieldInputs from a form, cleaned against the definitions. */
export function readCustomFields(formData: FormData, fields: FieldDef[]) {
  const raw: Record<string, string[]> = {};
  for (const field of fields) {
    raw[field.key] = formData.getAll(`cf_${field.key}`).filter((v): v is string => typeof v === "string");
  }
  const { values, errors } = cleanCustomFields(
    fields,
    Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, fields.find((f) => f.key === k)?.type === "multiple_choice" ? v : v[0]])),
  );
  return { values, errors: Object.fromEntries(Object.entries(errors).map(([k, v]) => [`cf_${k}`, v])) };
}

/** Stored values merged with new ones; values of archived fields are kept. */
export function mergeCustomFields(stored: Json, values: Record<string, CustomValue>): Json {
  const base = stored && typeof stored === "object" && !Array.isArray(stored) ? (stored as Record<string, Json>) : {};
  return { ...base, ...values } as Json;
}

export function customValues(stored: Json): Record<string, CustomValue> {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};
  return stored as Record<string, CustomValue>;
}

/** Checkbox value from a form. */
export function checkbox(formData: FormData, name: string) {
  const value = formData.get(name);
  return value === "on" || value === "true";
}

/** Text from a form, trimmed; empty is null. */
export function text(formData: FormData, name: string, max = 10_000): string | null {
  const value = formData.get(name);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}
