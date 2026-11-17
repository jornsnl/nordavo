import "server-only";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { accessError } from "@/lib/mcp/module-scope";
import { amsterdamDate, check, clip, fail, idSchema, limitSchema, offsetSchema, ok, personName, recordUrl, searchPattern, type McpToolContext } from "@/lib/mcp/shared";
import { linkedWorkTasks } from "@/lib/mcp/work-tasks";
import { effectiveModules } from "@/lib/modules";
import { classifyLeadsForDelete } from "@/lib/sales/delete-leads";
import { isOpenStage } from "@/lib/sales/labels";
import { bestPartnerMatch, cleanPartnerInput, likeExact, partnerFillPatch, type PartnerFields } from "@/lib/sales/partner-match";
import type { Json } from "@/lib/database.types";
import type { PipelineStage } from "@/lib/sales/database";

/**
 * MCP tools for partners (people who bring in leads) and for repairing
 * mistakes in Sales (feedback Julius 68123bae, steps 2 and 4). Partners are
 * changed through sales_partner_save and contact moments through
 * sales_log_activity, both with the token owner as p_actor and source claude,
 * so every change is in Activities. A lead that was made by mistake is deleted
 * with the same safety checks as the Delete button in the portal.
 */

const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;

export const PARTNER_READ_TOOLS = ["get_partner", "list_partners"] as const;
export const PARTNER_WRITE_TOOLS = ["add_partner", "archive_company", "delete_company", "log_partner_contact", "update_partner"] as const;

const PARTNER_FIELDS = "id, name, company_name, email, phone, linkedin_url, notes, status, owner_id, last_contact_at, next_action, next_action_date, created_at";
type PartnerRow = PartnerFields & {
  id: string;
  status: "active" | "inactive";
  owner_id: string | null;
  last_contact_at: string | null;
  next_action: string | null;
  next_action_date: string | null;
  created_at: string;
};

const hasSales = (ctx: Pick<McpToolContext, "role" | "modules">) => effectiveModules(ctx.role, ctx.modules).includes("sales");

export function registerPartnerTools(server: McpServer, ctx: McpToolContext) {
  if (!hasSales(ctx)) return;
  registerRead(server, ctx);
  if (ctx.access === "write") registerWrite(server, ctx);
}

async function ownerNames(db: McpToolContext["db"], ids: (string | null)[]) {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return new Map<string, string>();
  const rows = check(await db.from("profiles").select("id, full_name, email").in("id", unique), "owners");
  return new Map(rows.map((p) => [p.id, personName(p) ?? "Team member"]));
}

function registerRead(server: McpServer, ctx: McpToolContext) {
  const { db } = ctx;
  const url = (id: string) => recordUrl(ctx.siteUrl, "partner", id);

  server.registerTool(
    "list_partners",
    {
      title: "List partners",
      description:
        "Partners (people who bring in leads), by name. Filter on status (active or inactive) and owner (a profile id, or me), or search on name or company. Each partner has leads (companies he brought in), in_pipeline (open pipeline stage) and won, the last contact and the next action. Use get_partner for the details.",
      inputSchema: {
        status: z.enum(["active", "inactive", "all"]).default("all"),
        owner_id: z.union([idSchema, z.literal("me")]).optional().describe("Only partners of this owner; me is the token owner."),
        query: z.string().trim().min(2).max(80).optional().describe("Part of the name or company."),
        limit: limitSchema,
        offset: offsetSchema,
      },
      annotations: READ_ONLY,
    },
    async ({ status, owner_id, query, limit, offset }) => {
      let q = db.from("partners").select(PARTNER_FIELDS).order("name").range(offset, offset + limit);
      if (status !== "all") q = q.eq("status", status);
      if (owner_id) q = q.eq("owner_id", owner_id === "me" ? ctx.userId : owner_id);
      if (query) {
        const pattern = searchPattern(query);
        if (!pattern) return fail("Search text too short: use at least 2 characters.");
        q = q.or(`name.ilike.${pattern},company_name.ilike.${pattern}`);
      }
      const rows = check(await q, "partners") as unknown as PartnerRow[];
      const page = rows.slice(0, limit);
      const [leads, owners] = await Promise.all([
        page.length
          ? db.from("companies").select("partner_id, pipeline_stage").in("partner_id", page.map((p) => p.id)).limit(10000)
          : Promise.resolve({ data: [], error: null }),
        ownerNames(db, page.map((p) => p.owner_id)),
      ]);
      const companies = check(leads, "leads of partners");
      return ok({
        has_more: rows.length > limit,
        partners: page.map((p) => {
          const own = companies.filter((c) => c.partner_id === p.id);
          return {
            id: p.id,
            name: p.name,
            company: p.company_name,
            email: p.email,
            phone: p.phone,
            status: p.status,
            owner: p.owner_id ? { id: p.owner_id, name: owners.get(p.owner_id) ?? null } : null,
            last_contact_at: p.last_contact_at,
            next_action: p.next_action,
            next_action_date: p.next_action_date,
            leads: own.length,
            in_pipeline: own.filter((c) => isOpenStage(c.pipeline_stage as PipelineStage | null)).length,
            won: own.filter((c) => c.pipeline_stage === "won").length,
            url: url(p.id),
          };
        }),
      });
    },
  );

  server.registerTool(
    "get_partner",
    {
      title: "Get partner",
      description:
        "One partner with all details: contact data, notes, status, owner, the contact moments (newest first), the leads he brought in with their pipeline stage and the Work tasks linked to him. Find the id with search or list_partners.",
      inputSchema: { id: idSchema, moments: z.number().int().min(0).max(100).default(20).describe("How many contact moments (default 20).") },
      annotations: READ_ONLY,
    },
    async ({ id, moments }) => {
      const row = check(await db.from("partners").select(PARTNER_FIELDS).eq("id", id).limit(1), "the partner")[0] as unknown as PartnerRow | undefined;
      if (!row) return fail("Partner not found.");
      const [activities, leads, tasks, owners] = await Promise.all([
        moments > 0
          ? db
              .from("activities")
              .select("id, date, channel, type, direction, outcome, notes, source")
              .eq("partner_id", id)
              .in("type", ["contact", "reply", "meeting", "note"])
              .order("date", { ascending: false })
              .limit(moments)
          : Promise.resolve({ data: [], error: null }),
        db.from("companies").select("id, name, domain, lead_status, pipeline_stage").eq("partner_id", id).order("name").limit(200),
        linkedWorkTasks(db, "partner", id),
        ownerNames(db, [row.owner_id]),
      ]);
      const leadRows = check(leads, "leads of the partner");
      return ok({
        id: row.id,
        name: row.name,
        company: row.company_name,
        email: row.email,
        phone: row.phone,
        linkedin_url: row.linkedin_url,
        status: row.status,
        owner: row.owner_id ? { id: row.owner_id, name: owners.get(row.owner_id) ?? null } : null,
        notes: clip(row.notes, 5000),
        last_contact_at: row.last_contact_at,
        next_action: row.next_action,
        next_action_date: row.next_action_date,
        created_at: row.created_at,
        contact_moments: check(activities, "contact moments").map((a) => ({ ...a, notes: clip(a.notes, 1000) })),
        leads: leadRows.map((c) => ({
          id: c.id,
          name: c.name,
          domain: c.domain,
          lead_status: c.lead_status,
          pipeline_stage: c.pipeline_stage,
          url: recordUrl(ctx.siteUrl, "company", c.id),
        })),
        tasks: tasks.map((t) => ({ id: t.id, title: t.title, url: recordUrl(ctx.siteUrl, "task", t.id) })),
        url: url(row.id),
      });
    },
  );
}

const contactFields = {
  company: z.string().trim().max(200).optional().describe("The company the partner works for (free text)."),
  email: z.string().trim().max(320).pipe(z.email()).optional(),
  phone: z.string().trim().max(50).optional(),
  linkedin_url: z.string().trim().max(500).optional(),
  notes: z.string().trim().max(5000).optional(),
};

function registerWrite(server: McpServer, ctx: McpToolContext) {
  const { db } = ctx;
  const actor = ctx.userId;
  const url = (id: string) => recordUrl(ctx.siteUrl, "partner", id);
  const guard = () => (hasSales(ctx) ? null : fail(accessError(["sales"])));

  // -------------------------------------------------------------------------
  server.registerTool(
    "add_partner",
    {
      title: "Add partner",
      description:
        "Add a partner (a person who brings in leads), with the same fields as New partner in the portal. Checked for duplicates first: the same e-mail, LinkedIn page or name (ignoring case and extra spaces) is the same partner. A known partner is only filled in where a field is empty (notes are added below the old ones), never overwritten, and its status and owner stay; the answer says created false and which fields were filled. Call search or list_partners first when the user only names someone. Only call after the user asked for it.",
      inputSchema: {
        name: z.string().trim().min(1).max(200),
        ...contactFields,
        status: z.enum(["active", "inactive"]).default("active"),
        owner_id: idSchema.optional().describe("Profile id of the owner. Default: the token owner."),
      },
      annotations: WRITE,
    },
    async (input) => {
      const blocked = guard();
      if (blocked) return blocked;
      const clean = cleanPartnerInput({ ...input, company: input.company });
      const exact = likeExact(clean.name);
      const [byName, byEmail, byLinkedin] = await Promise.all([
        db.from("partners").select(PARTNER_FIELDS).ilike("name", exact).limit(10),
        clean.email ? db.from("partners").select(PARTNER_FIELDS).ilike("email", likeExact(clean.email)).limit(10) : Promise.resolve({ data: [], error: null }),
        clean.linkedin_url
          ? db.from("partners").select(PARTNER_FIELDS).ilike("linkedin_url", `%${likeExact(clean.linkedin_url.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/+$/, ""))}%`).limit(10)
          : Promise.resolve({ data: [], error: null }),
      ]);
      const seen = new Map<string, PartnerRow>();
      for (const r of [byName, byEmail, byLinkedin]) for (const p of check(r, "partners") as unknown as PartnerRow[]) seen.set(p.id, p);
      // Name matches that differ in accents or case are caught by the ilike; accents need the key compare below.
      const match = bestPartnerMatch([...seen.values()], { name: clean.name, email: clean.email, linkedin_url: clean.linkedin_url });

      if (match) {
        const { patch, skipped } = partnerFillPatch(match.partner, { name: clean.name, company: clean.company_name, email: clean.email, phone: clean.phone, linkedin_url: clean.linkedin_url, notes: clean.notes }, amsterdamDate());
        if (Object.keys(patch).length > 0) {
          const { error } = await db.rpc("sales_partner_save", { p_id: match.partner.id, p_fields: patch as Json, p_source: "claude", p_actor: actor });
          if (error) return fail(`Could not fill in the partner: ${error.message}`);
        }
        return ok({
          created: false,
          duplicate_of: { id: match.partner.id, name: match.partner.name, matched_on: match.reason },
          filled: Object.keys(patch),
          not_overwritten: skipped,
          url: url(match.partner.id),
        });
      }

      if (input.owner_id) {
        const owner = check(await db.from("profiles").select("id, role").eq("id", input.owner_id).limit(1), "the owner")[0];
        if (!owner || !["admin", "member"].includes(owner.role)) return fail("The owner is not a Nordavo team member.");
      }
      const fields: Record<string, Json> = { name: clean.name, status: input.status };
      for (const key of ["company_name", "email", "phone", "linkedin_url", "notes"] as const) if (clean[key]) fields[key] = clean[key];
      if (input.owner_id) fields.owner_id = input.owner_id;
      const { data, error } = await db.rpc("sales_partner_save", { p_id: null, p_fields: fields as Json, p_source: "claude", p_actor: actor });
      if (error || !data) return fail(`Could not add the partner: ${error?.message ?? "no id returned"}`);
      return ok({ created: true, id: data, name: clean.name, url: url(data) });
    },
  );

  // -------------------------------------------------------------------------
  server.registerTool(
    "update_partner",
    {
      title: "Update partner",
      description:
        "Change a partner: name, company, e-mail, phone, LinkedIn, notes (replaces them), status (active or inactive: use inactive to retire a partner) or owner. Leave out what stays the same; null clears company, e-mail, phone, LinkedIn or notes. Logged in Activities with source claude (contact details only as 'changed'). Only call after the user asked for it.",
      inputSchema: {
        id: idSchema,
        name: z.string().trim().min(1).max(200).optional(),
        company: z.string().trim().max(200).nullable().optional(),
        email: z.string().trim().max(320).pipe(z.email()).nullable().optional(),
        phone: z.string().trim().max(50).nullable().optional(),
        linkedin_url: z.string().trim().max(500).nullable().optional(),
        notes: z.string().trim().max(5000).nullable().optional(),
        status: z.enum(["active", "inactive"]).optional(),
        owner_id: idSchema.optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ id, company, ...rest }) => {
      const blocked = guard();
      if (blocked) return blocked;
      const fields: Record<string, Json> = {};
      if (rest.name !== undefined) fields.name = rest.name;
      if (company !== undefined) fields.company_name = company || null;
      if (rest.email !== undefined) fields.email = rest.email ? cleanPartnerInput({ name: "x", email: rest.email }).email : null;
      if (rest.phone !== undefined) fields.phone = rest.phone ? cleanPartnerInput({ name: "x", phone: rest.phone }).phone : null;
      if (rest.linkedin_url !== undefined) fields.linkedin_url = rest.linkedin_url ? cleanPartnerInput({ name: "x", linkedin_url: rest.linkedin_url }).linkedin_url : null;
      if (rest.notes !== undefined) fields.notes = rest.notes || null;
      if (rest.status !== undefined) fields.status = rest.status;
      if (rest.owner_id !== undefined) {
        const owner = check(await db.from("profiles").select("id, role").eq("id", rest.owner_id).limit(1), "the owner")[0];
        if (!owner || !["admin", "member"].includes(owner.role)) return fail("The owner is not a Nordavo team member.");
        fields.owner_id = rest.owner_id;
      }
      if (Object.keys(fields).length === 0) return fail("Nothing to change: give at least one field.");
      const { error } = await db.rpc("sales_partner_save", { p_id: id, p_fields: fields as Json, p_source: "claude", p_actor: actor });
      if (error) return fail(/not found/i.test(error.message) ? "Partner not found." : `Could not update the partner: ${error.message}`);
      const row = check(await db.from("partners").select(PARTNER_FIELDS).eq("id", id).limit(1), "the partner")[0] as unknown as PartnerRow | undefined;
      return ok({
        updated: row ? { id: row.id, name: row.name, company: row.company_name, email: row.email, phone: row.phone, linkedin_url: row.linkedin_url, status: row.status, owner_id: row.owner_id } : { id },
        changed: Object.keys(fields),
        url: url(id),
      });
    },
  );

  // -------------------------------------------------------------------------
  server.registerTool(
    "log_partner_contact",
    {
      title: "Log contact with partner",
      description:
        "Log a contact moment with a partner (a call, mail, LinkedIn message or meeting): it shows in his timeline and sets Last contact. Say what was discussed in notes. date defaults to now; a past day is logged at noon. Only call after the user asked for it.",
      inputSchema: {
        partner_id: idSchema,
        channel: z.enum(["bellen", "mail", "linkedin", "meeting"]),
        notes: z.string().trim().min(1).max(5000).describe("What was discussed."),
        direction: z.enum(["inbound", "outbound"]).optional(),
        type: z.enum(["contact", "reply", "meeting"]).default("contact"),
        date: z.iso.date().optional().describe("YYYY-MM-DD, today or in the past."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (input) => {
      const blocked = guard();
      if (blocked) return blocked;
      const today = amsterdamDate();
      if (input.date && input.date > today) return fail("A contact moment cannot be in the future.");
      const exists = check(await db.from("partners").select("id").eq("id", input.partner_id).limit(1), "the partner")[0];
      if (!exists) return fail("Partner not found.");
      const date = input.date && input.date !== today ? new Date(`${input.date}T12:00:00Z`).toISOString() : null;
      const { data, error } = await db.rpc("sales_log_activity", {
        p_company: null,
        p_contact: null,
        p_partner: input.partner_id,
        p_channel: input.channel,
        p_type: input.type,
        p_notes: input.notes,
        p_direction: input.direction,
        p_date: date ?? undefined,
        p_source: "claude",
        p_actor: actor,
      });
      if (error) return fail(`Could not log the contact moment: ${error.message}`);
      return ok({ activity_id: data, logged: true, url: url(input.partner_id) });
    },
  );

  // -------------------------------------------------------------------------
  server.registerTool(
    "delete_company",
    {
      title: "Delete company (lead made by mistake)",
      description:
        "Delete a lead that was created by mistake, with the same safety checks as the Delete button in the portal: a company that is in the pipeline, linked to a client, or already approached (a call, mail, reply or meeting, also a meeting in the register) is kept and the answer says why; use archive_company for those. Its contacts, signals, timeline and linked Work tasks go with it. Logged in the activity log with source claude. Only call after the user asked for it, and only for something that should not exist.",
      inputSchema: { id: idSchema, reason: z.string().trim().max(500).optional().describe("Why it is removed, for the log.") },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async ({ id, reason }) => {
      const blocked = guard();
      if (blocked) return blocked;
      const checked = await classifyLeadsForDelete(db, [id]);
      if (!checked.ok) return fail("Could not check the company.");
      if (checked.missing.length) return fail("Company not found.");
      if (checked.kept.length) {
        return fail(`Not deleted: ${checked.kept[0].name} is kept (${checked.kept[0].reason}). Use archive_company to take it out of the work instead.`);
      }
      const [lead] = checked.deletable;
      const { error } = await db.from("companies").delete().eq("id", id);
      if (error) return fail(`Could not delete the company: ${error.message}`);
      await db.from("activity_log").insert({
        entity_type: "company",
        entity_id: id,
        action: "deleted",
        summary: `Lead ${lead.name} deleted`,
        changes: { source: "claude", name: lead.name, reason: reason ?? null },
        actor_id: actor,
      });
      return ok({ deleted: true, id, name: lead.name });
    },
  );

  // -------------------------------------------------------------------------
  server.registerTool(
    "archive_company",
    {
      title: "Archive company (No go)",
      description:
        "Take a company out of the work without deleting it: lead status No go, so it is not approached again, with its history intact. For a company that is in the pipeline, set pipeline_stage lost (with lost_reason) through update_companies instead. Goes through sales_update, logged with source claude. Only call after the user asked for it.",
      inputSchema: { id: idSchema },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ id }) => {
      const blocked = guard();
      if (blocked) return blocked;
      const row = check(await db.from("companies").select("id, name, pipeline_stage, lead_status").eq("id", id).limit(1), "the company")[0];
      if (!row) return fail("Company not found.");
      if (row.pipeline_stage && row.pipeline_stage !== "lost") {
        return fail(`${row.name} is in the pipeline (${row.pipeline_stage}): set pipeline_stage lost with a lost_reason through update_companies.`);
      }
      if (row.lead_status === "no_go") return ok({ archived: true, id, name: row.name, already: true });
      const { error } = await db.rpc("sales_update", { p_entity: "company", p_ids: [id], p_fields: { lead_status: "no_go" }, p_source: "claude", p_actor: actor });
      if (error) return fail(`Could not archive the company: ${error.message}`);
      return ok({ archived: true, id, name: row.name, lead_status: "no_go", url: recordUrl(ctx.siteUrl, "company", id) });
    },
  );
}
