import "server-only";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Json } from "@/lib/database.types";
import { accessError } from "@/lib/mcp/module-scope";
import { check, fail, idSchema, limitSchema, ok, recordUrl, type McpToolContext } from "@/lib/mcp/shared";
import { effectiveModules } from "@/lib/modules";
import { isDevDataTitle } from "@/lib/sales/follow";
import { groupOccupancy, occupancyText, summarizeBuckets, summarizeSourceLists } from "@/lib/sales/triage";
import type { OccupancyRow } from "@/lib/sales/flow-database";

/**
 * MCP tools for campaigns, triage, occupancy and followed companies (feedback
 * Julius, round 4: 4f7fd90a, 038aa8ea, 264ce8e7, 9eb8d313). Claude registers
 * the campaigns of Instantly and Seleqt with their leads and replies, sends
 * incoming leads to a destination and checks the followed companies for new
 * dev and data vacancies. Writes go through the database functions with the
 * token owner as p_actor and source claude, so the rules (one running
 * campaign per lead, every move in Activities) apply.
 */

const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;

export const SALES_FLOW_READ_TOOLS = ["get_campaign", "get_occupancy", "list_campaigns", "list_followed_companies", "list_incoming"] as const;
export const SALES_FLOW_WRITE_TOOLS = ["follow_company", "register_campaign_members", "triage_leads", "upsert_campaign"] as const;

const hasSales = (ctx: Pick<McpToolContext, "role" | "modules">) => effectiveModules(ctx.role, ctx.modules).includes("sales");

export function registerSalesFlowTools(server: McpServer, ctx: McpToolContext) {
  if (!hasSales(ctx)) return;
  registerRead(server, ctx);
  if (ctx.access === "write") registerWrite(server, ctx);
}

const memberStatus = z.enum(["queued", "active", "replied", "finished", "stopped", "bounced", "unsubscribed"]);

function registerRead(server: McpServer, ctx: McpToolContext) {
  const { db } = ctx;
  const url = (type: string, id: string) => recordUrl(ctx.siteUrl, type, id);

  server.registerTool(
    "list_campaigns",
    {
      title: "Campaigns (Instantly, Seleqt)",
      description:
        "Running mail campaigns (Instantly) and LinkedIn campaigns (Seleqt) in the portal, with how many leads are in each and how many replied. include_finished also lists finished ones. The external_id is the id in Instantly or Seleqt.",
      inputSchema: { include_finished: z.boolean().optional(), limit: limitSchema },
      annotations: READ_ONLY,
    },
    async ({ include_finished, limit }) => {
      let q = db
        .from("campaigns")
        .select("id, name, channel, provider, status, external_id, started_at, ended_at, synced_at")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (!include_finished) q = q.neq("status", "finished");
      const campaigns = check(await q, "campaigns");
      const ids = campaigns.map((c) => c.id);
      const counts = new Map<string, Record<string, number>>();
      if (ids.length) {
        const members = check(await db.from("campaign_members").select("campaign_id, status").in("campaign_id", ids).limit(50000), "members");
        for (const m of members) {
          const c = counts.get(m.campaign_id) ?? {};
          c[m.status] = (c[m.status] ?? 0) + 1;
          counts.set(m.campaign_id, c);
        }
      }
      return ok({
        campaigns: campaigns.map((c) => ({ ...c, members: counts.get(c.id) ?? {}, url: `${ctx.siteUrl.replace(/\/$/, "")}/dashboard/sequences/campaigns/${c.id}` })),
      });
    },
  );

  server.registerTool(
    "get_campaign",
    {
      title: "Campaign with its leads",
      description: "One campaign with every lead in it: company, contact, mail, status (queued: still to add in Instantly or Seleqt, active, replied, finished, ...), since and replied.",
      inputSchema: { id: idSchema, status: z.array(memberStatus).max(7).optional() },
      annotations: READ_ONLY,
    },
    async ({ id, status }) => {
      const campaign = check(await db.from("campaigns").select("*").eq("id", id).maybeSingle(), "campaign");
      if (!campaign) return fail("Campaign not found.");
      let q = db
        .from("campaign_members")
        .select(
          "id, company_id, contact_id, status, added_at, ended_at, replied_at, reply_outcome, external_id, company:companies!campaign_members_company_id_fkey(name, domain), contact:contacts!campaign_members_contact_id_fkey(first_name, last_name, email, linkedin_url)",
        )
        .eq("campaign_id", id)
        .order("added_at")
        .limit(5000);
      if (status?.length) q = q.in("status", status);
      const members = check(await q, "members");
      return ok({
        campaign,
        members: members.map((m) => ({
          ...m,
          company_url: url("company", m.company_id),
        })),
      });
    },
  );

  server.registerTool(
    "get_occupancy",
    {
      title: "Where leads are (occupancy)",
      description:
        "Per company: its bucket (incoming, find_number, call, mail_campaign, linkedin_campaign, sequence, pipeline, parked, no_go, free), whether it is free, and every campaign, call list or sequence it is or was in with channel, since, until and replied. Check this before putting a lead in a campaign.",
      inputSchema: { company_ids: z.array(idSchema).min(1).max(200) },
      annotations: READ_ONLY,
    },
    async ({ company_ids }) => {
      const [companies, occ] = await Promise.all([
        db.from("companies").select("id, name, bucket, bucket_until, bucket_reason, source_list").in("id", company_ids),
        db.from("sales_occupancy").select("*").in("company_id", company_ids),
      ]);
      const grouped = groupOccupancy(check(occ, "occupancy") as OccupancyRow[]);
      return ok({
        companies: check(companies, "companies").map((c) => {
          const list = grouped.get(c.id) ?? [];
          return {
            ...c,
            free: (c.bucket === "incoming" || c.bucket === "free") && !list.some((o) => o.active),
            occupancy: list.map((o) => ({ ...o, text: occupancyText(o) })),
          };
        }),
      });
    },
  );

  server.registerTool(
    "list_incoming",
    {
      title: "Incoming leads per list",
      description:
        "The Incoming inbox: per bucket how many leads and who works on them, per source list how many leads still have no destination, and the incoming leads themselves (optionally of one source_list).",
      inputSchema: { source_list: z.string().max(200).optional(), limit: limitSchema },
      annotations: READ_ONLY,
    },
    async ({ source_list, limit }) => {
      const rows = check(
        await db.from("companies").select("id, name, city, prio, lead_status, bucket, source_list, created_at").limit(50000),
        "companies",
      );
      const leads = rows.map((r) => ({ id: r.id, bucket: r.bucket, source_list: r.source_list, worker: null }));
      const incoming = rows
        .filter((r) => r.bucket === "incoming" && (!source_list || (r.source_list ?? "No list") === source_list))
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
        .slice(0, limit)
        .map((r) => ({ ...r, url: url("company", r.id) }));
      return ok({ buckets: summarizeBuckets(leads).map((b) => ({ bucket: b.bucket, count: b.count })), source_lists: summarizeSourceLists(leads), incoming });
    },
  );

  server.registerTool(
    "list_followed_companies",
    {
      title: "Followed companies",
      description:
        "Companies the team follows for new dev and data vacancies, with owner, website, LinkedIn and their known vacancies (title, link, first seen). Use it on a schedule: look for new dev or data vacancies of these companies and add them with upsert_companies (signals); the portal then makes a task for the owner by itself.",
      inputSchema: { limit: limitSchema },
      annotations: READ_ONLY,
    },
    async ({ limit }) => {
      const companies = check(
        await db
          .from("companies")
          .select("id, name, domain, website, linkedin_url, owner_id, followed_at, followed_by")
          .not("followed_at", "is", null)
          .order("followed_at", { ascending: false })
          .limit(limit),
        "companies",
      );
      const ids = companies.map((c) => c.id);
      const signals = ids.length
        ? check(await db.from("signals").select("company_id, title, source_url, first_seen_at, posted_at").in("company_id", ids).limit(5000), "signals")
        : [];
      return ok({
        companies: companies.map((c) => ({
          ...c,
          url: url("company", c.id),
          vacancies: signals
            .filter((s) => s.company_id === c.id)
            .map((s) => ({ title: s.title, url: s.source_url, first_seen_at: s.first_seen_at, posted_at: s.posted_at, dev_or_data: isDevDataTitle(s.title) })),
        })),
      });
    },
  );
}

function registerWrite(server: McpServer, ctx: McpToolContext) {
  const { db } = ctx;
  const actor = ctx.userId;
  const guard = () => (ctx.access !== "write" ? fail("This token can only read.") : hasSales(ctx) ? null : fail(accessError(["sales"])));

  server.registerTool(
    "upsert_campaign",
    {
      title: "Add or update a campaign",
      description:
        "A campaign of Instantly (mail) or Seleqt (LinkedIn) in the portal, found by external_id (its id there) or id. Sets name and status (draft, active, paused, finished). Finishing a campaign ends its running leads; those without a reply become free again.",
      inputSchema: {
        id: idSchema.optional(),
        external_id: z.string().min(1).max(300).optional(),
        name: z.string().min(1).max(200),
        channel: z.enum(["mail", "linkedin"]),
        provider: z.enum(["instantly", "seleqt", "other"]),
        status: z.enum(["draft", "active", "paused", "finished"]).default("active"),
        started_at: z.iso.datetime({ offset: true }).optional(),
      },
      annotations: WRITE,
    },
    async (input) => {
      const blocked = guard();
      if (blocked) return blocked;
      let existing: { id: string } | null = null;
      if (input.id) existing = check(await db.from("campaigns").select("id").eq("id", input.id).maybeSingle(), "campaign");
      else if (input.external_id) existing = check(await db.from("campaigns").select("id").eq("external_id", input.external_id).maybeSingle(), "campaign");
      const row = {
        name: input.name,
        channel: input.channel,
        provider: input.provider,
        status: input.status,
        external_id: input.external_id ?? null,
        ...(input.started_at ? { started_at: input.started_at } : {}),
        ...(input.status === "finished" ? { ended_at: new Date().toISOString() } : {}),
      };
      if (existing) {
        const { error } = await db.from("campaigns").update(row).eq("id", existing.id);
        if (error) return fail(`Could not update the campaign: ${error.message}`);
        return ok({ id: existing.id, created: false });
      }
      const { data, error } = await db
        .from("campaigns")
        .insert({ ...row, started_at: input.started_at ?? new Date().toISOString(), created_by: actor })
        .select("id")
        .single();
      if (error) return fail(`Could not add the campaign: ${error.message}`);
      return ok({ id: data.id, created: true });
    },
  );

  server.registerTool(
    "register_campaign_members",
    {
      title: "Leads in a campaign and replies",
      description:
        "Who is in a campaign and who replied. Each member is found by contact_id, company_id or the email of a contact. status: active (in the campaign), replied (with replied_at and reply_outcome reply_positief, reply_neutraal or reply_negatief), finished, stopped, bounced, unsubscribed. A lead already in another running campaign is refused and named unless force is true. Log the reply text itself with log_activity.",
      inputSchema: {
        campaign_id: idSchema,
        members: z
          .array(
            z.object({
              contact_id: idSchema.optional(),
              company_id: idSchema.optional(),
              email: z.string().max(320).optional(),
              status: memberStatus.optional(),
              replied_at: z.iso.datetime({ offset: true }).optional(),
              reply_outcome: z.enum(["reply_positief", "reply_neutraal", "reply_negatief"]).optional(),
              external_id: z.string().max(300).optional(),
            }),
          )
          .min(1)
          .max(500),
        force: z.boolean().optional(),
        source: z.enum(["claude", "instantly", "seleqt"]).default("claude"),
      },
      annotations: WRITE,
    },
    async ({ campaign_id, members, force, source }) => {
      const blocked = guard();
      if (blocked) return blocked;
      const { data, error } = await db.rpc("sales_register_campaign_members", {
        p_campaign: campaign_id,
        p_members: members as Json,
        p_force: force ?? false,
        p_source: source,
        p_actor: actor,
      });
      if (error) return fail(`Could not register the members: ${error.message}`);
      return ok(data);
    },
  );

  server.registerTool(
    "triage_leads",
    {
      title: "Send leads to a destination",
      description:
        "Moves one or more leads to exactly one bucket: find_number (to Max), call (view_id of a call list or caller_id of an external caller), mail_campaign or linkedin_campaign (campaign_id), parked (until, a date), no_go (reason), incoming or free. Occupied leads are skipped (and listed) unless force. Only when the user or a scheduled task asked for it.",
      inputSchema: {
        company_ids: z.array(idSchema).min(1).max(500),
        destination: z.enum(["incoming", "find_number", "call", "mail_campaign", "linkedin_campaign", "parked", "no_go", "free"]),
        view_id: idSchema.optional(),
        caller_id: idSchema.optional(),
        campaign_id: idSchema.optional(),
        until: z.iso.date().optional(),
        reason: z.string().max(2000).optional(),
        force: z.boolean().optional(),
      },
      annotations: WRITE,
    },
    async (input) => {
      const blocked = guard();
      if (blocked) return blocked;
      const { data, error } = await db.rpc("sales_triage", {
        p_companies: [...new Set(input.company_ids)],
        p_destination: input.destination,
        p_options: {
          view_id: input.view_id ?? null,
          caller_id: input.caller_id ?? null,
          campaign_id: input.campaign_id ?? null,
          until: input.until ?? null,
          reason: input.reason ?? null,
          force: input.force ?? false,
        } as Json,
        p_source: "claude",
        p_actor: actor,
      });
      if (error) return fail(`Could not move the leads: ${error.message}`);
      return ok(data);
    },
  );

  server.registerTool(
    "follow_company",
    {
      title: "Follow or unfollow a company",
      description: "Follow a company for new dev and data vacancies: a new matching vacancy gives its owner a task. Logged in Activities.",
      inputSchema: { company_ids: z.array(idSchema).min(1).max(100), follow: z.boolean() },
      annotations: WRITE,
    },
    async ({ company_ids, follow }) => {
      const blocked = guard();
      if (blocked) return blocked;
      const { data, error } = await db.rpc("sales_update_more", {
        p_entity: "company",
        p_ids: [...new Set(company_ids)],
        p_fields: { followed: follow },
        p_source: "claude",
        p_actor: actor,
      });
      if (error) return fail(`Could not change the follow: ${error.message}`);
      return ok({ updated: data ?? 0 });
    },
  );
}
