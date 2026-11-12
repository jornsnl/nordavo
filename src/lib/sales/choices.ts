// Choice lists of the sales CRM that the team sets up itself (feedback Julius,
// 3f93bd66). The built in options of src/lib/sales/labels.ts merged with the
// rows of public.sales_choice_options: labels, explanation, order, hidden,
// and extra options for prio and category. Pure, safe everywhere.

import type { Tone } from "@/lib/labels";
import { contactStatuses } from "@/lib/labels";
import type { ChoiceListKey, ChoiceOptionRow } from "@/lib/sales/flow-database";
import { callOutcomes, companyCategories, companyPrios, leadStatuses } from "@/lib/sales/labels";

export type ChoiceOption = {
  value: string;
  label: string;
  description: string | null;
  tone: Tone;
  hidden: boolean;
  builtin: boolean;
};

export type ChoiceLists = Record<ChoiceListKey, ChoiceOption[]>;

export const choiceListInfo: { key: ChoiceListKey; label: string; help: string; extra: boolean }[] = [
  { key: "prio", label: "Prio", help: "Levels of a company's priority, 1 is first. Add levels up to 20 and explain each one.", extra: true },
  { key: "category", label: "Category", help: "What kind of roles a company hires for. Add your own categories.", extra: true },
  { key: "lead_status", label: "Lead status", help: "The rules use these statuses: rename, explain, reorder or hide them.", extra: false },
  { key: "contact_status", label: "Contact status", help: "The call rules use these statuses: rename, explain, reorder or hide them.", extra: false },
  { key: "call_outcome", label: "Call screen outcomes", help: "Each button applies a call rule: rename, explain, reorder or hide them.", extra: false },
];

type Base = { value: string; label: string; tone: Tone; description?: string };

export const builtinChoices: Record<ChoiceListKey, Base[]> = {
  prio: companyPrios,
  category: companyCategories,
  lead_status: leadStatuses,
  contact_status: contactStatuses,
  call_outcome: callOutcomes,
};

/** The built in options, overridden and extended by the stored rows, in order. */
export function mergeChoices(key: ChoiceListKey, rows: Pick<ChoiceOptionRow, "list_key" | "value" | "label" | "description" | "position" | "hidden" | "tone">[]): ChoiceOption[] {
  const base = builtinChoices[key];
  const mine = rows.filter((r) => r.list_key === key);
  const byValue = new Map(mine.map((r) => [r.value, r]));
  const extra = choiceListInfo.find((l) => l.key === key)?.extra ?? false;
  const merged: (ChoiceOption & { position: number })[] = base.map((b, i) => {
    const r = byValue.get(b.value);
    return {
      value: b.value,
      label: r?.label ?? b.label,
      description: r ? r.description : (b.description ?? null),
      tone: (r?.tone as Tone | null) ?? b.tone,
      hidden: r?.hidden ?? false,
      builtin: true,
      position: r?.position ?? (i + 1) * 10,
    };
  });
  if (extra) {
    for (const r of mine) {
      if (base.some((b) => b.value === r.value)) continue;
      merged.push({
        value: r.value,
        label: r.label,
        description: r.description,
        tone: (r.tone as Tone | null) ?? "neutral",
        hidden: r.hidden,
        builtin: false,
        position: r.position,
      });
    }
  }
  merged.sort((a, b) => {
    if (key === "prio" && a.position === b.position) return Number(a.value) - Number(b.value);
    return a.position - b.position;
  });
  return merged.map((o) => ({
    value: o.value,
    label: o.label,
    description: o.description,
    tone: o.tone,
    hidden: o.hidden,
    builtin: o.builtin,
  }));
}

export function mergeAllChoices(rows: Parameters<typeof mergeChoices>[1]): ChoiceLists {
  return {
    prio: mergeChoices("prio", rows),
    category: mergeChoices("category", rows),
    lead_status: mergeChoices("lead_status", rows),
    contact_status: mergeChoices("contact_status", rows),
    call_outcome: mergeChoices("call_outcome", rows),
  };
}

/** The defaults, for when nothing is stored (or the table is not there yet). */
export const defaultChoiceLists: ChoiceLists = mergeAllChoices([]);

/** Options to offer in a picker: hidden ones only when the current value has it. */
export function pickable(options: ChoiceOption[], current?: string | null): ChoiceOption[] {
  return options.filter((o) => !o.hidden || o.value === current);
}

/** The label of a value, also for hidden or deleted options. */
export function choiceLabel(options: ChoiceOption[], value: string | null | undefined): string {
  if (value == null || value === "") return "";
  return options.find((o) => o.value === value)?.label ?? value;
}

/** A value for an extra option from its label: "Data & AI" to "data_ai". */
export function choiceValueFromLabel(label: string, taken: string[] = []): string {
  const base =
    label
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 36) || "option";
  if (!taken.includes(base)) return base;
  for (let n = 2; n < 100; n++) if (!taken.includes(`${base}_${n}`)) return `${base}_${n}`;
  return `${base}_${Date.now() % 1000}`;
}

/** The next free prio level (1 to 20), or null when all 20 exist. */
export function nextPrioLevel(options: ChoiceOption[]): string | null {
  const used = new Set(options.map((o) => Number(o.value)));
  for (let n = 1; n <= 20; n++) if (!used.has(n)) return String(n);
  return null;
}
