"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireModule } from "@/lib/auth";
import type { Json } from "@/lib/database.types";
import { parseViewConfig, viewConfigToJson } from "@/lib/sales/grid";
import { createClient } from "@/lib/supabase/server";
import { searchCompanyOptions, type CompanyOption } from "@/lib/data/sequences";
import type { PipelineStage } from "@/lib/sales/database";
import { isCustomField, moreFields } from "@/lib/sales/grid-extras";

// Writes of the sales tables and boards. Every edit goes through
// public.sales_update(), which only accepts whitelisted columns and logs each
// changed field in Activities with who did it (section 2.3 point 9).

export type Edit = {
  entity: "company" | "contact";
  ids: string[];
  fields: Record<string, Json>;
};

export type EditResult = { ok: true; count: number } | { ok: false; error: string };

const uuid = z.guid();
const editSchema = z.object({
  entity: z.enum(["company", "contact"]),
  ids: z.array(uuid).min(1).max(5000),
  // Own columns are "cf:<key>" (sales_set_custom_field).
  fields: z.record(z.string().regex(/^(cf:[a-z][a-z0-9_]{0,39}|[a-z_]{2,40})$/), z.json()),
});

/** Turns a database error into a sentence for the table's message bar. */
function friendly(message: string): string {
  if (/companies_lost_needs_reason/.test(message)) return "Lost needs a reason.";
  if (/companies_parked_needs_date/.test(message)) return "Parked needs a date to get in touch again.";
  if (/contacts_one_primary_per_company/.test(message)) return "A company has one primary contact.";
  if (/contacts_linkedin_url_key/.test(message)) return "Another contact already has this LinkedIn URL.";
  if (/companies_domain_key/.test(message)) return "Another company already has this domain.";
  if (/check constraint/.test(message)) return "That value is not allowed here.";
  if (/No access to sales/.test(message)) return "You have no access to sales.";
  if (/cannot be changed here/.test(message)) return "This column cannot be edited.";
  return message.length < 160 ? message : "The change could not be saved.";
}

export async function applyEdits(edits: Edit[]): Promise<EditResult> {
  await requireModule("sales");
  const parsed = z.array(editSchema).max(2000).safeParse(edits);
  if (!parsed.success) return { ok: false, error: "The change could not be read." };

  const supabase = await createClient();
  let count = 0;
  for (const edit of parsed.data) {
    if (Object.keys(edit.fields).length === 0) continue;
    // Three write paths, all logged in Activities: the fixed columns
    // (sales_update), the prio reason and follow (sales_update_more) and the
    // own columns (sales_set_custom_field, one per column).
    const base: Record<string, Json> = {};
    const more: Record<string, Json> = {};
    const custom: [string, Json][] = [];
    for (const [field, value] of Object.entries(edit.fields)) {
      if (isCustomField(field)) custom.push([field.slice(3), value as Json]);
      else if ((moreFields as readonly string[]).includes(field)) more[field] = value as Json;
      else base[field] = value as Json;
    }
    if (Object.keys(base).length > 0) {
      const { data, error } = await supabase.rpc("sales_update", {
        p_entity: edit.entity,
        p_ids: edit.ids,
        p_fields: base as Json,
        p_source: "handmatig",
      });
      if (error) return { ok: false, error: friendly(error.message) };
      count += data ?? 0;
    }
    if (Object.keys(more).length > 0) {
      if (edit.entity !== "company") return { ok: false, error: "This column cannot be edited." };
      const { data, error } = await supabase.rpc("sales_update_more", {
        p_entity: "company",
        p_ids: edit.ids,
        p_fields: more as Json,
        p_source: "handmatig",
      });
      if (error) return { ok: false, error: friendly(error.message) };
      count += data ?? 0;
    }
    for (const [key, value] of custom) {
      const { data, error } = await supabase.rpc("sales_set_custom_field", {
        p_entity: edit.entity,
        p_ids: edit.ids,
        p_key: key,
        p_value: value,
        p_source: "handmatig",
      });
      if (error) return { ok: false, error: friendly(error.message) };
      count += data ?? 0;
    }
  }
  revalidatePath("/dashboard/leads", "layout");
  revalidatePath("/dashboard/contacts", "layout");
  revalidatePath("/dashboard/pipeline", "layout");
  return { ok: true, count };
}

const viewSchema = z.object({
  id: uuid.optional(),
  entity: z.enum(["companies", "contacts", "pipeline"]),
  name: z.string().trim().min(1, "Give the view a name.").max(120, "Use at most 120 characters."),
  config: z.unknown(),
  isCallList: z.boolean().default(false),
  isShared: z.boolean().default(true),
});

export type SaveViewInput = z.input<typeof viewSchema>;

export async function saveView(input: SaveViewInput): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  await requireModule("sales");
  const parsed = viewSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the view." };
  const { id, entity, name, isCallList, isShared } = parsed.data;
  if (isCallList && entity !== "contacts") return { ok: false, error: "A call list is a view of contacts." };
  const config = viewConfigToJson(parseViewConfig(parsed.data.config));

  const supabase = await createClient();
  if (id) {
    const { error } = await supabase
      .from("sales_views")
      .update({ name, config, is_call_list: isCallList, is_shared: isShared })
      .eq("id", id);
    if (error) return { ok: false, error: friendly(error.message) };
    revalidatePath("/dashboard/call-lists");
    return { ok: true, id };
  }
  const { data, error } = await supabase
    .from("sales_views")
    .insert({ entity, name, config, is_call_list: isCallList, is_shared: isShared, position: Date.now() / 1000 })
    .select("id")
    .single();
  if (error) return { ok: false, error: friendly(error.message) };
  revalidatePath("/dashboard/call-lists");
  return { ok: true, id: data.id };
}

export async function deleteView(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireModule("sales");
  if (!uuid.safeParse(id).success) return { ok: false, error: "View not found." };
  const supabase = await createClient();
  const { error } = await supabase.from("sales_views").delete().eq("id", id);
  if (error) return { ok: false, error: friendly(error.message) };
  revalidatePath("/dashboard/call-lists");
  return { ok: true };
}

const positionsSchema = z.object({
  entity: z.enum(["company", "contact"]),
  ids: z.array(uuid).min(1).max(20000),
  positions: z.array(z.number().finite()).min(1).max(20000),
  /** The dragged row: the reorder is logged once, on this row. */
  moved: uuid.optional(),
});

/** Stores the dragged order of rows (one call and one activity per drag). */
export async function setPositions(input: z.input<typeof positionsSchema>): Promise<EditResult> {
  await requireModule("sales");
  const parsed = positionsSchema.safeParse(input);
  if (!parsed.success || parsed.data.ids.length !== parsed.data.positions.length) {
    return { ok: false, error: "The new order could not be read." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("sales_set_positions", {
    p_entity: parsed.data.entity,
    p_ids: parsed.data.ids,
    p_positions: parsed.data.positions,
    p_moved: parsed.data.moved ?? null,
  });
  if (error) return { ok: false, error: friendly(error.message) };
  return { ok: true, count: data ?? 0 };
}

/** Companies that can go into the pipeline, for the Add company picker. */
export async function searchPipelineCandidates(query: string): Promise<CompanyOption[]> {
  await requireModule("sales");
  return searchCompanyOptions(typeof query === "string" ? query : "", 20, { notInPipeline: true });
}

export type AddToPipelineState = { ok?: boolean; error?: string; message?: string };

const addSchema = z.object({
  company_ids: z.array(uuid).min(1, "Pick at least one company.").max(200),
  stage: z.enum(["contact", "interested"] satisfies PipelineStage[]),
});

/**
 * Puts warm leads into the pipeline with one click, at Contact or
 * Interested. Through sales_update, so it lands in the timeline.
 */
export async function addToPipeline(_prev: AddToPipelineState, formData: FormData): Promise<AddToPipelineState> {
  await requireModule("sales");
  const parsed = addSchema.safeParse({
    company_ids: formData.getAll("company_ids").map(String),
    stage: formData.get("stage"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Pick a company and a stage." };
  const result = await applyEdits([{ entity: "company", ids: parsed.data.company_ids, fields: { pipeline_stage: parsed.data.stage } }]);
  if (!result.ok) return { error: result.error };
  const n = parsed.data.company_ids.length;
  return { ok: true, message: n === 1 ? "Added to the pipeline." : `${n} companies added to the pipeline.` };
}
