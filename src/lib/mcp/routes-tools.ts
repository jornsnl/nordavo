import "server-only";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { check, fail, idSchema, ok, type McpToolContext } from "@/lib/mcp/shared";
import { effectiveModules } from "@/lib/modules";
import {
  NO_END_DATE,
  ROUTE_CHANNELS,
  ROUTE_STATUSES,
  routeFieldSchemas,
  visibleRoutes,
  type SalesRouteRow,
} from "@/lib/sales/routes";

/**
 * MCP tools of Running routes (opdracht Julius, 27 november 2026, deel B): the
 * hand kept overview of outreach on /dashboard/routes. The same fields as the
 * table; every change is stored with the token owner and source claude. The
 * routes link to nothing: no campaign, bucket or company changes.
 */

const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;
const DELETE = { readOnlyHint: false, destructiveHint: true, openWorldHint: false } as const;

export const ROUTES_READ_TOOLS = ["list_routes"] as const;
export const ROUTES_WRITE_TOOLS = ["add_route", "update_route", "delete_route"] as const;

const hasSales = (ctx: Pick<McpToolContext, "role" | "modules">) => effectiveModules(ctx.role, ctx.modules).includes("sales");

const fields = {
  channel: routeFieldSchemas.channel.describe(`Channel: ${ROUTE_CHANNELS.join(", ")} (call is calling). null clears it.`),
  status: routeFieldSchemas.status.describe(`Status: ${ROUTE_STATUSES.join(", ")}. null clears it.`),
  started_on: routeFieldSchemas.started_on.describe("Started on, YYYY-MM-DD. null clears it."),
  ends_on: routeFieldSchemas.ends_on.describe(`Ends on, YYYY-MM-DD. null clears it (shown as "${NO_END_DATE}").`),
  company_count: routeFieldSchemas.company_count.describe("Number of companies, filled in by hand. null clears it."),
  owner_text: routeFieldSchemas.owner_text.describe("Who runs it, free text (for example the caller). null or empty clears it."),
  note: routeFieldSchemas.note.describe("Note or next step, free text. null or empty clears it."),
};

function present(row: SalesRouteRow) {
  return { ...row, ends_on_text: row.ends_on ?? NO_END_DATE };
}

export function registerRoutesTools(server: McpServer, ctx: McpToolContext) {
  if (!hasSales(ctx)) return;
  const { db } = ctx;

  server.registerTool(
    "list_routes",
    {
      title: "Running routes",
      description:
        "The hand kept overview of outreach that runs now (Sales, Running routes): per route name, channel (call, mail, linkedin, other), status (planned, running, paused, done), started_on, ends_on (null: not clear yet), company_count, owner_text (who), note and who changed it last (updated_source handmatig or claude). Sorted on status (running first) and then ends_on. Done routes only with include_done. The routes are not linked to campaigns, buckets or companies: for where a lead really is, use get_occupancy or list_companies.",
      inputSchema: {
        include_done: z.boolean().default(false).describe("true: also routes with status done."),
      },
      annotations: READ_ONLY,
    },
    async ({ include_done }) => {
      const rows = check(await db.from("sales_routes").select("*").limit(1000), "routes") as SalesRouteRow[];
      const shown = visibleRoutes(rows, include_done);
      return ok({ total: shown.length, routes: shown.map(present) });
    },
  );

  if (ctx.access !== "write") return;

  server.registerTool(
    "add_route",
    {
      title: "Add a running route",
      description:
        "Adds a route to Sales, Running routes. Only name is required; every other field may stay empty. Changes nothing else in the portal. Only when the user or a scheduled task asked for it.",
      inputSchema: {
        name: routeFieldSchemas.name.describe("Name of the route, free text."),
        channel: fields.channel.optional(),
        status: fields.status.optional(),
        started_on: fields.started_on.optional(),
        ends_on: fields.ends_on.optional(),
        company_count: fields.company_count.optional(),
        owner_text: fields.owner_text.optional(),
        note: fields.note.optional(),
      },
      annotations: WRITE,
    },
    async (input) => {
      const { data, error } = await db
        .from("sales_routes")
        .insert({ ...input, created_by: ctx.userId, updated_by: ctx.userId, created_source: "claude", updated_source: "claude" })
        .select("*")
        .single();
      if (error || !data) return fail(`Could not add the route: ${error?.message ?? "no row"}`);
      return ok({ route: present(data) });
    },
  );

  server.registerTool(
    "update_route",
    {
      title: "Change a running route",
      description:
        "Changes the fields you give of one route in Sales, Running routes (use list_routes for the id). Fields you leave out stay as they are; null clears a field, for example ends_on null when the end is not clear any more. Changes nothing else in the portal.",
      inputSchema: {
        id: idSchema,
        name: routeFieldSchemas.name.optional(),
        channel: fields.channel.optional(),
        status: fields.status.optional(),
        started_on: fields.started_on.optional(),
        ends_on: fields.ends_on.optional(),
        company_count: fields.company_count.optional(),
        owner_text: fields.owner_text.optional(),
        note: fields.note.optional(),
      },
      annotations: WRITE,
    },
    async ({ id, ...patch }) => {
      if (Object.keys(patch).length === 0) return fail("Give at least one field to change.");
      const { data, error } = await db
        .from("sales_routes")
        .update({ ...patch, updated_by: ctx.userId, updated_source: "claude" })
        .eq("id", id)
        .select("*")
        .maybeSingle();
      if (error) return fail(`Could not change the route: ${error.message}`);
      if (!data) return fail("Route not found.");
      return ok({ route: present(data) });
    },
  );

  server.registerTool(
    "delete_route",
    {
      title: "Delete a running route",
      description:
        "Deletes one route from Sales, Running routes. Only the row in the overview goes; nothing else in the portal changes. Only when the user asked for it; for a route that ended, prefer update_route with status done.",
      inputSchema: { id: idSchema },
      annotations: DELETE,
    },
    async ({ id }) => {
      const { data, error } = await db.from("sales_routes").delete().eq("id", id).select("id, name");
      if (error) return fail(`Could not delete the route: ${error.message}`);
      if (!data?.length) return fail("Route not found.");
      return ok({ deleted: data[0] });
    },
  );
}
