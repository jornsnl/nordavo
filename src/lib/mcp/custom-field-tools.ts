import "server-only";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  asValues,
  customFieldEntities,
  validateValue,
  type CustomFieldDefinition,
  type CustomFieldEntity,
  type CustomFieldValue,
} from "@/lib/custom-fields";
import { isLayoutEntity, resolveLayout, sanitizeLayout } from "@/lib/custom-fields/layout";
import type { Database, Json } from "@/lib/database.types";
import { check, fail, idSchema, ok, type McpDb, type McpToolContext } from "@/lib/mcp/shared";

/**
 * Custom fields for Claude (feedback Julius: "Eigen velden meenemen in export
 * en MCP"). list_custom_fields shows the definitions; the get_* and list_*
 * tools of candidates, vacancies, clients and placements return the values
 * (see customFieldReader); set_custom_fields fills or clears them.
 */

export const CUSTOM_FIELD_READ_TOOLS = ["list_custom_fields"] as const;
export const CUSTOM_FIELD_WRITE_TOOLS = ["set_custom_fields"] as const;

const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;
const entityValues = customFieldEntities.map((e) => e.value) as [CustomFieldEntity, ...CustomFieldEntity[]];
const entitySchema = z.enum(entityValues);

const TABLE: Record<CustomFieldEntity, "candidates" | "vacancies" | "applications" | "clients" | "placements" | "companies" | "contacts"> = {
  candidate: "candidates",
  vacancy: "vacancies",
  application: "applications",
  client: "clients",
  placement: "placements",
  company: "companies",
  contact: "contacts",
};

type DefinitionRow = Database["public"]["Tables"]["custom_field_definitions"]["Row"];

function toDefinition(row: DefinitionRow): CustomFieldDefinition {
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
    blockKey: row.block_key ?? "custom",
  };
}

/** A field as Claude sees it in a get_* tool. */
export type McpCustomField = { key: string; label: string; type: string; value: CustomFieldValue | null };

/**
 * Pure: the values of one record for Claude. `full` lists every active field
 * (empty ones as null, so Claude sees what can be filled); compact only the
 * filled ones by key, for lists. Values of archived or unknown keys are left out.
 */
export function shapeCustomFields(defs: CustomFieldDefinition[], raw: unknown, mode: "full"): McpCustomField[];
export function shapeCustomFields(defs: CustomFieldDefinition[], raw: unknown, mode: "compact"): Record<string, CustomFieldValue>;
export function shapeCustomFields(
  defs: CustomFieldDefinition[],
  raw: unknown,
  mode: "full" | "compact",
): McpCustomField[] | Record<string, CustomFieldValue> {
  const values = asValues(raw);
  const active = defs.filter((d) => !d.archivedAt);
  if (mode === "full") {
    return active.map((d) => ({ key: d.key, label: d.label, type: d.fieldType, value: values[d.key] ?? null }));
  }
  const out: Record<string, CustomFieldValue> = {};
  for (const d of active) if (values[d.key] !== undefined) out[d.key] = values[d.key];
  return out;
}

/**
 * Pure: checks the values Claude wants to set against the definitions.
 * null (or "", []) clears a field. Unknown and archived keys are errors.
 */
export function checkCustomFieldInput(
  defs: CustomFieldDefinition[],
  input: Record<string, unknown>,
): { changes: { key: string; value: CustomFieldValue | null }[]; errors: Record<string, string> } {
  const changes: { key: string; value: CustomFieldValue | null }[] = [];
  const errors: Record<string, string> = {};
  for (const [key, raw] of Object.entries(input)) {
    const def = defs.find((d) => d.key === key) ?? defs.find((d) => d.label.toLowerCase() === key.toLowerCase());
    if (!def) {
      errors[key] = "Unknown field. Call list_custom_fields for the keys.";
      continue;
    }
    if (def.archivedAt) {
      errors[key] = "This field is archived.";
      continue;
    }
    const result = validateValue(def, raw);
    if (!result.ok) errors[key] = result.error;
    else changes.push({ key: def.key, value: result.value });
  }
  return { changes, errors };
}

/** Loads the definitions once per request and shapes values for the read tools. */
export function customFieldReader(db: McpDb) {
  let all: Promise<CustomFieldDefinition[]> | null = null;
  const load = () =>
    (all ??= Promise.resolve(
      db
        .from("custom_field_definitions")
        .select("*")
        .order("position")
        .order("created_at")
        .then((r) => (r.error || !r.data ? [] : r.data.map(toDefinition))),
    ));
  return {
    definitions: async (entity: CustomFieldEntity) => (await load()).filter((d) => d.entity === entity),
    full: async (entity: CustomFieldEntity, raw: unknown) => shapeCustomFields((await load()).filter((d) => d.entity === entity), raw, "full"),
    compact: async (entity: CustomFieldEntity, raw: unknown) =>
      shapeCustomFields((await load()).filter((d) => d.entity === entity), raw, "compact"),
    /** A sync shaper for mapping list rows. */
    compactFor: async (entity: CustomFieldEntity) => {
      const defs = (await load()).filter((d) => d.entity === entity);
      return (raw: unknown) => shapeCustomFields(defs, raw, "compact");
    },
  };
}

export function registerCustomFieldTools(server: McpServer, ctx: McpToolContext) {
  const { db } = ctx;

  server.registerTool(
    "list_custom_fields",
    {
      title: "Custom fields",
      description:
        "The custom fields the team added to candidates, vacancies, clients, placements, applications (pipeline cards), companies and contacts: key, label, type (text, long_text, number, date YYYY-MM-DD, boolean, single_choice, multi_choice, url), options, help text and the block of the page they are shown in. The get_* and list_* tools return their values as custom_fields; fill or clear them with set_custom_fields using the key.",
      inputSchema: {
        entity: entitySchema.optional().describe("Only fields of this record type."),
        include_archived: z.boolean().default(false).describe("Also archived fields (no new values possible)."),
      },
      annotations: READ_ONLY,
    },
    async ({ entity, include_archived }) => {
      let q = db.from("custom_field_definitions").select("*").order("entity").order("position").order("created_at");
      if (entity) q = q.eq("entity", entity);
      if (!include_archived) q = q.is("archived_at", null);
      const defs = check(await q, "custom fields").map(toDefinition);

      // Block names from the page layouts, where there is one.
      const { data: layouts } = await db.from("record_layouts").select("entity, config");
      const blockName = (d: CustomFieldDefinition) => {
        if (!isLayoutEntity(d.entity)) return null;
        const stored = layouts?.find((l) => l.entity === d.entity)?.config;
        const layout = resolveLayout(d.entity, sanitizeLayout(d.entity, stored ?? {}), defs);
        return layout.blocks.find((b) => b.customFields.some((f) => f.id === d.id))?.label ?? null;
      };

      return ok({
        fields: defs.map((d) => ({
          entity: d.entity,
          key: d.key,
          label: d.label,
          type: d.fieldType,
          options: d.options.length > 0 ? d.options : undefined,
          help_text: d.helpText,
          block: blockName(d),
          archived: Boolean(d.archivedAt),
        })),
      });
    },
  );

  if (ctx.access !== "write") return;

  server.registerTool(
    "set_custom_fields",
    {
      title: "Set custom fields",
      description:
        "Fill or clear custom fields of one candidate, vacancy, client, placement, application, company or contact. values maps the field key (or its exact label) to the new value: a string for text, long_text, url, single_choice and date (YYYY-MM-DD), a number, true/false, or a list of options for multi_choice; null clears it. Fields not in values stay as they are. Call list_custom_fields first for the keys and options.",
      inputSchema: {
        entity: entitySchema,
        id: idSchema,
        values: z
          .record(z.string().max(80), z.union([z.string().max(10_000), z.number(), z.boolean(), z.array(z.string().max(80)).max(100), z.null()]))
          .describe("Field key to value, null clears."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ entity, id, values }) => {
      if (ctx.access !== "write") return fail("This token can only read. Create a token with write access under Settings.");
      if (Object.keys(values).length === 0) return fail("Give at least one field in values.");
      if (Object.keys(values).length > 50) return fail("At most 50 fields at once.");

      // Through the module scoped client: no access to the module means no record.
      const record = await db.from(TABLE[entity]).select("id, custom_fields").eq("id", id).maybeSingle();
      if (record.error) return fail(`Could not load the record: ${record.error.message}`);
      if (!record.data) return fail("Record not found.");

      const defs = check(await db.from("custom_field_definitions").select("*").eq("entity", entity), "custom fields").map(toDefinition);
      const { changes, errors } = checkCustomFieldInput(defs, values);
      if (Object.keys(errors).length > 0) return fail(`Nothing saved. ${Object.entries(errors).map(([k, e]) => `${k}: ${e}`).join(" ")}`);

      let current = asValues(record.data.custom_fields);
      let changed = 0;
      for (const change of changes) {
        if (JSON.stringify(current[change.key] ?? null) === JSON.stringify(change.value)) continue;
        const { data, error } = await db.rpc("set_custom_field", {
          p_entity: entity,
          p_id: id,
          p_key: change.key,
          p_value: change.value as Json,
        });
        if (error) return fail(`Saved ${changed} of ${changes.length}. ${change.key}: ${error.message}`);
        current = asValues(data);
        changed++;
      }
      return ok({ changed, custom_fields: shapeCustomFields(defs, current, "full") });
    },
  );
}
