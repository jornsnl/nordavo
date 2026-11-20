"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { defaultCheatsheet } from "@/lib/sales/cheatsheet";
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

const cheatsheetSchema = z.object({
  sections: z
    .array(
      z.object({
        key: z.string().regex(/^[a-z0-9_]{1,40}$/, "Use lower case letters, digits and _."),
        title: z.string().trim().min(1, "Give each section a title.").max(80, "Use at most 80 characters for a title."),
        body: z.string().trim().max(4000, "Use at most 4000 characters per section."),
        hidden: z.boolean(),
      }),
    )
    .min(1)
    .max(30),
  removed: z.array(z.string()).max(30).default([]),
});

export type SaveCheatsheetInput = z.input<typeof cheatsheetSchema>;

/** Saves the cheat sheet of the call screen (feedback Julius, 21637c48): titles, text, order and hidden flags. */
export async function saveCheatsheet(input: SaveCheatsheetInput): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAdmin();
  const parsed = cheatsheetSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the cheat sheet." };
  const { sections, removed } = parsed.data;
  const keys = sections.map((s) => s.key);
  if (new Set(keys).size !== keys.length) return { ok: false, error: "Two sections have the same key." };
  const db = await createClient();
  const { error } = await db
    .from("sales_call_cheatsheet")
    .upsert(sections.map((s, i) => ({ ...s, position: (i + 1) * 10 })), { onConflict: "key" });
  if (error) return { ok: false, error: friendly(error.message) };
  const gone = removed.filter((k) => !keys.includes(k));
  if (gone.length > 0) {
    const { error: deleteError } = await db.from("sales_call_cheatsheet").delete().in("key", gone);
    if (deleteError) return { ok: false, error: friendly(deleteError.message) };
  }
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

/** Back to the draft text of the code for every section; sections added by hand stay. */
export async function resetCheatsheet(): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAdmin();
  const db = await createClient();
  const { error } = await db.from("sales_call_cheatsheet").delete().in("key", defaultCheatsheet.map((d) => d.key));
  if (error) return { ok: false, error: friendly(error.message) };
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

// ---------------------------------------------------------------------------
// Signal points and score groups (leadregels, deel 3 to 5)
// ---------------------------------------------------------------------------

const pointsSchema = z
  .array(
    z.object({
      type: z.string().regex(/^[a-z0-9_]{1,40}$/),
      points: z.number().int().min(-100, "At least -100.").max(100, "At most 100."),
      active: z.boolean(),
      valid_days: z.number().int().min(1).max(3650).nullable(),
    }),
  )
  .min(1)
  .max(100);

/** Saves the points table: per signal type the points, on or off and the default days it counts. Every score is computed again. */
export async function saveSignalPoints(input: z.input<typeof pointsSchema>): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAdmin();
  const parsed = pointsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the points." };
  const db = await createClient();
  for (const row of parsed.data) {
    const { error } = await db
      .from("sales_signal_points")
      .update({ points: row.points, active: row.active, valid_days: row.valid_days })
      .eq("type", row.type);
    if (error) return { ok: false, error: friendly(error.message) };
  }
  revalidatePath("/dashboard/settings/sales-lists");
  revalidatePath("/dashboard/leads");
  return { ok: true };
}

const approachSchema = z
  .array(
    z.object({
      key: z.enum(["90_100", "80_89", "60_79", "50_59", "lt_50"]),
      approach: z.string().trim().max(500, "Use at most 500 characters.").nullable(),
    }),
  )
  .max(5);

/** Saves which approach belongs to which score group (to be decided later; leadregels, deel 2). */
export async function saveScoreApproaches(input: z.input<typeof approachSchema>): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAdmin();
  const parsed = approachSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the approaches." };
  const db = await createClient();
  for (const row of parsed.data) {
    const { error } = await db.from("sales_score_groups").update({ approach: row.approach || null }).eq("key", row.key);
    if (error) return { ok: false, error: friendly(error.message) };
  }
  revalidatePath("/dashboard/settings/sales-lists");
  return { ok: true };
}
