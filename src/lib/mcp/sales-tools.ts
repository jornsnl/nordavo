import "server-only";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ActivityOutcome, Database, Json } from "@/lib/database.types";
import { amsterdamMidnight, periodRange } from "@/lib/gtm/report";
import { extractLeadNotes } from "@/lib/gtm/lead-notes";
import {
  cleanLinkedinUrl,
  cleanSourceUrl,
  normalizeDomain,
  normalizeEmail,
  normalizeLinkedin,
  normalizePhone,
  phoneTypeFor,
  splitName,
} from "@/lib/gtm/normalize";
import { upsertSignal } from "@/lib/gtm/upsert";
import { contactRoleFrom, linkedinPatch, personKeys } from "@/lib/sales/contact-keys";
import { findSalesContact } from "@/lib/sales/contact-match";
import { duplicateWarning, type SimilarCompany } from "@/lib/sales/duplicates";
import { daysOnline, onlineSince } from "@/lib/sales/vacancies";
import { accessError } from "@/lib/mcp/module-scope";
import {
  check,
  clip,
  fail,
  idSchema,
  limitSchema,
  offsetSchema,
  ok,
  personName,
  recordUrl,
  searchPattern,
  type McpDb,
  type McpToolContext,
} from "@/lib/mcp/shared";
import { effectiveModules, jobModule } from "@/lib/modules";
import type { LeadStatus } from "@/lib/sales/database";
import { companyCategories, contactRoles, leadStatuses, meetingStatuses, pipelineStages, sequenceStatuses } from "@/lib/sales/labels";
import { countLeadStatuses, loadSalesFigures } from "@/lib/sales/stats";

/**
 * MCP tools for the sales CRM (feedback Julius, part 7): Claude reads the
 * companies, contacts, meetings, call lists, sequences and replies, and with
 * a write token does what the scheduled tasks need (docs/claude-jobs.md).
 *
 * Every write goes through the sales functions of the database with the
 * secret key and p_actor = the token owner, so it has the rights of the owner
 * (the sales module) and lands in Activities with that person and source
 * 'claude' (or the source of the data, such as instantly for a reply).
 * Companies and contacts are only changed through sales_update.
 */

const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;

const values = <T extends string>(options: { value: T }[]) => options.map((o) => o.value) as [T, ...T[]];

const leadStatus = z.enum(values(leadStatuses));
const pipelineStage = z.enum(values(pipelineStages));
const category = z.enum(values(companyCategories));
const contactRole = z.enum(values(contactRoles));
/** Role of a contact as Claude may write it: main, backup (stored as reserve) or extra. */
const contactRoleInput = z
  .enum(["main", "backup", "reserve", "extra"])
  .transform((v) => contactRoleFrom(v) ?? "extra")
  .describe("main (one per company, the primary contact), backup or extra.");
const tierInput = z.number().int().min(1).max(3).describe("1 CTO or head of engineering or data, 2 owner or director, 3 recruiter or HR.");
const meetingStatus = z.enum(values(meetingStatuses));
const sequenceStatus = z.enum(values(sequenceStatuses));
const icpDecision = z.enum(["GO", "NO_GO", "REVIEW"]);
const contactStatus = z.enum([
  "new",
  "qualified",
  "enrich",
  "enriched",
  "in_outreach",
  "reached",
  "not_reached",
  "not_interested",
  "do_not_contact",
]);
const activityOutcome = z.enum([
  "verstuurd",
  "reply_positief",
  "reply_neutraal",
  "reply_negatief",
  "bounce",
  "afgemeld",
  "no_answer",
  "call_back",
  "reached_interested",
  "meeting_planned",
  "reached_not_interested",
  "referred",
  "wrong_person",
  "wrong_number",
  "meeting_held",
  "meeting_no_show",
  "meeting_cancelled",
  "notitie",
]) satisfies z.ZodType<ActivityOutcome>;
const dateSchema = z.iso.date().describe("Date as YYYY-MM-DD.");
const dateTimeSchema = z.iso.datetime({ offset: true }).describe("ISO date and time, e.g. 2026-11-12T14:00:00+01:00.");
const idsSchema = z.array(idSchema).min(1).max(200);

/** The sales tools exist only for owners with the sales module (2.5). */
export function hasSales(ctx: Pick<McpToolContext, "role" | "modules">): boolean {
  return effectiveModules(ctx.role, ctx.modules).includes("sales");
}

/** Read tool names, for tests and docs. */
export const SALES_READ_TOOLS = [
  "get_company",
  "get_sequence",
  "list_call_lists",
  "list_companies",
  "list_contacts",
  "list_job_runs",
  "list_meetings",
  "list_replies_to_review",
  "list_sequence_tasks",
  "list_sequences",
  "sales_stats",
] as const;

export const SALES_WRITE_TOOLS = [
  "add_company",
  "add_contact",
  "close_list_for_callers",
  "create_meeting",
  "draft_sequence_text",
  "log_activity",
  "merge_companies",
  "merge_contacts",
  "open_list_for_callers",
  "pause_company",
  "set_icp_verdict",
  "start_sequence",
  "update_companies",
  "update_contacts",
  "update_meeting",
  "update_sequence_tasks",
  "update_signals",
  "upsert_companies",
] as const;

/** Where a lead added by hand through Claude came from (companies.source). */
export const LEAD_ORIGINS = ["inbound", "linkedin", "partner", "network"] as const;
export type LeadOrigin = (typeof LEAD_ORIGINS)[number];
const originLabels: Record<LeadOrigin, string> = { inbound: "Inbound", linkedin: "LinkedIn", partner: "Partner", network: "Network" };

/** Register the sales tools; write tools only for write tokens. */
export function registerSalesTools(server: McpServer, ctx: McpToolContext) {
  if (!hasSales(ctx)) return;
  registerSalesReadTools(server, ctx);
  if (ctx.access === "write") registerSalesWriteTools(server, ctx);
}

function rpcError(error: { message: string } | null, what: string) {
  return error ? fail(`Could not ${what}: ${error.message}`) : null;
}

function name(first: string | null, last: string | null) {
  return [first, last].filter(Boolean).join(" ").trim() || null;
}

// ---------------------------------------------------------------------------
// Read tools
// ---------------------------------------------------------------------------

const COMPANY_LIST_FIELDS =
  "id, name, domain, city, sector, employees, prio, category, icp_decision, icp_score, lead_status, lead_status_changed_at, pipeline_stage, pipeline_stage_changed_at, lost_reason, parked_until, profiles_due_on, owner_id, partner_id, next_action, next_action_date, pinned_at, manual_position, general_phone, sequence_paused_at" as const;

function registerSalesReadTools(server: McpServer, ctx: McpToolContext) {
  const { db } = ctx;
  const url = (type: string, id: string) => recordUrl(ctx.siteUrl, type, id);

  // -------------------------------------------------------------------------
  server.registerTool(
    "list_companies",
    {
      title: "Companies (sales)",
      description:
        "List sales companies (leads) with lead status, pipeline stage, prio, category, ICP verdict, owner and next action. Pinned first, then by prio. Filter on lead_status, pipeline_stage (or in_pipeline), prio, category, icp, text (name or domain) and has_phone (a contact or the company has a phone number).",
      inputSchema: {
        lead_status: z.array(leadStatus).max(8).optional().describe("One or more lead statuses."),
        pipeline_stage: z.array(pipelineStage).max(11).optional().describe("One or more pipeline stages."),
        in_pipeline: z.boolean().optional().describe("true: only companies in the pipeline; false: only companies not in it."),
        prio: z.array(z.number().int().min(1).max(5)).max(5).optional(),
        category: category.optional(),
        icp: icpDecision.optional().describe("ICP verdict."),
        text: z.string().max(80).optional().describe("Part of the name or domain."),
        has_phone: z.boolean().optional(),
        owner_id: idSchema.optional(),
        partner_id: idSchema.optional(),
        limit: limitSchema,
        offset: offsetSchema,
      },
      annotations: READ_ONLY,
    },
    async (input) => {
      const pattern = searchPattern(input.text);
      const build = () => {
        let q = db.from("companies").select(COMPANY_LIST_FIELDS, { count: "exact" });
        if (input.lead_status?.length) q = q.in("lead_status", input.lead_status);
        if (input.pipeline_stage?.length) q = q.in("pipeline_stage", input.pipeline_stage);
        if (input.in_pipeline === true) q = q.not("pipeline_stage", "is", null);
        if (input.in_pipeline === false) q = q.is("pipeline_stage", null);
        if (input.prio?.length) q = q.in("prio", input.prio);
        if (input.category) q = q.eq("category", input.category);
        if (input.icp) q = q.eq("icp_decision", input.icp);
        if (input.owner_id) q = q.eq("owner_id", input.owner_id);
        if (input.partner_id) q = q.eq("partner_id", input.partner_id);
        if (pattern) q = q.or(`name.ilike.${pattern},domain.ilike.${pattern}`);
        return q
          .order("pinned_at", { ascending: false, nullsFirst: false })
          .order("prio", { ascending: true, nullsFirst: false })
          .order("name");
      };

      let rows: Awaited<ReturnType<typeof build>>["data"] = [];
      let total: number | null = null;
      if (input.has_phone === undefined) {
        const result = await build().range(input.offset, input.offset + input.limit - 1);
        rows = check(result, "companies");
        total = result.count;
      } else {
        // A phone on a contact or on the company: filter in memory.
        const withPhone = new Set<string>();
        for (let from = 0; from < 20_000; from += 1000) {
          const page = check(
            await db.from("contacts").select("company_id").not("phone", "is", null).range(from, from + 999),
            "contacts",
          );
          for (const c of page) withPhone.add(c.company_id);
          if (page.length < 1000) break;
        }
        const matched: NonNullable<typeof rows> = [];
        for (let from = 0; from < 20_000; from += 1000) {
          const page = check(await build().range(from, from + 999), "companies");
          for (const c of page) {
            const has = withPhone.has(c.id) || Boolean(c.general_phone);
            if (has === input.has_phone) matched.push(c);
          }
          if (page.length < 1000) break;
        }
        total = matched.length;
        rows = matched.slice(input.offset, input.offset + input.limit);
      }

      const list = rows ?? [];
      const people = await peopleNames(db, list.map((c) => c.owner_id));
      const partners = await partnerNames(db, list.map((c) => c.partner_id));
      return ok({
        total,
        companies: list.map((c) => ({
          ...c,
          owner: c.owner_id ? (people.get(c.owner_id) ?? null) : null,
          partner: c.partner_id ? (partners.get(c.partner_id) ?? null) : null,
          url: url("company", c.id),
        })),
      });
    },
  );

  // -------------------------------------------------------------------------
  server.registerTool(
    "get_company",
    {
      title: "Company (sales)",
      description:
        "One sales company with lead status, pipeline stage, prio, category, ICP verdict and reason, opening line, red flags, general number, owner, partner, next action, its contacts (role main, backup (reserve) or extra, tier, status, primary, LinkedIn link and member id), vacancies and other signals (link, text, date online, days open, closed), possible duplicate companies, the last activities, meetings, sequences and notes. Use list_companies or search to find ids.",
      inputSchema: { id: idSchema },
      annotations: READ_ONLY,
    },
    async ({ id }) => {
      const company = check(
        await db
          .from("companies")
          .select(
            "id, name, domain, website, city, sector, segment, employees, linkedin_url, general_phone, description, status, prio, category, icp_decision, icp_score, icp_reason, red_flags, opening_line, source, source_note, lead_status, lead_status_changed_at, pipeline_stage, pipeline_stage_changed_at, pipeline_entered_at, lost_reason, parked_until, profiles_due_on, owner_id, partner_id, next_action, next_action_date, pinned_at, manual_position, sequence_paused_at, client_id, created_at",
          )
          .eq("id", id)
          .maybeSingle(),
        "company",
      );
      if (!company || Array.isArray(company)) return fail("Company not found.");

      const [contacts, signals, activities, meetings, enrollments, notes, people, partners] = await Promise.all([
        db
          .from("contacts")
          .select(
            "id, first_name, last_name, title, tier, role, is_primary, status, phone, phone_type, email, email_status, linkedin_url, linkedin_member_urn, attempts, last_attempt_at, callback_at, referred_to, assigned_caller_id, last_contacted_at",
          )
          .eq("company_id", id)
          .order("is_primary", { ascending: false })
          .order("tier", { ascending: true, nullsFirst: false })
          .limit(50),
        db
          .from("signals")
          .select("id, type, title, role_group, posted_at, source, source_url, description, closed_at, first_seen_at, last_seen_at")
          .eq("company_id", id)
          .order("last_seen_at", { ascending: false })
          .limit(30),
        db
          .from("activities")
          .select("id, date, type, channel, direction, outcome, notes, source, field, old_value, new_value, contact_id, created_by, review_status")
          .eq("company_id", id)
          .neq("type", "view")
          .order("date", { ascending: false })
          .limit(25),
        db
          .from("meetings")
          .select("id, status, scheduled_at, reason, fee, source, external_id, contact_id, caller_id, created_at")
          .eq("company_id", id)
          .order("created_at", { ascending: false })
          .limit(20),
        db
          .from("sequence_enrollments")
          .select("id, status, started_at, paused_at, pause_reason, source, sequence:sequences(id, name)")
          .eq("company_id", id)
          .order("started_at", { ascending: false })
          .limit(20),
        db
          .from("notes")
          .select("id, body, created_at, author:profiles!notes_author_id_fkey(full_name, email)")
          .eq("entity_type", "company")
          .eq("entity_id", id)
          .order("created_at", { ascending: false })
          .limit(10),
        peopleNames(db, [company.owner_id]),
        partnerNames(db, [company.partner_id]),
      ]);

      const activityRows = check(activities, "activities");
      const actors = await peopleNames(db, activityRows.map((a) => a.created_by));
      return ok({
        ...company,
        icp_reason: clip(company.icp_reason, 1000),
        owner: company.owner_id ? (people.get(company.owner_id) ?? null) : null,
        partner: company.partner_id ? (partners.get(company.partner_id) ?? null) : null,
        url: url("company", company.id),
        contacts: check(contacts, "contacts").map((c) => ({ ...c, name: name(c.first_name, c.last_name) })),
        signals: check(signals, "signals").map((sig) => {
          const since = onlineSince(sig);
          return { ...sig, description: clip(sig.description, 2000), online_since: since, days_open: sig.closed_at ? null : daysOnline(since) };
        }),
        possible_duplicates: await similarCompanies(db, company.name, company.domain, company.id),
        last_activities: activityRows.map((a) => ({
          ...a,
          notes: clip(a.notes, 500),
          by: a.created_by ? (actors.get(a.created_by) ?? null) : null,
        })),
        meetings: check(meetings, "meetings"),
        sequences: check(enrollments, "sequences").map((e) => ({
          enrollment_id: e.id,
          sequence_id: e.sequence?.id ?? null,
          sequence: e.sequence?.name ?? null,
          status: e.status,
          started_at: e.started_at,
          paused_at: e.paused_at,
          pause_reason: e.pause_reason,
          source: e.source,
        })),
        recent_notes: check(notes, "notes").map((n) => ({ id: n.id, at: n.created_at, by: personName(n.author), body: clip(n.body, 1000) })),
      });
    },
  );

  // -------------------------------------------------------------------------
  server.registerTool(
    "list_contacts",
    {
      title: "Contacts (sales)",
      description:
        "List contacts of sales companies with role (main, reserve = backup, extra), tier, status, primary flag, phone, email, LinkedIn link and member id, attempts and callback date. Filter on status, role, company, the lead status of the company, has_phone, text (name or email) and linkedin_broken: Apify links (linkedin.com/in/ACwAA...) that were stored in lowercase before November 2026 and do not open. Repair those by giving the link again with its case (add_contact or upsert_companies with the Apify link, or update_contacts).",
      inputSchema: {
        status: z.array(contactStatus).max(9).optional(),
        role: contactRole.optional(),
        company_id: idSchema.optional(),
        company_lead_status: z.array(leadStatus).max(8).optional(),
        primary_only: z.boolean().optional(),
        has_phone: z.boolean().optional(),
        text: z.string().max(80).optional(),
        linkedin_broken: z.boolean().optional().describe("true: only contacts whose Apify LinkedIn link was lowercased and needs its case back."),
        limit: limitSchema,
        offset: offsetSchema,
      },
      annotations: READ_ONLY,
    },
    async (input) => {
      const pattern = searchPattern(input.text);
      let q = db
        .from("contacts")
        .select(
          "id, company_id, first_name, last_name, title, tier, role, is_primary, status, phone, email, email_status, linkedin_url, linkedin_member_urn, attempts, last_attempt_at, callback_at, assigned_caller_id, last_contacted_at, company:companies!contacts_company_id_fkey!inner(name, lead_status, pipeline_stage)",
          { count: "exact" },
        );
      if (input.status?.length) q = q.in("status", input.status);
      if (input.role) q = q.eq("role", input.role);
      if (input.company_id) q = q.eq("company_id", input.company_id);
      if (input.company_lead_status?.length) q = q.in("company.lead_status", input.company_lead_status);
      if (input.primary_only) q = q.eq("is_primary", true);
      if (input.has_phone === true) q = q.not("phone", "is", null);
      if (input.has_phone === false) q = q.is("phone", null);
      // like is case sensitive: a good Apify link starts with ACwAA, a broken one with acwaa.
      if (input.linkedin_broken) q = q.like("linkedin_url", "%/in/ac_aa%");
      if (pattern) q = q.or(`first_name.ilike.${pattern},last_name.ilike.${pattern},email.ilike.${pattern}`);
      const result = await q.order("created_at", { ascending: false }).range(input.offset, input.offset + input.limit - 1);
      const rows = check(result, "contacts");
      return ok({
        total: result.count,
        contacts: rows.map(({ company, ...c }) => ({
          ...c,
          name: name(c.first_name, c.last_name),
          company: company?.name ?? null,
          company_lead_status: company?.lead_status ?? null,
          company_pipeline_stage: company?.pipeline_stage ?? null,
          company_url: url("company", c.company_id),
        })),
      });
    },
  );

  // -------------------------------------------------------------------------
  server.registerTool(
    "list_meetings",
    {
      title: "Meetings",
      description:
        "Meetings from the Meetings register (planned, held, approved, rejected, no show, cancelled) with company, contact, caller, fee and the Cal.com booking id. Newest planned date first. Filter on status, a date window on the planned date, company or caller.",
      inputSchema: {
        status: z.array(meetingStatus).max(6).optional(),
        from: dateSchema.optional().describe("Planned on or after this date."),
        to: dateSchema.optional().describe("Planned before this date."),
        company_id: idSchema.optional(),
        caller_id: idSchema.optional(),
        limit: limitSchema,
        offset: offsetSchema,
      },
      annotations: READ_ONLY,
    },
    async (input) => {
      let q = db
        .from("meetings")
        .select(
          "id, status, scheduled_at, reason, fee, source, external_id, notes, decided_at, created_at, company_id, contact_id, caller_id, company:companies(name), contact:contacts(first_name, last_name), caller:callers(name)",
          { count: "exact" },
        );
      if (input.status?.length) q = q.in("status", input.status);
      if (input.from) q = q.gte("scheduled_at", input.from);
      if (input.to) q = q.lt("scheduled_at", input.to);
      if (input.company_id) q = q.eq("company_id", input.company_id);
      if (input.caller_id) q = q.eq("caller_id", input.caller_id);
      const result = await q
        .order("scheduled_at", { ascending: false, nullsFirst: false })
        .range(input.offset, input.offset + input.limit - 1);
      return ok({
        total: result.count,
        meetings: check(result, "meetings").map(({ company, contact, caller, ...m }) => ({
          ...m,
          notes: clip(m.notes, 500),
          company: company?.name ?? null,
          contact: contact ? name(contact.first_name, contact.last_name) : null,
          caller: caller?.name ?? null,
        })),
      });
    },
  );

  // -------------------------------------------------------------------------
  server.registerTool(
    "list_call_lists",
    {
      title: "Call lists",
      description:
        "Call lists (saved views of contacts) and for which callers each is open, until when and in which order. Also lists the callers with their status, for open_list_for_callers.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => {
      const [views, links, callers] = await Promise.all([
        db.from("sales_views").select("id, name, config, is_shared, position, owner_id, updated_at").eq("is_call_list", true).order("position"),
        db.from("call_list_callers").select("view_id, caller_id, position, open_until"),
        db.from("callers").select("id, name, email, party, status, fee_per_meeting").order("name"),
      ]);
      const callerRows = check(callers, "callers");
      const callerName = new Map(callerRows.map((c) => [c.id, c.name]));
      const linkRows = check(links, "call list callers");
      return ok({
        call_lists: check(views, "call lists").map((v) => ({
          id: v.id,
          name: v.name,
          filters: v.config,
          shared: v.is_shared,
          updated_at: v.updated_at,
          open_for: linkRows
            .filter((l) => l.view_id === v.id)
            .sort((a, b) => a.position - b.position)
            .map((l) => ({ caller_id: l.caller_id, caller: callerName.get(l.caller_id) ?? null, position: l.position, open_until: l.open_until })),
        })),
        callers: callerRows,
      });
    },
  );

  // -------------------------------------------------------------------------
  server.registerTool(
    "list_sequences",
    {
      title: "Sequences",
      description:
        "Sequences (steps over mail, LinkedIn and calls) with their status, number of steps, how many texts are approved, how many concepts wait for approval and how many companies are enrolled.",
      inputSchema: { status: sequenceStatus.optional().describe("Default: draft and active.") },
      annotations: READ_ONLY,
    },
    async ({ status }) => {
      let q = db.from("sequences").select("id, name, description, status, created_at, updated_at");
      q = status ? q.eq("status", status) : q.in("status", ["draft", "active"]);
      const sequences = check(await q.order("name"), "sequences");
      const ids = sequences.map((s) => s.id);
      const [steps, enrollments] = await Promise.all([
        ids.length
          ? db.from("sequence_steps").select("sequence_id, channel, approved_at, draft_body").in("sequence_id", ids)
          : Promise.resolve({ data: [], error: null }),
        ids.length
          ? db.from("sequence_enrollments").select("sequence_id, status").in("sequence_id", ids)
          : Promise.resolve({ data: [], error: null }),
      ]);
      const stepRows = check(steps, "steps") as { sequence_id: string; channel: string; approved_at: string | null; draft_body: string | null }[];
      const enrollmentRows = check(enrollments, "enrollments") as { sequence_id: string; status: string }[];
      return ok(
        sequences.map((s) => {
          const own = stepRows.filter((r) => r.sequence_id === s.id);
          const needsText = own.filter((r) => r.channel !== "call");
          const ownEnrollments = enrollmentRows.filter((e) => e.sequence_id === s.id);
          return {
            ...s,
            description: clip(s.description, 500),
            steps: own.length,
            texts_approved: needsText.filter((r) => r.approved_at).length,
            texts_to_approve: needsText.filter((r) => !r.approved_at).length,
            concepts_waiting: own.filter((r) => r.draft_body).length,
            ready_to_start: s.status === "active" && needsText.every((r) => r.approved_at),
            enrolled_active: ownEnrollments.filter((e) => e.status === "active").length,
            enrolled_paused: ownEnrollments.filter((e) => e.status === "paused").length,
            url: `${ctx.siteUrl.replace(/\/$/, "")}/dashboard/sequences/${s.id}`,
          };
        }),
      );
    },
  );

  // -------------------------------------------------------------------------
  server.registerTool(
    "get_sequence",
    {
      title: "Sequence",
      description:
        "One sequence with its steps in order (day offset, channel, approved subject and text, the concept waiting for approval) and its enrollments with the open step tasks. Only approved text may be sent.",
      inputSchema: { id: idSchema, enrollment_limit: z.number().int().min(1).max(200).default(50) },
      annotations: READ_ONLY,
    },
    async ({ id, enrollment_limit }) => {
      const sequence = check(
        await db.from("sequences").select("id, name, description, status, created_at, updated_at").eq("id", id).maybeSingle(),
        "sequence",
      );
      if (!sequence || Array.isArray(sequence)) return fail("Sequence not found.");
      const [steps, enrollments] = await Promise.all([
        db
          .from("sequence_steps")
          .select("id, position, day_offset, channel, subject, body, draft_subject, draft_body, draft_source, draft_at, approved_at, approved_by")
          .eq("sequence_id", id)
          .order("position"),
        db
          .from("sequence_enrollments")
          .select("id, status, started_at, paused_at, pause_reason, source, company_id, contact_id, company:companies(name), contact:contacts(first_name, last_name, email, linkedin_url)")
          .eq("sequence_id", id)
          .order("started_at", { ascending: false })
          .limit(enrollment_limit),
      ]);
      const enrollmentRows = check(enrollments, "enrollments");
      const tasks = enrollmentRows.length
        ? check(
            await db
              .from("sequence_tasks")
              .select("id, enrollment_id, step_id, channel, due_date, status, external_id")
              .in("enrollment_id", enrollmentRows.map((e) => e.id))
              .order("due_date"),
            "step tasks",
          )
        : [];
      return ok({
        ...sequence,
        steps: check(steps, "steps"),
        enrollments: enrollmentRows.map(({ company, contact, ...e }) => ({
          ...e,
          company: company?.name ?? null,
          contact: contact ? { name: name(contact.first_name, contact.last_name), email: contact.email, linkedin_url: contact.linkedin_url } : null,
          tasks: tasks.filter((t) => t.enrollment_id === e.id),
        })),
      });
    },
  );

  // -------------------------------------------------------------------------
  server.registerTool(
    "list_sequence_tasks",
    {
      title: "Sequence step tasks",
      description:
        "Open step tasks of running sequences, earliest due date first, with the approved subject and text of the step, the company and the contact (email, LinkedIn). Use it to prepare mail steps in Instantly and LinkedIn steps in Seleqt, then mark them with update_sequence_tasks. Tasks of paused or stopped enrollments are left out.",
      inputSchema: {
        channel: z.enum(["mail", "linkedin", "call"]).optional(),
        due_until: dateSchema.optional().describe("Due on or before this date (default: today)."),
        sequence_id: idSchema.optional(),
        status: z.enum(["open", "done", "skipped", "cancelled"]).default("open"),
        limit: limitSchema,
        offset: offsetSchema,
      },
      annotations: READ_ONLY,
    },
    async ({ channel, due_until, sequence_id, status, limit, offset }) => {
      const until = due_until ?? new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Amsterdam" }).format(new Date());
      let q = db
        .from("sequence_tasks")
        .select(
          "id, channel, due_date, status, external_id, company_id, contact_id, enrollment:sequence_enrollments!inner(id, status, sequence_id, sequence:sequences(name)), step:sequence_steps(id, position, day_offset, subject, body, approved_at), company:companies(name, domain, opening_line), contact:contacts(first_name, last_name, title, email, linkedin_url)",
          { count: "exact" },
        )
        .eq("status", status)
        .lte("due_date", until);
      if (status === "open") q = q.eq("enrollment.status", "active");
      if (channel) q = q.eq("channel", channel);
      if (sequence_id) q = q.eq("enrollment.sequence_id", sequence_id);
      const result = await q.order("due_date").range(offset, offset + limit - 1);
      return ok({
        total: result.count,
        tasks: check(result, "step tasks").map(({ enrollment, step, company, contact, ...t }) => ({
          ...t,
          enrollment_id: enrollment?.id ?? null,
          sequence: enrollment?.sequence?.name ?? null,
          step: step
            ? { id: step.id, position: step.position, day: step.day_offset, subject: step.subject, body: step.approved_at ? step.body : null, approved: Boolean(step.approved_at) }
            : null,
          company: company ? { name: company.name, domain: company.domain, opening_line: company.opening_line } : null,
          contact: contact
            ? { name: name(contact.first_name, contact.last_name), title: contact.title, email: contact.email, linkedin_url: contact.linkedin_url }
            : null,
        })),
      });
    },
  );

  // -------------------------------------------------------------------------
  server.registerTool(
    "list_replies_to_review",
    {
      title: "Replies to review",
      description:
        "Replies that wait for Julius (review_status pending), oldest first, with company, contact, channel, source, the text and the suggestion Claude gave.",
      inputSchema: { limit: limitSchema, offset: offsetSchema },
      annotations: READ_ONLY,
    },
    async ({ limit, offset }) => {
      const result = await db
        .from("activities")
        .select(
          "id, date, channel, source, outcome, notes, external_id, suggestion, company_id, contact_id, company:companies(name, lead_status, pipeline_stage), contact:contacts(first_name, last_name, email)",
          { count: "exact" },
        )
        .eq("review_status", "pending")
        .order("date", { ascending: true })
        .range(offset, offset + limit - 1);
      return ok({
        total: result.count,
        replies: check(result, "replies").map(({ company, contact, ...r }) => ({
          ...r,
          notes: clip(r.notes, 2000),
          company: company?.name ?? null,
          company_lead_status: company?.lead_status ?? null,
          company_pipeline_stage: company?.pipeline_stage ?? null,
          contact: contact ? name(contact.first_name, contact.last_name) : null,
          contact_email: contact?.email ?? null,
        })),
      });
    },
  );

  // -------------------------------------------------------------------------
  server.registerTool(
    "sales_stats",
    {
      title: "Sales figures",
      description:
        "Answers questions about the sales data: companies per lead status and per pipeline stage (now), and for a period the calls, reached, mails, LinkedIn messages, replies, meetings planned, held, approved, rejected and no show, fees, companies into the pipeline, won and lost, and the same per caller. Calls are phone contacts in Activities; reached means someone picked up.",
      inputSchema: {
        period: z
          .enum(["this_week", "last_week", "last_30_days", "custom"])
          .default("this_week")
          .describe("Weeks start on Monday in Amsterdam. custom needs from and to."),
        from: dateSchema.optional(),
        to: dateSchema.optional().describe("Exclusive end date."),
      },
      annotations: READ_ONLY,
    },
    async ({ period, from, to }) => {
      let range: { from: string; to: string };
      if (period === "custom") {
        if (!from || !to) return fail("Give from and to with period custom.");
        if (from >= to) return fail("from must be before to.");
        range = { from: amsterdamMidnight(from).toISOString(), to: amsterdamMidnight(to).toISOString() };
      } else {
        range = periodRange(period === "this_week" ? "deze-week" : period === "last_week" ? "vorige-week" : "30-dagen");
      }
      const [figures, statuses] = await Promise.all([
        loadSalesFigures(db, range, { perCaller: true }),
        allLeadStatuses(db),
      ]);
      return ok({
        period: range,
        companies_per_lead_status: countLeadStatuses(statuses).map((s) => ({ lead_status: s.status, label: s.label, count: s.count })),
        pipeline: figures.pipeline,
        activity: figures.activity,
        meetings: figures.meetings,
        per_caller: figures.perCaller,
        replies_to_review: figures.repliesToReview,
      });
    },
  );

  // -------------------------------------------------------------------------
  server.registerTool(
    "list_job_runs",
    {
      title: "Job runs",
      description:
        "Runs of the portal jobs and of Claude's scheduled tasks (job_runs), newest first, with status, records in and out, error and meta. Filter on job_name (exact or a prefix ending in *, e.g. claude-*), triggered_by (claude for Claude's tasks) and status.",
      inputSchema: {
        job_name: z.string().max(80).regex(/^[a-z0-9-]+\*?$/).optional(),
        triggered_by: z.string().max(80).optional(),
        status: z.enum(["running", "success", "failed"]).optional(),
        limit: limitSchema,
      },
      annotations: READ_ONLY,
    },
    async ({ job_name, triggered_by, status, limit }) => {
      let q = db
        .from("job_runs")
        .select("id, job_name, status, started_at, finished_at, records_in, records_out, error, meta, triggered_by")
        .order("started_at", { ascending: false })
        .limit(Math.min(MAX_RUNS, limit * 3));
      if (job_name?.endsWith("*")) q = q.like("job_name", `${job_name.slice(0, -1)}%`);
      else if (job_name) q = q.eq("job_name", job_name);
      if (triggered_by) q = q.eq("triggered_by", triggered_by);
      if (status) q = q.eq("status", status);
      const modules = effectiveModules(ctx.role, ctx.modules);
      const runs = check(await q, "job runs")
        .filter((r) => {
          const mod = jobModule(r.job_name);
          return mod === null || modules.includes(mod);
        })
        .slice(0, limit);
      return ok(runs.map((r) => ({ ...r, error: clip(r.error, 1000), meta: compactMeta(r.meta) })));
    },
  );
}

const MAX_RUNS = 300;

/** Meta without the long log, which stays on the Jobs page. */
function compactMeta(meta: Json): Json {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return meta;
  const { log, ...rest } = meta as Record<string, Json>;
  return { ...rest, ...(Array.isArray(log) ? { log_lines: log.length } : {}) };
}

async function allLeadStatuses(db: McpDb): Promise<{ lead_status: LeadStatus }[]> {
  const rows: { lead_status: LeadStatus }[] = [];
  for (let from = 0; from < 50_000; from += 1000) {
    const page = check(await db.from("companies").select("lead_status").order("id").range(from, from + 999), "companies");
    rows.push(...page);
    if (page.length < 1000) break;
  }
  return rows;
}

async function peopleNames(db: McpDb, ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return new Map();
  const { data } = await db.from("profiles").select("id, full_name, email").in("id", unique);
  return new Map((data ?? []).map((p) => [p.id, p.full_name || p.email || "Team member"]));
}

async function partnerNames(db: McpDb, ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return new Map();
  const { data } = await db.from("partners").select("id, name").in("id", unique);
  return new Map((data ?? []).map((p) => [p.id, p.name]));
}

// ---------------------------------------------------------------------------
// Write tools
// ---------------------------------------------------------------------------

export const companyFieldsSchema = z
  .object({
    lead_status: leadStatus.optional(),
    pipeline_stage: pipelineStage.nullable().optional().describe("null takes the company out of the pipeline."),
    lost_reason: z.string().trim().min(1).max(2000).optional().describe("Required with pipeline_stage lost."),
    parked_until: dateSchema.optional().describe("Required with pipeline_stage parked: the day to get in touch again."),
    profiles_due_on: dateSchema.nullable().optional().describe("The day the profiles go out (stage agreed_paid sets it three weeks ahead)."),
    prio: z.number().int().min(1).max(5).nullable().optional(),
    category: category.nullable().optional(),
    owner_id: idSchema.nullable().optional().describe("A team member (profile id)."),
    partner_id: idSchema.nullable().optional(),
    next_action: z.string().trim().max(500).nullable().optional(),
    next_action_date: dateSchema.nullable().optional(),
    pinned: z.boolean().optional().describe("Pin to the top of the lists, or unpin."),
    manual_position: z.number().nullable().optional().describe("Manual order in the lists (lower is higher)."),
    opening_line: z.string().trim().max(2000).nullable().optional().describe("Opening line for calls and mail."),
    red_flags: z.array(z.string().trim().min(1).max(300)).max(30).optional().describe("Red flags, one per item (replaces the list)."),
    general_phone: z.string().trim().max(50).nullable().optional().describe("The general (reception) number of the company."),
    description: z.string().trim().max(5000).nullable().optional().describe("What they do."),
    linkedin_url: z.string().trim().max(500).nullable().optional().describe("Company LinkedIn page; stored with https://."),
  })
  .strict()
  .refine((f) => Object.keys(f).length > 0, { message: "Give at least one field to change." })
  .refine((f) => f.pipeline_stage !== "lost" || Boolean(f.lost_reason), {
    message: "A company moved to lost needs a lost_reason.",
    path: ["lost_reason"],
  })
  .refine((f) => f.pipeline_stage !== "parked" || Boolean(f.parked_until), {
    message: "A parked company needs parked_until, the day to get in touch again.",
    path: ["parked_until"],
  });

/** The p_fields of sales_update for a company. Pure, unit tested. */
export function companyPatch(fields: z.infer<typeof companyFieldsSchema>, now = new Date()): Record<string, Json> {
  const patch: Record<string, Json> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (key === "pinned") patch.pinned_at = value ? now.toISOString() : null;
    else if (key === "linkedin_url") patch.linkedin_url = cleanLinkedinUrl(value as string | null);
    else if (key === "general_phone" && typeof value === "string") patch.general_phone = normalizePhone(value) ?? value;
    else patch[key] = value as Json;
  }
  return patch;
}

const contactFieldsSchema = z
  .object({
    status: contactStatus.optional(),
    role: contactRoleInput.optional().describe("main (one per company; the old main becomes backup), backup or extra."),
    tier: tierInput.nullable().optional(),
    is_primary: z.boolean().optional().describe("Only for one contact at a time; the primary contact is the main contact."),
    title: z.string().trim().max(200).nullable().optional(),
    phone: z.string().trim().max(50).nullable().optional(),
    email: z.email().max(320).nullable().optional(),
    linkedin_url: z.string().trim().max(500).nullable().optional().describe("Profile link, stored exactly as given (case kept) with https://."),
    linkedin_member_urn: z.string().trim().max(200).optional().describe("The LinkedIn member id (ACwAA...) of an Apify link, next to the normal profile link."),
    callback_at: dateSchema.nullable().optional(),
    assigned_caller_id: idSchema.nullable().optional(),
    assigned_until: dateSchema.nullable().optional(),
    caller_note: z.string().trim().max(5000).nullable().optional(),
  })
  .strict()
  .refine((f) => Object.keys(f).length > 0, { message: "Give at least one field to change." });

const signalSchema = z.object({
  title: z.string().trim().min(1).max(300).describe("Job title of the vacancy."),
  type: z.enum(["vacature", "lang_open", "meerdere_rollen", "remote_extern", "freelance", "funding", "nieuwe_cto", "overig"]).default("vacature"),
  role_group: z.string().trim().max(200).optional().describe("For example Backend, Frontend, Data & BI, DevOps."),
  posted_at: dateSchema.optional().describe("Date the vacancy went online on the job board (the days open count from here)."),
  // A plain string: a link without https:// (nl.indeed.com/viewjob?jk=...) used to fail the whole call.
  source_url: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .describe("Link to the vacancy itself (Indeed viewjob?jk=..., LinkedIn jobs/view/..., the company site). Every vacancy its own link."),
  description: z.string().trim().max(20000).optional().describe("The vacancy text."),
  closed: z.boolean().optional().describe("true: the vacancy is offline."),
});

const personSchema = z.object({
  first_name: z.string().trim().max(100).optional(),
  last_name: z.string().trim().max(100).optional(),
  full_name: z.string().trim().max(200).optional(),
  title: z.string().trim().max(200).optional(),
  linkedin_url: z.string().trim().max(500).optional().describe("Profile link, kept exactly as given (case matters for Apify links)."),
  linkedin_member_urn: z.string().trim().max(200).optional().describe("LinkedIn member id (ACwAA...) when you also have the normal profile link."),
  email: z.email().max(320).optional(),
  phone: z.string().trim().max(50).optional(),
  role: contactRoleInput.optional(),
  tier: tierInput.optional().describe("Leave out to take it from the job title."),
});

export const upsertCompanySchema = z.object({
  name: z.string().trim().min(1).max(200),
  domain: z.string().trim().max(300).optional().describe("Website or domain; the main key."),
  linkedin_url: z.string().trim().max(500).optional().describe("Company LinkedIn page; the key when there is no domain."),
  city: z.string().trim().max(200).optional(),
  sector: z.string().trim().max(200).optional(),
  employees: z.number().int().min(0).max(1_000_000).optional(),
  description: z.string().trim().max(5000).optional().describe("What they do. Put the opening line, red flags and general number in their own fields."),
  opening_line: z.string().trim().max(2000).optional().describe("Opening line for calls and mail."),
  red_flags: z.array(z.string().trim().min(1).max(300)).max(30).optional().describe("Red flags, one per item."),
  general_phone: z.string().trim().max(50).optional().describe("The general (reception) number."),
  signals: z.array(signalSchema).max(50).default([]),
  contacts: z
    .array(personSchema)
    .max(20)
    .default([])
    .describe("Decision makers, best first: the first without a role becomes main, the next backup, the rest extra."),
});

/**
 * Why a company cannot be added, or null. Checked per company, so one
 * company without a website or LinkedIn page no longer rejects the batch.
 */
export function companyKeyError(input: { domain?: string; linkedin_url?: string }): string | null {
  if (normalizeDomain(input.domain) || normalizeLinkedin(input.linkedin_url)) return null;
  return "No website or company LinkedIn page: give one of the two, so the company can be matched. Not saved.";
}

function registerSalesWriteTools(server: McpServer, ctx: McpToolContext) {
  const { db } = ctx;
  const actor = ctx.userId;
  const denied = () => fail("This token can only read. Create a token with write access under Settings.");
  const guard = () => (ctx.access !== "write" ? denied() : hasSales(ctx) ? null : fail(accessError(["sales"])));

  // -------------------------------------------------------------------------
  server.registerTool(
    "update_companies",
    {
      title: "Update companies",
      description:
        "Change opening line, red flags, general number, what they do (description), company LinkedIn page, lead status, pipeline stage (contact, interested, meeting_planned, meeting_held, vacancy_drafted, agreed_paid, profiles_sent, candidate_interviews, won; or off it: lost needs lost_reason, parked needs parked_until), the date to send profiles (profiles_due_on), prio, category, owner, partner, next action, pin or manual position of one or more companies. Goes through sales_update: every change is logged in Activities with you and source claude. Only call when the user or a scheduled task asked for it.",
      inputSchema: { ids: idsSchema, fields: companyFieldsSchema },
      annotations: WRITE,
    },
    async ({ ids, fields }) => {
      const blocked = guard();
      if (blocked) return blocked;
      const { data, error } = await db.rpc("sales_update", {
        p_entity: "company",
        p_ids: [...new Set(ids)],
        p_fields: companyPatch(fields),
        p_source: "claude",
        p_actor: actor,
      });
      return rpcError(error, "update the companies") ?? ok({ updated: data ?? 0, requested: new Set(ids).size });
    },
  );

  // -------------------------------------------------------------------------
  server.registerTool(
    "update_contacts",
    {
      title: "Update contacts",
      description:
        "Change status, role, primary flag, title, phone, email, LinkedIn, callback date, assigned caller or caller note of one or more contacts. Goes through sales_update with source claude.",
      inputSchema: { ids: idsSchema, fields: contactFieldsSchema },
      annotations: WRITE,
    },
    async ({ ids, fields }) => {
      const blocked = guard();
      if (blocked) return blocked;
      const unique = [...new Set(ids)];
      if (fields.is_primary !== undefined && unique.length > 1) return fail("Set is_primary on one contact at a time.");
      if (fields.linkedin_url && unique.length > 1) return fail("Set linkedin_url on one contact at a time.");
      if (fields.linkedin_member_urn && unique.length > 1) return fail("Set linkedin_member_urn on one contact at a time.");
      if (fields.role === "main" && unique.length > 1) return fail("A company has one main contact: set role main on one contact at a time.");
      const { linkedin_member_urn: urn, ...rest } = fields;
      const patch: Record<string, Json> = {};
      for (const [key, value] of Object.entries(rest)) if (value !== undefined) patch[key] = value as Json;
      if (typeof patch.phone === "string") patch.phone = normalizePhone(patch.phone) ?? patch.phone;
      if (typeof patch.email === "string") patch.email = normalizeEmail(patch.email) ?? patch.email;
      // Kept exactly (case of the path), with https://; never lowercased.
      if (typeof patch.linkedin_url === "string") patch.linkedin_url = cleanLinkedinUrl(patch.linkedin_url);
      let updated = 0;
      if (Object.keys(patch).length > 0) {
        const { data, error } = await db.rpc("sales_update", {
          p_entity: "contact",
          p_ids: unique,
          p_fields: patch,
          p_source: "claude",
          p_actor: actor,
        });
        const failed = rpcError(error, "update the contacts");
        if (failed) return /linkedin_key/.test(error?.message ?? "") ? fail("Another contact already has this LinkedIn profile. Merge the two with merge_contacts.") : failed;
        updated = data ?? 0;
      }
      if (urn) {
        const { error } = await db.rpc("sales_set_contact_linkedin", { p_contact: unique[0], p_member_urn: urn, p_source: "claude", p_actor: actor });
        if (error) {
          return fail(
            /linkedin_member_urn/.test(error.message)
              ? "Another contact already has this LinkedIn member id. Merge the two with merge_contacts."
              : `Could not save the LinkedIn member id: ${error.message}`,
          );
        }
        updated = Math.max(updated, 1);
      }
      return ok({ updated, requested: unique.length });
    },
  );

  // -------------------------------------------------------------------------
  server.registerTool(
    "log_activity",
    {
      title: "Log activity",
      description:
        "Log a contact moment or reply in Activities: a reply fetched from Instantly (source instantly) or Seleqt (source seleqt), a LinkedIn message, a call made elsewhere, a note. Give external_id for anything from another system: the same id twice is stored once. A reply pauses the company everywhere (its sequences pause, open call steps go). Mark a doubtful reply with review true and a suggestion; it then waits under Replies to review and only counts once accepted.",
      inputSchema: {
        company_id: idSchema.optional(),
        contact_id: idSchema.optional(),
        partner_id: idSchema.optional().describe("A contact moment with a partner."),
        channel: z.enum(["bellen", "mail", "linkedin", "meeting"]),
        type: z.enum(["contact", "reply", "note", "meeting"]).default("contact"),
        outcome: activityOutcome.optional(),
        direction: z.enum(["inbound", "outbound"]).optional(),
        notes: z.string().trim().max(5000).optional().describe("The text of the reply or message."),
        date: dateTimeSchema.optional(),
        source: z.enum(["claude", "instantly", "seleqt", "calcom", "apify", "prospeo"]).default("claude"),
        external_id: z.string().trim().min(1).max(300).optional(),
        review: z.boolean().default(false),
        suggestion: z
          .object({
            classification: z.string().max(100).optional().describe("For example interested, not now, not interested, out of office, wrong person."),
            outcome: z.enum(["reply_positief", "reply_neutraal", "reply_negatief", "afgemeld"]).optional(),
            lead_status: leadStatus.optional(),
            pipeline_stage: pipelineStage.exclude(["parked"]).optional(),
            lost_reason: z.string().max(2000).optional(),
            contact_status: contactStatus.optional(),
            reason: z.string().max(2000).optional().describe("Why, in one or two sentences."),
          })
          .strict()
          .optional(),
      },
      annotations: WRITE,
    },
    async (input) => {
      const blocked = guard();
      if (blocked) return blocked;
      if (!input.company_id && !input.contact_id && !input.partner_id) return fail("Give company_id, contact_id or partner_id.");
      if (input.suggestion && !input.review) return fail("A suggestion goes with review true.");
      if (input.review && input.type !== "reply") return fail("Only a reply can wait for review (type reply).");
      const { data, error } = await db.rpc("sales_log_activity", {
        p_company: input.company_id ?? null,
        p_contact: input.contact_id ?? null,
        p_partner: input.partner_id ?? null,
        p_channel: input.channel,
        p_type: input.type,
        p_outcome: input.outcome ?? null,
        p_notes: input.notes ?? null,
        p_direction: input.direction ?? (input.type === "reply" ? "inbound" : null),
        p_date: input.date ?? null,
        p_source: input.source,
        p_external_id: input.external_id ?? null,
        p_review: input.review,
        p_suggestion: (input.suggestion ?? null) as Json | null,
        p_actor: actor,
      });
      const err = rpcError(error, "log the activity");
      if (err) return err;
      return ok(data ? { activity_id: data, stored: true, review: input.review } : { stored: false, duplicate: true, external_id: input.external_id });
    },
  );

  // -------------------------------------------------------------------------
  server.registerTool(
    "create_meeting",
    {
      title: "Create meeting",
      description:
        "Save a meeting in the Meetings register, for example a Cal.com booking. With external_id (the booking uid) the same booking twice is a no-op, and a planned meeting of the same company from the call screen in the last 14 days is filled in instead of duplicated. Moves the company to Meeting planned.",
      inputSchema: {
        company_id: idSchema.optional(),
        contact_id: idSchema.optional(),
        scheduled_at: dateTimeSchema,
        reason: z.string().trim().max(2000).optional(),
        external_id: z.string().trim().min(1).max(300).describe("The Cal.com booking uid."),
        caller_id: idSchema.optional().describe("The caller who booked it, when known."),
        source: z.enum(["calcom", "claude"]).default("calcom"),
      },
      annotations: WRITE,
    },
    async (input) => {
      const blocked = guard();
      if (blocked) return blocked;
      if (!input.company_id && !input.contact_id) return fail("Give company_id or contact_id.");
      const { data: existing } = await db.from("meetings").select("id").eq("external_id", input.external_id).maybeSingle();
      const { data, error } = await db.rpc("sales_save_meeting", {
        p_company: input.company_id ?? null,
        p_contact: input.contact_id ?? null,
        p_caller: input.caller_id ?? null,
        p_scheduled_at: input.scheduled_at,
        p_reason: input.reason ?? null,
        p_external_id: input.external_id,
        p_source: input.source,
        p_actor: actor,
      });
      return rpcError(error, "save the meeting") ?? ok({ meeting_id: data, already_known: Boolean(existing) });
    },
  );

  // -------------------------------------------------------------------------
  server.registerTool(
    "update_meeting",
    {
      title: "Update meeting",
      description:
        "After the call: set a meeting to held, approved, rejected, no_show or cancelled (or back to planned), with a reason or note, and/or fill in or change its fee. Approving, rejecting and the fee are for admins, as in the portal. The company moves along to the right stage like in the portal, and everything lands in Activities with you and source claude. See list_meetings for ids.",
      inputSchema: {
        meeting_id: idSchema,
        status: meetingStatus.optional(),
        fee: z.number().min(0).max(10_000).optional().describe("What the caller earns for this meeting, in euro."),
        note: z.string().trim().max(2000).optional().describe("Reason or note, for example why it was rejected."),
      },
      annotations: { ...WRITE, idempotentHint: true },
    },
    async (input) => {
      const blocked = guard();
      if (blocked) return blocked;
      if (input.status === undefined && input.fee === undefined && !input.note) return fail("Give a status, a fee or a note.");
      const { data, error } = await db.rpc("sales_update_meeting", {
        p_meeting: input.meeting_id,
        p_status: input.status ?? null,
        p_fee: input.fee ?? null,
        p_note: input.note ?? null,
        p_actor: actor,
      });
      if (error) return fail(`Could not update the meeting: ${error.message}`);
      const row = data as unknown as { id: string; status: string; fee: number; company_id: string; notes: string | null } | null;
      return ok({ meeting: row ? { id: row.id, status: row.status, fee: row.fee, notes: row.notes } : null, company_url: row ? recordUrl(ctx.siteUrl, "company", row.company_id) : null });
    },
  );

  // -------------------------------------------------------------------------
  server.registerTool(
    "add_company",
    {
      title: "Add company (lead)",
      description:
        "Add one company that did not come from Apify or Prospeo: an inbound lead, a LinkedIn contact, a tip from a partner or someone from the network. Say where it came from (origin) and why (source_note). Fill opening_line, red_flags and general_phone in their own fields, not in the description. Matched on the normalized domain (also the domains of merged companies), then on the company LinkedIn page: a known company is filled in, never overwritten, and not added twice. The answer lists possible_duplicates (a company with the same or a similar name on another domain): check them and merge with merge_companies when they are the same. Contacts can come along with role (main, backup, extra) and tier. Starts as lead status new.",
      inputSchema: {
        origin: z.enum(LEAD_ORIGINS).describe("Where the lead came from."),
        source_note: z.string().trim().max(2000).optional().describe("Who referred it, which post, what was said."),
        partner_id: idSchema.optional().describe("The partner who brought it (origin partner)."),
        company: upsertCompanySchema,
      },
      annotations: WRITE,
    },
    async ({ origin, source_note, partner_id, company }) => {
      const blocked = guard();
      if (blocked) return blocked;
      const keyError = companyKeyError(company);
      if (keyError) return fail(`${company.name}: ${keyError}`);
      if (partner_id) {
        const { data: partner } = await db.from("partners").select("id").eq("id", partner_id).maybeSingle();
        if (!partner) return fail("Partner not found.");
      }
      try {
        const result = await upsertSalesCompany(db, actor, origin, company);
        // Origin, note and partner: on a new company, or filled in where empty.
        const { data: row } = await db.from("companies").select("source, source_note, partner_id").eq("id", result.company_id).single();
        const patch: Record<string, Json> = {};
        if (source_note && !row?.source_note) patch.source_note = source_note;
        if (partner_id && !row?.partner_id) patch.partner_id = partner_id;
        if (Object.keys(patch).length) {
          const { error } = await db.rpc("sales_update", { p_entity: "company", p_ids: [result.company_id], p_fields: patch, p_source: "claude", p_actor: actor });
          if (error) return fail(`The company is saved, but not the note or partner: ${error.message}`);
        }
        return ok({ ...result, origin, url: recordUrl(ctx.siteUrl, "company", result.company_id) });
      } catch (error) {
        return fail(error instanceof Error ? error.message : String(error));
      }
    },
  );

  // -------------------------------------------------------------------------
  server.registerTool(
    "add_contact",
    {
      title: "Add contact to a company",
      description:
        "Add a contact person to a company that is already in the portal, with name, title, tier, email, phone, LinkedIn, role (main, backup, extra) and whether they are the primary contact. One main contact per company: a second main becomes backup unless is_primary is true. Without a tier the tier comes from the job title. The same person is not added twice: the same LinkedIn link (any case), the same LinkedIn member id (Apify ACwAA... link) anywhere, or the same email or name at this company, is filled in instead (never overwritten). Logged in Activities with you and source claude.",
      inputSchema: {
        company_id: idSchema,
        first_name: z.string().trim().max(100).optional(),
        last_name: z.string().trim().max(150).optional(),
        full_name: z.string().trim().max(200).optional().describe("Instead of first and last name."),
        title: z.string().trim().max(200).optional(),
        email: z.email().max(320).optional(),
        phone: z.string().trim().max(50).optional(),
        linkedin_url: z.string().trim().max(500).optional().describe("Profile link, kept exactly as given."),
        linkedin_member_urn: z.string().trim().max(200).optional().describe("LinkedIn member id (ACwAA...) next to the normal profile link."),
        role: contactRoleInput.optional(),
        tier: tierInput.optional(),
        is_primary: z.boolean().optional(),
        origin: z.enum(LEAD_ORIGINS).optional().describe("Where this contact came from."),
      },
      annotations: WRITE,
    },
    async (input) => {
      const blocked = guard();
      if (blocked) return blocked;
      const result = await addSalesContact(db, actor, input);
      if ("error" in result) return fail(result.error);
      return ok({ ...result, url: recordUrl(ctx.siteUrl, "company", input.company_id) });
    },
  );

  // -------------------------------------------------------------------------
  server.registerTool(
    "open_list_for_callers",
    {
      title: "Open call list for callers",
      description:
        "Admins only: open a call list for one or more external callers until a date, with a position (which list a caller works through first, 0 is first).",
      inputSchema: {
        view_id: idSchema.describe("The call list (see list_call_lists)."),
        caller_ids: z.array(idSchema).min(1).max(50),
        open_until: dateSchema.optional(),
        position: z.number().int().min(0).max(1000).default(0),
      },
      annotations: WRITE,
    },
    async (input) => {
      const blocked = guard();
      if (blocked) return blocked;
      if (ctx.role !== "admin") return fail("Only an admin can open call lists for callers.");
      const view = check(await db.from("sales_views").select("id, is_call_list").eq("id", input.view_id).maybeSingle(), "call list");
      if (!view || Array.isArray(view) || !view.is_call_list) return fail("Call list not found.");
      const callers = check(await db.from("callers").select("id, status").in("id", input.caller_ids), "callers");
      const active = callers.filter((c) => c.status === "active").map((c) => c.id);
      const skipped = input.caller_ids.filter((id) => !active.includes(id));
      if (active.length === 0) return fail("None of these callers is active.");
      const { error } = await db.from("call_list_callers").upsert(
        active.map((caller_id) => ({
          view_id: input.view_id,
          caller_id,
          position: input.position,
          open_until: input.open_until ?? null,
          opened_by: actor,
        })),
        { onConflict: "view_id,caller_id" },
      );
      return rpcError(error, "open the call list") ?? ok({ opened_for: active, skipped_not_active: skipped });
    },
  );

  // -------------------------------------------------------------------------
  server.registerTool(
    "close_list_for_callers",
    {
      title: "Close call list for callers",
      description: "Admins only: close a call list for some callers, or for every caller when caller_ids is left out.",
      inputSchema: { view_id: idSchema, caller_ids: z.array(idSchema).min(1).max(50).optional() },
      annotations: { ...WRITE, destructiveHint: true },
    },
    async ({ view_id, caller_ids }) => {
      const blocked = guard();
      if (blocked) return blocked;
      if (ctx.role !== "admin") return fail("Only an admin can close call lists for callers.");
      let q = db.from("call_list_callers").delete().eq("view_id", view_id);
      if (caller_ids) q = q.in("caller_id", caller_ids);
      const { data, error } = await q.select("caller_id");
      return rpcError(error, "close the call list") ?? ok({ closed_for: (data ?? []).map((r) => r.caller_id) });
    },
  );

  // -------------------------------------------------------------------------
  server.registerTool(
    "upsert_companies",
    {
      title: "Add companies and vacancies",
      description:
        "Add new companies with their vacancies (signals) and decision makers from Apify or Prospeo. Companies are matched on the normalized domain (also the domains of merged companies), then on the company LinkedIn URL: a known company is filled in (never overwritten) and a vacancy seen again only updates its last seen date. Give every vacancy its own link (source_url, e.g. nl.indeed.com/viewjob?jk=...), its posted_at and its text (description). A company without website and LinkedIn page, or a vacancy with a link that is not a web address, is reported in results with the reason; the rest is saved. New companies start as lead status new; possible_duplicates lists companies with a similar name on another domain. At most 50 per call.",
      inputSchema: {
        source: z.enum(["apify", "prospeo"]),
        companies: z.array(upsertCompanySchema).min(1).max(50),
      },
      annotations: WRITE,
    },
    async ({ source, companies }) => {
      const blocked = guard();
      if (blocked) return blocked;
      const results = [];
      for (const input of companies) {
        const keyError = companyKeyError(input);
        if (keyError) {
          results.push({ name: input.name, error: keyError });
          continue;
        }
        try {
          results.push(await upsertSalesCompany(db, actor, source, input));
        } catch (error) {
          results.push({ name: input.name, error: `Not saved: ${error instanceof Error ? error.message : String(error)}` });
        }
      }
      const signalErrors = results.reduce((n, r) => n + ("signals_failed" in r ? (r.signals_failed?.length ?? 0) : 0), 0);
      return ok({
        created: results.filter((r) => "created" in r && r.created).length,
        matched: results.filter((r) => "created" in r && !r.created).length,
        failed: results.filter((r) => "error" in r).length,
        vacancies_not_saved: signalErrors,
        results,
      });
    },
  );

  // -------------------------------------------------------------------------
  server.registerTool(
    "merge_companies",
    {
      title: "Merge two companies",
      description:
        "Merge a duplicate company (merge_id) into the company that stays (keep_id), for example the same company added on its .nl and its .com domain. Nothing is lost: contacts, activities, vacancies, meetings, sequences, call steps, notes, tasks and attachments move to keep_id, empty fields of keep_id are filled from merge_id, the domain of merge_id is kept as an alias so it is not added again, and the full old record is logged in Activities. merge_id is then deleted. Only when the user asked for it or both are clearly the same company.",
      inputSchema: { keep_id: idSchema, merge_id: idSchema },
      annotations: { ...WRITE, destructiveHint: true },
    },
    async ({ keep_id, merge_id }) => {
      const blocked = guard();
      if (blocked) return blocked;
      const { data, error } = await db.rpc("sales_merge_companies", { p_keep: keep_id, p_merge: merge_id, p_source: "claude", p_actor: actor });
      return rpcError(error, "merge the companies") ?? ok({ ...(data as Record<string, Json>), url: recordUrl(ctx.siteUrl, "company", keep_id) });
    },
  );

  // -------------------------------------------------------------------------
  server.registerTool(
    "merge_contacts",
    {
      title: "Merge two contacts",
      description:
        "Merge a duplicate contact (merge_id) into the contact that stays (keep_id), for example the same person once with an Apify link and once with a normal profile link. Activities, meetings, sequences, call steps and suppressions move to keep_id; empty fields are filled (both LinkedIn link and member id are kept), attempts and dates take the highest, Do not contact wins. merge_id is deleted and logged in Activities.",
      inputSchema: { keep_id: idSchema, merge_id: idSchema },
      annotations: { ...WRITE, destructiveHint: true },
    },
    async ({ keep_id, merge_id }) => {
      const blocked = guard();
      if (blocked) return blocked;
      const { data, error } = await db.rpc("sales_merge_contacts", { p_keep: keep_id, p_merge: merge_id, p_source: "claude", p_actor: actor });
      return rpcError(error, "merge the contacts") ?? ok(data);
    },
  );

  // -------------------------------------------------------------------------
  server.registerTool(
    "update_signals",
    {
      title: "Update vacancies (signals)",
      description:
        "Correct vacancies (signals) of a company: the date it went online (posted_at, the days open count from here), the link to the vacancy, its text, or closed (offline). Use get_company for the ids.",
      inputSchema: {
        ids: z.array(idSchema).min(1).max(100),
        fields: z
          .object({
            posted_at: dateSchema.nullable().optional(),
            source_url: z.string().trim().max(1000).nullable().optional(),
            description: z.string().trim().max(20000).nullable().optional(),
            closed: z.boolean().optional(),
            title: z.string().trim().min(1).max(300).optional(),
            role_group: z.string().trim().max(200).nullable().optional(),
          })
          .strict()
          .refine((f) => Object.keys(f).length > 0, { message: "Give at least one field to change." }),
      },
      annotations: WRITE,
    },
    async ({ ids, fields }) => {
      const blocked = guard();
      if (blocked) return blocked;
      const unique = [...new Set(ids)];
      if (fields.source_url && unique.length > 1) return fail("Set source_url on one vacancy at a time: every vacancy has its own link.");
      const { closed, source_url, ...rest } = fields;
      const patch: Database["public"]["Tables"]["signals"]["Update"] = { ...rest };
      if (source_url !== undefined) {
        const clean = source_url ? cleanSourceUrl(source_url) : null;
        if (source_url && !clean) return fail(`"${source_url}" is not a web address. Give the full link to the vacancy.`);
        patch.source_url = clean;
      }
      if (closed !== undefined) patch.closed_at = closed ? new Date().toISOString() : null;
      const { data, error } = await db.from("signals").update(patch).in("id", unique).select("id");
      return rpcError(error, "update the vacancies") ?? ok({ updated: (data ?? []).length, requested: unique.length });
    },
  );

  // -------------------------------------------------------------------------
  server.registerTool(
    "set_icp_verdict",
    {
      title: "Set ICP verdict",
      description:
        "Record the ICP verdict of a company: decision (GO, NO_GO, REVIEW), score 0 to 100, reason, prio 1 to 5, opening line for calls and mail. The lead status follows (GO is ready, REVIEW is review, NO_GO is no go) while the company is still new, review or ready; give lead_status to choose. Logged with source claude.",
      inputSchema: {
        company_id: idSchema,
        decision: icpDecision,
        score: z.number().int().min(0).max(100).optional(),
        reason: z.string().trim().min(1).max(2000),
        prio: z.number().int().min(1).max(5).optional(),
        opening_line: z.string().trim().max(500).optional(),
        category: category.optional(),
        lead_status: z.enum(["review", "ready", "no_go"]).optional(),
      },
      annotations: WRITE,
    },
    async (input) => {
      const blocked = guard();
      if (blocked) return blocked;
      const company = check(await db.from("companies").select("id, lead_status").eq("id", input.company_id).maybeSingle(), "company");
      if (!company || Array.isArray(company)) return fail("Company not found.");
      const fields: Record<string, Json> = { icp_decision: input.decision, icp_reason: input.reason };
      if (input.score !== undefined) fields.icp_score = input.score;
      if (input.prio !== undefined) fields.prio = input.prio;
      if (input.opening_line !== undefined) fields.opening_line = input.opening_line;
      if (input.category !== undefined) fields.category = input.category;
      const derived = icpLeadStatus(input.decision, company.lead_status, input.lead_status);
      if (derived) fields.lead_status = derived;
      const { error } = await db.rpc("sales_update", {
        p_entity: "company",
        p_ids: [input.company_id],
        p_fields: fields,
        p_source: "claude",
        p_actor: actor,
      });
      return rpcError(error, "save the verdict") ?? ok({ company_id: input.company_id, lead_status: derived ?? company.lead_status });
    },
  );

  // -------------------------------------------------------------------------
  server.registerTool(
    "draft_sequence_text",
    {
      title: "Draft sequence text",
      description:
        "Write a concept subject and text for one sequence step. It waits next to the approved text until Julius approves it in the portal; only approved text is ever used. Logged in Activities on the sequence with source claude. Placeholders such as {first_name}, {company} and {opening_line} are fine.",
      inputSchema: {
        step_id: idSchema,
        subject: z.string().trim().max(500).optional().describe("Mail only."),
        body: z.string().trim().min(1).max(20_000),
      },
      annotations: WRITE,
    },
    async ({ step_id, subject, body }) => {
      const blocked = guard();
      if (blocked) return blocked;
      const step = check(await db.from("sequence_steps").select("id, channel, sequence_id").eq("id", step_id).maybeSingle(), "step");
      if (!step || Array.isArray(step)) return fail("Step not found.");
      if (subject && step.channel !== "mail") return fail("Only mail steps have a subject.");
      // Through the database function, so the concept is logged in Activities with source claude.
      const { data, error } = await db.rpc("sales_draft_step", {
        p_step: step_id,
        p_subject: subject ?? null,
        p_body: body,
        p_source: "claude",
        p_actor: actor,
      });
      return (
        rpcError(error, "save the concept") ??
        ok({
          step_id,
          activity_id: data,
          waiting_for_approval: true,
          url: `${ctx.siteUrl.replace(/\/$/, "")}/dashboard/sequences/${step.sequence_id}`,
        })
      );
    },
  );

  // -------------------------------------------------------------------------
  server.registerTool(
    "start_sequence",
    {
      title: "Start sequence",
      description:
        "Start an active sequence for one or more companies. Every step becomes a task on its day; the company goes to In sequence. Refused when a mail or LinkedIn text is not approved, or for companies that may not be contacted. contact_id only with one company (default: the primary contact).",
      inputSchema: {
        sequence_id: idSchema,
        company_ids: z.array(idSchema).min(1).max(50),
        contact_id: idSchema.optional(),
        start_date: dateSchema.optional().describe("Default today."),
      },
      annotations: WRITE,
    },
    async ({ sequence_id, company_ids, contact_id, start_date }) => {
      const blocked = guard();
      if (blocked) return blocked;
      const unique = [...new Set(company_ids)];
      if (contact_id && unique.length > 1) return fail("contact_id only goes with one company.");
      const results: { company_id: string; enrollment_id?: string; error?: string }[] = [];
      for (const company of unique) {
        const { data, error } = await db.rpc("sales_start_sequence", {
          p_sequence: sequence_id,
          p_company: company,
          p_contact: contact_id ?? null,
          p_start: start_date ?? null,
          p_source: "claude",
          p_actor: actor,
        });
        results.push(error ? { company_id: company, error: friendlyStartError(error.message) } : { company_id: company, enrollment_id: data });
      }
      return ok({ started: results.filter((r) => r.enrollment_id).length, results });
    },
  );

  // -------------------------------------------------------------------------
  server.registerTool(
    "update_sequence_tasks",
    {
      title: "Update step tasks",
      description:
        "Mark open mail or LinkedIn step tasks as done once prepared in Instantly or Seleqt (with the id there as external_id), or as skipped with a reason. Call steps are closed on the call screen, not here. A done mail or LinkedIn step is also logged in Activities as an outbound contact with source claude.",
      inputSchema: {
        tasks: z
          .array(
            z.object({
              id: idSchema,
              status: z.enum(["done", "skipped"]),
              external_id: z.string().trim().min(1).max(300).optional().describe("The id in Instantly or Seleqt."),
              note: z.string().trim().max(500).optional(),
            }),
          )
          .min(1)
          .max(100),
      },
      annotations: WRITE,
    },
    async ({ tasks }) => {
      const blocked = guard();
      if (blocked) return blocked;
      const rows = check(
        await db
          .from("sequence_tasks")
          .select("id, channel, status, company_id, contact_id, step:sequence_steps(position), enrollment:sequence_enrollments(sequence:sequences(name))")
          .in("id", tasks.map((t) => t.id)),
        "step tasks",
      );
      const results: { id: string; status?: string; error?: string }[] = [];
      for (const t of tasks) {
        const row = rows.find((r) => r.id === t.id);
        if (!row) {
          results.push({ id: t.id, error: "Task not found." });
          continue;
        }
        if (row.channel === "call") {
          results.push({ id: t.id, error: "Call steps are closed on the call screen." });
          continue;
        }
        if (row.status !== "open") {
          results.push({ id: t.id, error: `Task is ${row.status}.` });
          continue;
        }
        const { error } = await db
          .from("sequence_tasks")
          .update({ status: t.status, done_at: new Date().toISOString(), external_id: t.external_id ?? null })
          .eq("id", t.id)
          .eq("status", "open");
        if (error) {
          results.push({ id: t.id, error: /duplicate key/.test(error.message) ? "That external_id is already used." : error.message });
          continue;
        }
        if (t.status === "done") {
          const sequenceName = row.enrollment?.sequence?.name ?? "sequence";
          await db.rpc("sales_log_activity", {
            p_company: row.company_id,
            p_contact: row.contact_id,
            p_channel: row.channel,
            p_type: "contact",
            p_outcome: "verstuurd",
            p_direction: "outbound",
            p_notes: `Step ${row.step?.position ?? ""} of ${sequenceName} prepared in ${row.channel === "mail" ? "Instantly" : "Seleqt"}${t.note ? `: ${t.note}` : ""}`,
            p_source: "claude",
            p_external_id: t.external_id ? `sequence:${t.external_id}` : `sequence-task:${t.id}`,
            p_actor: actor,
          });
        }
        results.push({ id: t.id, status: t.status });
      }
      return ok({ updated: results.filter((r) => r.status).length, results });
    },
  );

  // -------------------------------------------------------------------------
  server.registerTool(
    "pause_company",
    {
      title: "Pause company",
      description:
        "After a reply handled outside the portal: pause the company everywhere in the portal (its sequences pause, open call steps are removed), the same as when a reply is logged. Pause it in Instantly and Seleqt yourself as well.",
      inputSchema: { company_id: idSchema, reason: z.string().trim().max(500).optional() },
      annotations: WRITE,
    },
    async ({ company_id, reason }) => {
      const blocked = guard();
      if (blocked) return blocked;
      const { data, error } = await db.rpc("sales_pause", {
        p_company: company_id,
        p_reason: reason ?? null,
        p_source: "claude",
        p_actor: actor,
      });
      return rpcError(error, "pause the company") ?? ok({ company_id, ...(data ?? {}) });
    },
  );
}

/** Lead status after an ICP verdict. Only moves companies that are not being approached yet. Pure. */
export function icpLeadStatus(
  decision: "GO" | "NO_GO" | "REVIEW",
  current: LeadStatus,
  chosen?: "review" | "ready" | "no_go",
): LeadStatus | null {
  if (chosen) return chosen;
  if (!["new", "review", "ready"].includes(current)) return null;
  const next: LeadStatus = decision === "GO" ? "ready" : decision === "REVIEW" ? "review" : "no_go";
  return next === current ? null : next;
}

function friendlyStartError(message: string) {
  if (/duplicate key|sequence_enrollments_active_key/.test(message)) return "Already in this sequence.";
  return message;
}

type UpsertCompanyInput = z.infer<typeof upsertCompanySchema>;

/** Companies with the same or a similar name on another domain (sales_similar_companies). */
export async function similarCompanies(db: McpDb, name: string, domain: string | null, exclude: string | null): Promise<SimilarCompany[]> {
  const { data, error } = await db.rpc("sales_similar_companies", { p_name: name, p_domain: domain, p_exclude: exclude });
  return error ? [] : (data ?? []);
}

/** The company with this domain, or one merged into it with this domain. */
async function companyByDomain<F extends string>(db: McpDb, domain: string, fields: F) {
  const direct = check(await db.from("companies").select(fields).eq("domain", domain).maybeSingle(), "company");
  if (direct && !Array.isArray(direct)) return direct;
  const alias = check(await db.from("companies").select(fields).contains("alias_domains", [domain]).limit(1).maybeSingle(), "company");
  return alias && !Array.isArray(alias) ? alias : null;
}

/** Match on domain, then LinkedIn; fill in missing fields through sales_update; add signals and people. */
export async function upsertSalesCompany(db: McpDb, actor: string, source: "apify" | "prospeo" | LeadOrigin, input: UpsertCompanyInput) {
  const domain = normalizeDomain(input.domain);
  const linkedinKey = normalizeLinkedin(input.linkedin_url);
  const fields = "id, name, domain, website, city, sector, employees, linkedin_url, description, opening_line, red_flags, general_phone, sources" as const;

  let existing = domain ? await companyByDomain(db, domain, fields) : null;
  if (!existing && linkedinKey) {
    const hit = check(await db.from("companies").select(fields).eq("linkedin_key", linkedinKey).limit(1).maybeSingle(), "company");
    existing = hit && !Array.isArray(hit) ? hit : null;
  }

  // Opening line, red flags and number written into the description go to their own fields.
  const notes = extractLeadNotes(input.description);
  const incoming = {
    name: input.name,
    website: domain ? (input.domain && /^https?:\/\//i.test(input.domain) ? input.domain : `https://${domain}`) : null,
    city: input.city ?? null,
    sector: input.sector ?? null,
    employees: input.employees ?? null,
    linkedin_url: cleanLinkedinUrl(input.linkedin_url),
    description: notes ? notes.description : (input.description ?? null),
    opening_line: input.opening_line ?? notes?.opening_line ?? null,
    red_flags: input.red_flags?.length ? input.red_flags : notes?.red_flags.length ? notes.red_flags : null,
    general_phone: (() => {
      const raw = input.general_phone ?? notes?.general_phone ?? null;
      return raw ? (normalizePhone(raw) ?? raw).slice(0, 50) : null;
    })(),
  };

  let companyId: string;
  let created = false;
  let companyDomain: string;
  if (existing) {
    companyId = existing.id;
    companyDomain = existing.domain;
    const patch: Record<string, Json> = {};
    for (const [key, value] of Object.entries(incoming)) {
      if (value === null || value === "" || key === "name") continue;
      const current = (existing as Record<string, unknown>)[key];
      if (current === null || current === undefined || current === "" || (Array.isArray(current) && current.length === 0)) {
        patch[key] = value as Json;
      }
    }
    if (Object.keys(patch).length > 0) {
      const { error } = await db.rpc("sales_update", {
        p_entity: "company",
        p_ids: [companyId],
        p_fields: patch,
        p_source: "claude",
        p_actor: actor,
      });
      if (error) throw new Error(error.message);
    }
    if (!existing.sources.includes(source)) {
      await db.from("companies").update({ sources: [...existing.sources, source] }).eq("id", companyId);
    }
  } else {
    companyDomain = domain ?? `nodomain:${input.name.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 180)}`;
    const { data, error } = await db
      .from("companies")
      .insert({ ...incoming, red_flags: incoming.red_flags ?? [], domain: companyDomain, source, sources: [source], lead_status: "new" })
      .select("id")
      .single();
    if (error) {
      if (error.code === "23505") return upsertSalesCompany(db, actor, source, input);
      throw new Error(error.message);
    }
    companyId = data.id;
    created = true;
    await db.rpc("sales_log_activity", {
      p_company: companyId,
      p_contact: null,
      p_channel: "system",
      p_type: "system",
      p_notes: `Added from ${source === "apify" ? "Apify" : source === "prospeo" ? "Prospeo" : originLabels[source]} by Claude`,
      p_source: "claude",
      p_actor: actor,
    });
  }

  // Every vacancy on its own; one that cannot be saved is reported, not dropped silently.
  let signalsNew = 0;
  let signalsSeenAgain = 0;
  const signalsFailed: { title: string; error: string }[] = [];
  for (const s of input.signals) {
    const url = s.source_url ? cleanSourceUrl(s.source_url) : null;
    if (s.source_url && !url) {
      signalsFailed.push({ title: s.title, error: `Not saved: "${s.source_url}" is not a web address. Give the full link to the vacancy.` });
      continue;
    }
    try {
      const r = await upsertSignal(db, {
        company_id: companyId,
        company_domain: companyDomain,
        type: s.type,
        title: s.title,
        // Signals know apify, prospeo, linkedin; a lead by hand files its vacancies as "overig".
        source: source === "apify" || source === "prospeo" || source === "linkedin" ? source : "overig",
        source_url: url,
        role_group: s.role_group ?? null,
        posted_at: s.posted_at ?? null,
        description: s.description ?? null,
        closed: s.closed,
      });
      if (r.created) signalsNew += 1;
      else signalsSeenAgain += 1;
    } catch (error) {
      signalsFailed.push({ title: s.title, error: `Not saved: ${error instanceof Error ? error.message : String(error)}` });
    }
  }

  let contactsNew = 0;
  const contactsFailed: { name: string; error: string }[] = [];
  for (const p of input.contacts) {
    const split = p.full_name ? splitName(p.full_name) : { first: null, last: null };
    const result = await addSalesContact(
      db,
      actor,
      {
        company_id: companyId,
        first_name: p.first_name ?? split.first ?? undefined,
        last_name: p.last_name ?? split.last ?? undefined,
        title: p.title,
        email: p.email,
        phone: p.phone,
        linkedin_url: p.linkedin_url,
        linkedin_member_urn: p.linkedin_member_urn,
        role: p.role,
        tier: p.tier,
      },
      { source, quiet: true },
    );
    if ("error" in result) {
      contactsFailed.push({ name: p.full_name ?? ([p.first_name, p.last_name].filter(Boolean).join(" ") || p.email || "Contact"), error: result.error });
    }
    else if (result.created) contactsNew += 1;
  }

  const duplicates = created ? await similarCompanies(db, input.name, domain, companyId) : [];
  return {
    name: input.name,
    company_id: companyId,
    created,
    signals_new: signalsNew,
    signals_seen_again: signalsSeenAgain,
    ...(signalsFailed.length ? { signals_failed: signalsFailed } : {}),
    contacts_new: contactsNew,
    ...(contactsFailed.length ? { contacts_failed: contactsFailed } : {}),
    ...(notes ? { moved_from_description: ["opening_line", "red_flags", "general_phone"].filter((k) => notes[k as keyof typeof notes]?.length) } : {}),
    ...(duplicates.length ? { possible_duplicates: duplicates, warning: duplicateWarning(duplicates) } : {}),
  };
}

export type AddContactInput = {
  company_id: string;
  first_name?: string;
  last_name?: string;
  full_name?: string;
  title?: string;
  email?: string;
  phone?: string;
  linkedin_url?: string;
  linkedin_member_urn?: string;
  role?: "main" | "extra" | "reserve";
  tier?: number;
  is_primary?: boolean;
  origin?: LeadOrigin;
};

/**
 * One contact on an existing company, without duplicates: the same LinkedIn
 * link (any case) or member id anywhere, else the same email at this
 * company, else the same name at this company, is the same person and only
 * gets its empty fields filled in (and a lowercased Apify link its case back).
 */
export async function addSalesContact(
  db: McpDb,
  actor: string,
  input: AddContactInput,
  options: { source?: string; quiet?: boolean } = {},
): Promise<{ error: string } | { contact_id: string; created: boolean; filled_in: string[]; matched_on?: string }> {
  const { data: company } = await db.from("companies").select("id").eq("id", input.company_id).maybeSingle();
  if (!company) return { error: "Company not found. Add it first with add_company." };
  const split = input.full_name ? splitName(input.full_name) : { first: null, last: null };
  const first = input.first_name?.trim() || split.first;
  const last = input.last_name?.trim() || split.last;
  const keys = personKeys({ linkedin_url: input.linkedin_url, linkedin_member_urn: input.linkedin_member_urn, email: input.email, first, last });
  const phone = normalizePhone(input.phone);
  if (input.linkedin_url && !keys.linkedinKey) return { error: "That is not a LinkedIn profile URL." };
  if (input.phone && !phone) return { error: "That is not a valid phone number." };
  if (!first && !last && !keys.email && !keys.linkedinKey && !keys.memberUrn) return { error: "Give at least a name, an email or a LinkedIn profile." };

  const found = await findSalesContact(db, input.company_id, keys, "first_name, last_name, title, tier, email, phone, role, is_primary");
  const source = options.source ?? input.origin ?? "claude";
  if (found) {
    const row = found.row as typeof found.row & {
      first_name: string | null;
      last_name: string | null;
      title: string | null;
      tier: number | null;
      email: string | null;
      phone: string | null;
      role: string;
      is_primary: boolean;
    };
    if (row.company_id !== input.company_id && (found.by === "linkedin" || found.by === "member_id")) {
      return { error: `This LinkedIn profile is already a contact at another company (contact ${row.id}).` };
    }
    const patch: Record<string, Json> = {};
    if (!row.first_name && first) patch.first_name = first;
    if (!row.last_name && last) patch.last_name = last;
    if (!row.title && input.title) patch.title = input.title;
    if (row.tier == null && input.tier) patch.tier = input.tier;
    if (!row.email && keys.email) patch.email = keys.email;
    if (!row.phone && phone) {
      patch.phone = phone;
      patch.phone_type = phoneTypeFor(phone);
    }
    const links = linkedinPatch(row, keys);
    if (links.linkedin_url) patch.linkedin_url = links.linkedin_url;
    if (input.role && input.role !== row.role) patch.role = input.role;
    if (input.is_primary !== undefined && input.is_primary !== row.is_primary) patch.is_primary = input.is_primary;
    if (Object.keys(patch).length) {
      const { error } = await db.rpc("sales_update", { p_entity: "contact", p_ids: [row.id], p_fields: patch, p_source: "claude", p_actor: actor });
      if (error) {
        return {
          error: /linkedin_key/.test(error.message)
            ? `Another contact already has the LinkedIn profile ${links.linkedin_url}. Merge the two with merge_contacts.`
            : `Could not update the contact: ${error.message}`,
        };
      }
    }
    if (links.linkedin_member_urn) {
      const { error } = await db.rpc("sales_set_contact_linkedin", { p_contact: row.id, p_member_urn: links.linkedin_member_urn, p_source: "claude", p_actor: actor });
      if (error) return { error: `Could not save the LinkedIn member id: ${error.message}` };
      patch.linkedin_member_urn = links.linkedin_member_urn;
    }
    return { contact_id: row.id, created: false, filled_in: Object.keys(patch), matched_on: found.by };
  }

  const now = new Date().toISOString();
  const { data, error } = await db
    .from("contacts")
    .insert({
      company_id: input.company_id,
      first_name: first,
      last_name: last,
      title: input.title ?? null,
      tier: input.tier ?? null,
      linkedin_url: keys.linkedinUrl,
      linkedin_member_urn: keys.memberUrn,
      // Without a role: main when the company has none yet, else backup, else extra (the database decides).
      role: input.role ?? "main",
      is_primary: input.is_primary ?? false,
      ...(keys.email ? { email: keys.email, email_source: source, email_found_at: now, email_status: "unknown" as const } : {}),
      ...(phone ? { phone, phone_type: phoneTypeFor(phone), phone_source: source, phone_found_at: now } : {}),
      status: "new",
      source,
      sources: [source],
    })
    .select("id")
    .single();
  if (error || !data) {
    if (error?.code === "23505") return { error: "This person is already a contact (same LinkedIn profile or member id)." };
    return { error: `Could not add the contact: ${error?.message ?? "unknown error"}` };
  }
  if (!options.quiet) {
    await db.rpc("sales_log_activity", {
      p_company: input.company_id,
      p_contact: data.id,
      p_channel: "system",
      p_type: "system",
      p_notes: `Contact added by Claude${input.origin ? ` (${originLabels[input.origin]})` : ""}`,
      p_source: "claude",
      p_actor: actor,
    });
  }
  return { contact_id: data.id, created: true, filled_in: [] };
}
