// Extra columns of the sales tables, next to the fixed ones in rows.ts
// (feedback Julius, round 4). Pure, safe for client components:
//
//   * own columns (custom fields of record type company and contact),
//     editable, filterable and sortable like any other column (87399c89);
//   * bucket, source list, occupancy and "free" of the company (038aa8ea,
//     264ce8e7), prio reason and follow (3f93bd66, 9eb8d313);
//   * the choice lists the team set up applied to prio, category, lead
//     status and contact status (3f93bd66).
//
// The server attaches the values to each row under the column key
// (attachFlow in src/lib/sales/flow-data.ts), so the grid reads, patches and
// undoes them like the fixed columns.

import type { CustomFieldDefinition } from "@/lib/custom-fields";
import type { ChoiceLists, ChoiceOption } from "@/lib/sales/choices";
import { pickable } from "@/lib/sales/choices";
import type { ColumnDef } from "@/lib/sales/rows";
import { salesBuckets } from "@/lib/sales/triage";

/** A custom field as the client needs it to build a column (no functions cross to the client). */
export type CustomColumn = Pick<CustomFieldDefinition, "key" | "label" | "fieldType" | "options"> & {
  entity: "company" | "contact";
};

/** The key a custom field value is stored under on a row of the table. */
export function customKey(entity: "company" | "contact", key: string): string {
  return `cf_${entity}__${key}`;
}

/** The field an edit of a custom column writes (applyEdits routes it to sales_set_custom_field). */
export function customField(key: string): string {
  return `cf:${key}`;
}

export function isCustomField(field: string): boolean {
  return /^cf:[a-z][a-z0-9_]{0,39}$/.test(field);
}

/** Fields that go through sales_update_more instead of sales_update. */
export const moreFields = ["prio_reason", "followed"] as const;

function read(row: unknown, key: string): unknown {
  return (row as Record<string, unknown>)[key] ?? null;
}

const yes = /^(1|true|yes|ja|y|x|on)$/i;

/** Parses typed or pasted text for a custom field type. */
export function parseCustomInput(column: Pick<CustomColumn, "fieldType" | "options" | "label">, input: string): { value: unknown } | { error: string } {
  const v = input.trim();
  if (v === "") return { value: null };
  switch (column.fieldType) {
    case "text":
      return v.length > 500 ? { error: "Use at most 500 characters." } : { value: v };
    case "long_text":
      return v.length > 10000 ? { error: "Use at most 10,000 characters." } : { value: input.trim() };
    case "number": {
      const n = Number(v.replace(/\s/g, "").replace(",", "."));
      return Number.isFinite(n) ? { value: n } : { error: "Enter a number." };
    }
    case "date": {
      const nl = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(v);
      const iso = nl ? `${nl[3]}-${nl[2].padStart(2, "0")}-${nl[1].padStart(2, "0")}` : v;
      return /^\d{4}-\d{2}-\d{2}$/.test(iso) && !Number.isNaN(Date.parse(iso)) ? { value: iso } : { error: "Use a date like 2026-11-30." };
    }
    case "boolean":
      return { value: yes.test(v) };
    case "url":
      return /^https?:\/\/\S+$/i.test(v) && v.length <= 2000 ? { value: v } : { error: "Use a link that starts with https://." };
    case "single_choice": {
      const hit = column.options.find((o) => o.toLowerCase() === v.toLowerCase());
      return hit ? { value: hit } : { error: `Pick one of: ${column.options.join(", ")}.` };
    }
    case "multi_choice": {
      const parts = v.split(/[;,\n]/).map((s) => s.trim()).filter(Boolean);
      const out: string[] = [];
      for (const p of parts) {
        const hit = column.options.find((o) => o.toLowerCase() === p.toLowerCase());
        if (!hit) return { error: `Pick from: ${column.options.join(", ")}.` };
        if (!out.includes(hit)) out.push(hit);
      }
      return { value: out };
    }
  }
}

const cellTypes: Record<CustomColumn["fieldType"], ColumnDef<unknown>["type"]> = {
  text: "text",
  long_text: "longtext",
  number: "number",
  date: "date",
  boolean: "boolean",
  single_choice: "select",
  multi_choice: "multiselect",
  url: "url",
};

/** Grid columns for the own columns of a table. */
export function customColumnDefs<T>(columns: CustomColumn[]): ColumnDef<T>[] {
  return columns.map((c) => {
    const key = customKey(c.entity, c.key);
    return {
      key,
      label: c.label,
      type: cellTypes[c.fieldType],
      field: customField(c.key),
      entity: c.entity,
      options: c.fieldType === "single_choice" || c.fieldType === "multi_choice" ? c.options.map((o) => ({ value: o, label: o })) : undefined,
      width: c.fieldType === "long_text" ? 240 : c.fieldType === "boolean" ? 90 : 160,
      defaultVisible: false,
      get: (row: T) => {
        const v = read(row, key);
        if (v === null || v === undefined) return null;
        if (Array.isArray(v)) return v.map(String);
        if (typeof v === "boolean" || typeof v === "number" || typeof v === "string") return v;
        return String(v);
      },
      parse: (input: string) => parseCustomInput(c, input),
    };
  });
}

const bucketOptions = salesBuckets.map((b) => ({ value: b.value, label: b.label }));

/** Bucket, source list, occupancy, free, prio reason and follow of the company. */
export function flowColumnDefs<T>(entity: "companies" | "contacts"): ColumnDef<T>[] {
  const company = entity === "companies" ? "" : "company_";
  return [
    { key: "flow_bucket", label: "Bucket", type: "select", options: bucketOptions, width: 140, defaultVisible: false, get: (r) => read(r, "flow_bucket") as string | null },
    { key: "flow_source_list", label: "Came in with", type: "text", width: 170, defaultVisible: false, get: (r) => read(r, "flow_source_list") as string | null },
    { key: "flow_occupancy", label: "Occupied by", type: "text", width: 240, defaultVisible: false, get: (r) => read(r, "flow_occupancy") as string | null },
    { key: "flow_free", label: "Free", type: "boolean", width: 70, defaultVisible: false, get: (r) => read(r, "flow_free") === true },
    {
      key: `${company}prio_reason`,
      label: "Prio reason",
      type: "text",
      field: "prio_reason",
      entity: "company",
      width: 220,
      defaultVisible: false,
      get: (r) => read(r, `${company}prio_reason`) as string | null,
      parse: (input: string) => (input.trim().length > 500 ? { error: "Use at most 500 characters." } : { value: input.trim() || null }),
    },
    {
      key: `${company}followed`,
      label: "Followed",
      type: "boolean",
      field: "followed",
      entity: "company",
      width: 90,
      defaultVisible: false,
      get: (r) => read(r, `${company}followed`) === true,
      parse: (input: string) => ({ value: yes.test(input.trim()) }),
    },
  ];
}

function choiceParser(options: ChoiceOption[], kind: "text" | "prio", required: boolean) {
  return (input: string) => {
    let v = input.trim();
    if (v === "") return required ? { error: "This field cannot be empty." } : { value: null };
    if (kind === "prio") v = v.replace(/^p\s*/i, "");
    const low = v.toLowerCase();
    const hit = options.find((o) => o.value.toLowerCase() === low || o.label.toLowerCase() === low);
    if (!hit) return { error: `Pick one of: ${pickable(options).map((o) => o.label).join(", ")}.` };
    return { value: kind === "prio" ? Number(hit.value) : hit.value };
  };
}

/** Puts the configured labels, order and hidden options on the fixed choice columns. */
export function applyChoiceLists<T>(columns: ColumnDef<T>[], lists: ChoiceLists | undefined): ColumnDef<T>[] {
  if (!lists) return columns;
  return columns.map((c) => {
    const list =
      c.field === "prio"
        ? { options: lists.prio, kind: "prio" as const, required: false }
        : c.field === "category"
          ? { options: lists.category, kind: "text" as const, required: false }
          : c.field === "lead_status"
            ? { options: lists.lead_status, kind: "text" as const, required: true }
            : c.field === "status" && c.entity === "contact"
              ? { options: lists.contact_status, kind: "text" as const, required: true }
              : null;
    if (!list) return c;
    return {
      ...c,
      // Hidden options stay in the list so existing values keep their label;
      // the editors offer pickable() only.
      options: list.options.map((o) => ({ value: o.value, label: o.label, hidden: o.hidden })),
      parse: choiceParser(list.options, list.kind, list.required),
    };
  });
}
