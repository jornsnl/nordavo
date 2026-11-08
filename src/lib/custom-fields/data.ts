import "server-only";
import { requireStaff } from "@/lib/auth";
import type { Database } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";
import { asValues, type CustomFieldDefinition, type CustomFieldEntity, type CustomFieldValues } from "@/lib/custom-fields";

type Row = Database["public"]["Tables"]["custom_field_definitions"]["Row"];

const TABLE_OF: Record<CustomFieldEntity, "candidates" | "vacancies" | "applications"> = {
  candidate: "candidates",
  vacancy: "vacancies",
  application: "applications",
};

export function toDefinition(row: Row): CustomFieldDefinition {
  return {
    id: row.id,
    entity: row.entity,
    key: row.key,
    label: row.label,
    fieldType: row.field_type,
    options: row.options ?? [],
    helpText: row.help_text,
    position: row.position,
    showInList: row.show_in_list,
    archivedAt: row.archived_at,
  };
}

/** Field definitions in their order. Staff only (RLS too). */
export async function listCustomFieldDefinitions({
  entity,
  includeArchived = false,
}: { entity?: CustomFieldEntity; includeArchived?: boolean } = {}): Promise<CustomFieldDefinition[]> {
  await requireStaff();
  const supabase = await createClient();
  let query = supabase.from("custom_field_definitions").select("*").order("position").order("created_at");
  if (entity) query = query.eq("entity", entity);
  if (!includeArchived) query = query.is("archived_at", null);
  const { data, error } = await query;
  if (error) throw new Error(`Could not load custom fields: ${error.message}`);
  return (data ?? []).map(toDefinition);
}

/** The custom field values of one record, or null when it does not exist (or is not visible). */
export async function getCustomFieldValues(entity: CustomFieldEntity, id: string): Promise<CustomFieldValues | null> {
  await requireStaff();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.from(TABLE_OF[entity]).select("custom_fields").eq("id", id).maybeSingle();
  if (error) throw new Error(`Could not load custom fields: ${error.message}`);
  return data ? asValues(data.custom_fields) : null;
}

/** Custom field values of every candidate, for the list columns. */
export async function listCandidateCustomValues(): Promise<Map<string, CustomFieldValues>> {
  await requireStaff();
  const supabase = await createClient();
  const { data, error } = await supabase.from("candidates").select("id, custom_fields");
  if (error) throw new Error(`Could not load custom fields: ${error.message}`);
  return new Map((data ?? []).map((row) => [row.id, asValues(row.custom_fields)]));
}

export { TABLE_OF as customFieldTables };
