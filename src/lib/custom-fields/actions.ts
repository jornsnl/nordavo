"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser, isStaff, requireStaff } from "@/lib/auth";
import type { ActionState } from "@/lib/action-state";
import {
  customFieldErrorMessage,
  DEFAULT_BLOCK,
  isChoiceType,
  isCustomFieldEntity,
  keyFromLabel,
  parseFormValue,
  validateDefinition,
  type CustomFieldDefinition,
  type CustomFieldEntity,
  type CustomFieldValues,
} from "@/lib/custom-fields";
import { getCustomFieldValues, getStoredLayout, listCustomFieldDefinitions, toDefinition } from "@/lib/custom-fields/data";
import { isLayoutEntity, resolveLayout, sanitizeLayout, type LayoutEntity, type StoredLayout } from "@/lib/custom-fields/layout";
import type { Json } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";

/**
 * Server actions for custom fields. Every write runs as the signed-in user,
 * so row level security and the database checks (types, options, who may
 * archive) apply on top of the checks here.
 */

const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);

function revalidateRecord(entity: CustomFieldEntity, recordId?: string) {
  if (entity === "candidate") {
    revalidatePath("/dashboard/candidates");
    if (recordId) revalidatePath(`/dashboard/candidates/${recordId}`);
  } else if (entity === "vacancy" && recordId) {
    revalidatePath(`/dashboard/vacancies/${recordId}`);
  } else if (entity === "client" && recordId) {
    revalidatePath(`/dashboard/clients/${recordId}`);
  } else if (entity === "placement" && recordId) {
    revalidatePath(`/dashboard/placements/${recordId}`);
  }
}

export type CustomFieldsBundle = {
  definitions: CustomFieldDefinition[];
  values: CustomFieldValues;
  isAdmin: boolean;
};

/** Definitions and values for one record; used by the self loading panel (pipeline card). */
export async function loadCustomFields(entity: CustomFieldEntity, recordId: string): Promise<CustomFieldsBundle | null> {
  const user = await getCurrentUser();
  if (!isStaff(user) || !isCustomFieldEntity(entity) || !isUuid(recordId)) return null;
  const [definitions, values] = await Promise.all([listCustomFieldDefinitions({ entity }), getCustomFieldValues(entity, recordId)]);
  if (values === null) return null;
  return { definitions, values, isAdmin: user.role === "admin" };
}

/** Save every custom field of one record from a form (fields named cf_<key>). */
export async function saveCustomFieldValues(
  entity: CustomFieldEntity,
  recordId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState & { values?: CustomFieldValues }> {
  await requireStaff();
  if (!isCustomFieldEntity(entity) || !isUuid(recordId)) return { error: "Record not found." };

  const [definitions, current] = await Promise.all([listCustomFieldDefinitions({ entity }), getCustomFieldValues(entity, recordId)]);
  if (current === null) return { error: "Record not found." };

  // Only fields that were on the form: a field added in the meantime is left alone.
  const shown = new Set(formData.getAll("cf__fields").map(String));
  const fieldErrors: Record<string, string> = {};
  const changes: { key: string; value: CustomFieldValues[string] | null }[] = [];
  for (const def of definitions) {
    if (!shown.has(def.key)) continue;
    const raw = formData.getAll(`cf_${def.key}`).filter((v): v is string => typeof v === "string");
    const parsed = parseFormValue(def, raw);
    if (!parsed.ok) {
      fieldErrors[`cf_${def.key}`] = parsed.error;
      continue;
    }
    const before = current[def.key] ?? null;
    if (JSON.stringify(before) !== JSON.stringify(parsed.value)) changes.push({ key: def.key, value: parsed.value });
  }
  if (Object.keys(fieldErrors).length > 0) return { error: "Check the highlighted fields.", fieldErrors };
  if (changes.length === 0) return { ok: true, message: "Nothing changed.", values: current };

  const supabase = await createClient();
  let values = current;
  for (const change of changes) {
    const { data, error } = await supabase.rpc("set_custom_field", {
      p_entity: entity,
      p_id: recordId,
      p_key: change.key,
      p_value: change.value,
    });
    if (error) return { error: customFieldErrorMessage(error), values };
    values = (data ?? values) as CustomFieldValues;
  }
  revalidateRecord(entity, recordId);
  return { ok: true, message: changes.length === 1 ? "Field saved." : `${changes.length} fields saved.`, values };
}

/** Add a field. Any staff member may; the key is made from the label. */
export async function createCustomField(_prev: ActionState, formData: FormData): Promise<ActionState & { field?: CustomFieldDefinition }> {
  await requireStaff();
  const parsed = validateDefinition({
    entity: formData.get("entity"),
    label: formData.get("label"),
    field_type: formData.get("field_type"),
    options: formData.get("options"),
    help_text: formData.get("help_text"),
    show_in_list: formData.get("show_in_list"),
    block_key: formData.get("block_key"),
  });
  if (!parsed.ok) return { error: "Check the highlighted fields.", fieldErrors: parsed.errors };
  const input = parsed.value;

  const supabase = await createClient();
  const { data: existing, error: loadError } = await supabase
    .from("custom_field_definitions")
    .select("key, label, position, archived_at")
    .eq("entity", input.entity);
  if (loadError) return { error: customFieldErrorMessage(loadError) };
  const same = (existing ?? []).find((f) => f.label.toLowerCase() === input.label.toLowerCase());
  if (same) {
    return {
      error: same.archived_at ? "An archived field has this name. Ask an admin to restore it, or choose another name." : "A field with this name already exists.",
      fieldErrors: { label: "Choose another name." },
    };
  }

  const key = keyFromLabel(input.label, (existing ?? []).map((f) => f.key));
  const position = Math.max(0, ...(existing ?? []).map((f) => f.position)) + 1;
  const { data, error } = await supabase
    .from("custom_field_definitions")
    .insert({
      entity: input.entity,
      key,
      label: input.label,
      field_type: input.fieldType,
      options: input.options,
      help_text: input.helpText,
      show_in_list: input.entity === "candidate" && input.showInList,
      position,
      // Only sent when not the default, so adding a field keeps working before the layouts migration.
      ...(input.blockKey !== DEFAULT_BLOCK ? { block_key: input.blockKey } : {}),
    })
    .select("*")
    .single();
  if (error) return { error: customFieldErrorMessage(error) };

  revalidatePath("/dashboard", "layout");
  return { ok: true, message: `Field "${input.label}" added.`, field: toDefinition(data) };
}

/** Rename, change options, help text, "show in list", or swap text and long text. */
export async function updateCustomField(fieldId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireStaff();
  if (!isUuid(fieldId)) return { error: "Field not found." };
  const supabase = await createClient();
  const { data: field, error: loadError } = await supabase.from("custom_field_definitions").select("*").eq("id", fieldId).maybeSingle();
  if (loadError || !field) return { error: "Field not found." };

  const requestedType = formData.get("field_type");
  const fieldType =
    (field.field_type === "text" || field.field_type === "long_text") && (requestedType === "text" || requestedType === "long_text")
      ? requestedType
      : field.field_type;
  const parsed = validateDefinition({
    entity: field.entity,
    label: formData.get("label"),
    field_type: fieldType,
    options: formData.get("options"),
    help_text: formData.get("help_text"),
    show_in_list: formData.get("show_in_list"),
    block_key: formData.get("block_key"),
  });
  if (!parsed.ok) return { error: "Check the highlighted fields.", fieldErrors: parsed.errors };
  const blockChanged = formData.has("block_key") && parsed.value.blockKey !== (field.block_key ?? DEFAULT_BLOCK);

  const { error } = await supabase
    .from("custom_field_definitions")
    .update({
      label: parsed.value.label,
      field_type: fieldType,
      options: isChoiceType(fieldType) ? parsed.value.options : [],
      help_text: parsed.value.helpText,
      show_in_list: field.entity === "candidate" && parsed.value.showInList,
      ...(blockChanged ? { block_key: parsed.value.blockKey } : {}),
    })
    .eq("id", fieldId);
  if (error) return { error: customFieldErrorMessage(error) };
  revalidatePath("/dashboard", "layout");
  return { ok: true, message: "Field saved." };
}

/** Archive (hide) or restore a field. Admins only; the database checks it too. */
export async function setCustomFieldArchived(fieldId: string, archived: boolean): Promise<ActionState> {
  const user = await requireStaff();
  if (user.role !== "admin") return { error: "Only an admin can archive or restore a field." };
  if (!isUuid(fieldId)) return { error: "Field not found." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("custom_field_definitions")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", fieldId);
  if (error) return { error: customFieldErrorMessage(error) };
  revalidatePath("/dashboard", "layout");
  return { ok: true, message: archived ? "Field archived. Stored values are kept." : "Field restored." };
}

/** Which block a field is really shown in: a block that no longer exists means "Custom fields". */
async function fieldBlockResolver(entity: CustomFieldEntity): Promise<(blockKey: string | null | undefined) => string> {
  if (!isLayoutEntity(entity)) return () => DEFAULT_BLOCK;
  const layout = resolveLayout(entity, await getStoredLayout(entity));
  const holds = new Set(layout.blocks.filter((b) => b.holdsFields).map((b) => b.key));
  return (key) => (key && holds.has(key) ? key : DEFAULT_BLOCK);
}

/** Move a field one place up or down within its block. */
export async function moveCustomField(fieldId: string, direction: "up" | "down"): Promise<ActionState> {
  await requireStaff();
  if (!isUuid(fieldId)) return { error: "Field not found." };
  const supabase = await createClient();
  const { data: field } = await supabase.from("custom_field_definitions").select("*").eq("id", fieldId).maybeSingle();
  if (!field) return { error: "Field not found." };
  const { data: siblings, error } = await supabase
    .from("custom_field_definitions")
    .select("*")
    .eq("entity", field.entity)
    .is("archived_at", null)
    .order("position")
    .order("created_at");
  if (error || !siblings) return { error: customFieldErrorMessage(error) };

  // Positions are one list per record type; a move swaps with the neighbour in the same block.
  const blockOf = await fieldBlockResolver(field.entity);
  const sameBlock = siblings.filter((f) => blockOf(f.block_key) === blockOf(field.block_key)).map((f) => f.id);
  const from = sameBlock.indexOf(fieldId);
  const to = direction === "up" ? from - 1 : from + 1;
  if (from < 0 || to < 0 || to >= sameBlock.length) return { ok: true };
  const order = siblings.map((f) => f.id);
  const a = order.indexOf(sameBlock[from]);
  const b = order.indexOf(sameBlock[to]);
  [order[a], order[b]] = [order[b], order[a]];

  // Renumber 1..n so gaps and ties from earlier edits disappear.
  for (let i = 0; i < order.length; i++) {
    const wanted = i + 1;
    if (siblings.find((f) => f.id === order[i])?.position === wanted) continue;
    const { error: moveError } = await supabase.from("custom_field_definitions").update({ position: wanted }).eq("id", order[i]);
    if (moveError) return { error: customFieldErrorMessage(moveError) };
  }
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

/** Delete an archived field for good, with its values on every record. Admins only (the database checks it too). */
export async function deleteCustomField(fieldId: string): Promise<ActionState> {
  const user = await requireStaff();
  if (user.role !== "admin") return { error: "Only an admin can delete a field." };
  if (!isUuid(fieldId)) return { error: "Field not found." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_custom_field", { p_id: fieldId });
  if (error) return { error: customFieldErrorMessage(error) };
  revalidatePath("/dashboard", "layout");
  return { ok: true, message: "Field deleted, with its values." };
}

/**
 * Save the layout of a record page (Settings, Fields). The layout is checked
 * and cleaned first; anything unknown is dropped. Any team member may.
 */
export async function saveRecordLayout(entity: LayoutEntity, layout: StoredLayout): Promise<ActionState> {
  await requireStaff();
  if (!isLayoutEntity(entity)) return { error: "Unknown record type." };
  const config = sanitizeLayout(entity, layout) as Json;
  const supabase = await createClient();
  const { error } = await supabase.from("record_layouts").upsert({ entity, config }, { onConflict: "entity" });
  if (error) {
    if (/record_layouts/.test(error.message ?? "") && /does not exist|schema cache/i.test(error.message ?? "")) {
      return { error: "Page layouts are not set up yet. Run the database migrations first." };
    }
    return { error: customFieldErrorMessage(error) };
  }
  revalidatePath("/dashboard", "layout");
  return { ok: true, message: "Layout saved." };
}

/** Back to the default layout. Admins only. */
export async function resetRecordLayout(entity: LayoutEntity): Promise<ActionState> {
  const user = await requireStaff();
  if (user.role !== "admin") return { error: "Only an admin can reset a layout." };
  if (!isLayoutEntity(entity)) return { error: "Unknown record type." };
  const supabase = await createClient();
  const { error } = await supabase.from("record_layouts").delete().eq("entity", entity);
  if (error) return { error: customFieldErrorMessage(error) };
  revalidatePath("/dashboard", "layout");
  return { ok: true, message: "Layout reset to the default." };
}
