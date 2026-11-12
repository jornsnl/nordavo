"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { choiceListInfo } from "@/lib/sales/choices";
import type { ChoiceListKey } from "@/lib/sales/flow-database";
import { createClient } from "@/lib/supabase/server";

// Choice lists of the sales CRM (feedback Julius, 3f93bd66). Admins only;
// the database checks it again (RLS on sales_choice_options) and refuses
// extra options on the lists the rules depend on.

const listKeys = choiceListInfo.map((l) => l.key) as [ChoiceListKey, ...ChoiceListKey[]];

const optionSchema = z.object({
  value: z.string().regex(/^[a-z0-9_]{1,40}$/, "Use lower case letters, digits and _."),
  label: z.string().trim().min(1, "Give the option a name.").max(80, "Use at most 80 characters."),
  description: z.string().trim().max(300, "Use at most 300 characters.").nullish(),
  hidden: z.boolean(),
  tone: z.enum(["neutral", "brand", "accent", "success", "warning", "danger"]).nullish(),
});

const saveSchema = z.object({
  list: z.enum(listKeys),
  options: z.array(optionSchema).min(1).max(100),
  removed: z.array(z.string()).max(100).default([]),
});

export type SaveChoiceListInput = z.input<typeof saveSchema>;

function friendly(message: string) {
  if (/does not exist|schema cache/.test(message)) return "Apply the latest database migrations first.";
  if (/row-level security|42501/.test(message)) return "Only an admin can change the choice lists.";
  return message.length < 200 ? message : "The list could not be saved.";
}

/** Saves one list in its new order: labels, explanations, hidden flags, added and removed extra options. */
export async function saveChoiceList(input: SaveChoiceListInput): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAdmin();
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the list." };
  const { list, options, removed } = parsed.data;
  const values = options.map((o) => o.value);
  if (new Set(values).size !== values.length) return { ok: false, error: "Two options have the same value." };
  const labels = options.map((o) => o.label.toLowerCase());
  if (new Set(labels).size !== labels.length) return { ok: false, error: "Two options have the same name." };

  const db = await createClient();
  const rows = options.map((o, i) => ({
    list_key: list,
    value: o.value,
    label: o.label,
    description: o.description || null,
    hidden: o.hidden,
    tone: o.tone ?? null,
    position: (i + 1) * 10,
  }));
  const { error } = await db.from("sales_choice_options").upsert(rows, { onConflict: "list_key,value" });
  if (error) return { ok: false, error: friendly(error.message) };
  const gone = removed.filter((v) => !values.includes(v));
  if (gone.length > 0) {
    const { error: deleteError } = await db.from("sales_choice_options").delete().eq("list_key", list).in("value", gone);
    if (deleteError) return { ok: false, error: friendly(deleteError.message) };
  }
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

/** Back to the built in labels and order; extra options stay. */
export async function resetChoiceList(list: ChoiceListKey): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAdmin();
  if (!listKeys.includes(list)) return { ok: false, error: "Unknown list." };
  const db = await createClient();
  const { error } = await db.from("sales_choice_options").delete().eq("list_key", list).eq("builtin", true);
  if (error) return { ok: false, error: friendly(error.message) };
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}
