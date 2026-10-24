import "server-only";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  fail,
  idSchema,
  linkableTypes,
  ok,
  recordExists,
  recordUrl,
  type McpDb,
  type McpToolContext,
} from "@/lib/mcp/shared";

/**
 * Database writes with the secret key run without auth.uid(), so the
 * activity log trigger records them without an actor. Attribute the rows
 * this request just caused to the token owner. Only rows without an actor
 * since the write started are touched, so changes by others stay as they are.
 */
async function attributeActivity(db: McpDb, entityType: string, entityId: string, actorId: string, since: string) {
  const { error } = await db
    .from("activity_log")
    .update({ actor_id: actorId })
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .is("actor_id", null)
    .gte("created_at", since);
  if (error) console.error("[mcp] activity attribution failed:", error.message);
}

/**
 * Start of the attribution window. A minute of margin absorbs clock skew
 * between the app server and the database; only rows of this one record
 * without an actor are touched, so the margin is harmless.
 */
function attributionStart() {
  return new Date(Date.now() - 60_000).toISOString();
}

/** Staff only: tasks are never assigned to client portal users. */
async function isStaffMember(db: McpDb, userId: string) {
  const { data } = await db.from("profiles").select("role").eq("id", userId).maybeSingle();
  return data?.role === "admin" || data?.role === "member";
}

/** Only called for tokens with write access; every handler checks again. */
export function registerWriteTools(server: McpServer, ctx: McpToolContext) {
  const { db } = ctx;
  const denied = () => fail("Dit token mag alleen lezen. Maak een token met schrijfrechten aan onder Instellingen.");

  // -------------------------------------------------------------------------
  server.registerTool(
    "create_task",
    {
      title: "Taak aanmaken",
      description:
        "Create a task in Nordavo, optionally linked to a record. Assigned to the token owner unless assignee_id is given. Only call after the user asked for it.",
      inputSchema: {
        title: z.string().trim().min(1).max(200),
        description: z.string().max(5000).optional(),
        priority: z.enum(["low", "normal", "high"]).default("normal"),
        due_date: z.iso.date().optional().describe("YYYY-MM-DD."),
        assignee_id: idSchema.optional().describe("Team member (profile id). Default: the token owner."),
        entity_type: z.enum(linkableTypes).optional().describe("Type of the linked record (requires entity_id)."),
        entity_id: idSchema.optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ title, description, priority, due_date, assignee_id, entity_type, entity_id }) => {
      if (ctx.access !== "write") return denied();
      if (Boolean(entity_type) !== Boolean(entity_id)) return fail("Geef entity_type en entity_id samen op.");
      if (entity_type && entity_id && !(await recordExists(db, entity_type, entity_id))) {
        return fail("Het gekoppelde record bestaat niet.");
      }
      const assignee = assignee_id ?? ctx.userId;
      if (assignee !== ctx.userId && !(await isStaffMember(db, assignee))) {
        return fail("assignee_id is geen teamlid van Nordavo.");
      }

      const since = attributionStart();
      const { data, error } = await db
        .from("tasks")
        .insert({
          title,
          description: description?.trim() || null,
          priority,
          status: "todo",
          due_date: due_date ?? null,
          assignee_id: assignee,
          created_by: ctx.userId,
          entity_type: entity_type ?? null,
          entity_id: entity_id ?? null,
          position: Date.now(),
        })
        .select("id, title, status, priority, due_date, assignee_id, entity_type, entity_id")
        .single();
      if (error) return fail(`Taak aanmaken mislukt: ${error.message}`);

      await attributeActivity(db, "task", data.id, ctx.userId, since);
      return ok({ created: data, url: recordUrl(ctx.siteUrl, "task", data.id) });
    },
  );

  // -------------------------------------------------------------------------
  server.registerTool(
    "update_task_status",
    {
      title: "Taakstatus wijzigen",
      description: "Set the status of a task: todo, in_progress or done. Only call after the user asked for it.",
      inputSchema: {
        id: idSchema.describe("Task id."),
        status: z.enum(["todo", "in_progress", "done"]),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ id, status }) => {
      if (ctx.access !== "write") return denied();
      const since = attributionStart();
      const { data, error } = await db
        .from("tasks")
        .update({ status })
        .eq("id", id)
        .select("id, title, status, completed_at")
        .maybeSingle();
      if (error) return fail(`Taak bijwerken mislukt: ${error.message}`);
      if (!data) return fail("Taak niet gevonden.");

      await attributeActivity(db, "task", data.id, ctx.userId, since);
      return ok({ updated: data });
    },
  );

  // -------------------------------------------------------------------------
  server.registerTool(
    "add_note",
    {
      title: "Notitie toevoegen",
      description:
        "Add a note to a client, vacancy, candidate, application, placement or GTM company, written as the token owner. Only call after the user asked for it.",
      inputSchema: {
        entity_type: z.enum(linkableTypes),
        entity_id: idSchema,
        body: z.string().trim().min(1).max(10000).describe("Note text (plain text)."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ entity_type, entity_id, body }) => {
      if (ctx.access !== "write") return denied();
      if (!(await recordExists(db, entity_type, entity_id))) return fail("Het record bestaat niet.");

      const { data, error } = await db
        .from("notes")
        .insert({ entity_type, entity_id, body, author_id: ctx.userId })
        .select("id, entity_type, entity_id, created_at")
        .single();
      if (error) return fail(`Notitie toevoegen mislukt: ${error.message}`);
      return ok({ created: data, url: recordUrl(ctx.siteUrl, entity_type, entity_id) });
    },
  );
}
