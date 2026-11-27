import "server-only";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SignalType } from "@/lib/database.types";
import { cleanSourceUrl } from "@/lib/gtm/normalize";
import { upsertSignal } from "@/lib/gtm/upsert";
import { accessError } from "@/lib/mcp/module-scope";
import { check, fail, idSchema, ok, recordUrl, type McpToolContext } from "@/lib/mcp/shared";
import { effectiveModules } from "@/lib/modules";
import { formatScore, parseScore } from "@/lib/sales/score";
import { describeSignal, loadSignalPoints } from "@/lib/sales/score-data";

/**
 * MCP tools of the leadregels (20 November 2026, docs/leadregels.md): read
 * and add signals (for Claude and the weekly scrape), check before every
 * upload to Instantly or Seleqt or call list whether a domain or mail address
 * may be approached, and put contacts 1 and 2 in the default order. Writes go
 * through the database with the token owner as actor and source claude.
 */

const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;

export const LEADREGELS_READ_TOOLS = ["check_outreach", "list_signals"] as const;
export const LEADREGELS_WRITE_TOOLS = ["add_signals", "apply_contact_order"] as const;

const hasSales = (ctx: Pick<McpToolContext, "role" | "modules">) => effectiveModules(ctx.role, ctx.modules).includes("sales");

const dateSchema = z.iso.date().describe("Date as YYYY-MM-DD.");
const signalType = z
  .string()
  .regex(/^[a-z0-9_]{1,40}$/, { error: "Use lower case letters, digits and _." })
  .describe(
    "vacature (a dev or data vacancy), india_outsourced (team in India or outsourced before), funding, employee_growth, nieuwe_cto, via_recruiter, stack_match, overname_product, interactie, ontslagen, or another kind from Settings, Sales lists. Several vacancies and a vacancy open 60 days are derived: do not add them.",
  );

export function registerLeadregelsTools(server: McpServer, ctx: McpToolContext) {
  if (!hasSales(ctx)) return;
  const { db } = ctx;
  const actor = ctx.userId;
  const url = (type: string, id: string) => recordUrl(ctx.siteUrl, type, id);

  // -------------------------------------------------------------------------
  server.registerTool(
    "check_outreach",
    {
      title: "Check before outreach",
      description:
        "The exclusion check before every upload to Instantly or Seleqt and every call list (leadregels, deel 3). Give a list of domains or mail addresses; each comes back with allowed (true or false) and the reasons: own contact, pipeline, do not contact, no go, in sequence, campagne <name>, bellijst <caller or call list> (the company is on a call list, bucket call: no mail or LinkedIn while it is there; free it with triage_leads first), nee_geen_interesse tot <date>, nu_niet tot <date>, minder dan 1 week sinds de vorige route zonder nieuw signaal. A domain that is not in the portal is allowed. Only upload the allowed ones.",
      inputSchema: {
        items: z.array(z.string().trim().min(1).max(320)).min(1).max(2000).describe("Domains (example.nl, https://www.example.nl) or mail addresses."),
      },
      annotations: READ_ONLY,
    },
    async ({ items }) => {
      const { data, error } = await db.rpc("sales_check_outreach", { p_items: items, p_actor: actor });
      if (error) return fail(`Could not check: ${error.message}`);
      const rows = data ?? [];
      return ok({
        allowed: rows.filter((r) => r.allowed).length,
        refused: rows.filter((r) => !r.allowed).length,
        results: rows.map((r) => ({ ...r, url: r.company_id ? url("company", r.company_id) : null })),
      });
    },
  );

  // -------------------------------------------------------------------------
  server.registerTool(
    "list_signals",
    {
      title: "Signals of companies",
      description:
        "The signals of one or more companies, each with kind, date, source link, valid until, whether it is active or evergreen (a vacancy open over 180 days or an open application: does not count) and its points from the points table, plus the score of each company with its breakdown (for example A 50 + vacature 30 = 80). Without company_ids: the newest signals, filtered on type and active.",
      inputSchema: {
        company_ids: z.array(idSchema).max(100).optional(),
        type: z.array(signalType).max(20).optional(),
        active_only: z.boolean().optional().describe("true: only signals that are still open and not past valid until."),
        limit: z.number().int().min(1).max(500).default(200),
      },
      annotations: READ_ONLY,
    },
    async ({ company_ids, type, active_only, limit }) => {
      let q = db
        .from("signals")
        .select("id, company_id, type, title, role_group, source, source_url, posted_at, first_seen_at, last_seen_at, closed_at, valid_until, company:companies!signals_company_id_fkey(name, segment, icp_score)")
        .order("last_seen_at", { ascending: false })
        .limit(limit);
      if (company_ids?.length) q = q.in("company_id", company_ids);
      if (type?.length) q = q.in("type", type as SignalType[]);
      if (active_only) q = q.is("closed_at", null);
      const [rows, points] = await Promise.all([q, loadSignalPoints(db)]);
      const signals = check(rows, "signals").map(({ company, ...s }) => ({
        ...describeSignal(s, points),
        company: company?.name ?? null,
      }));
      const filtered = active_only ? signals.filter((s) => s.active) : signals;
      const scores: Record<string, { score: number | null; breakdown: string | null }> = {};
      for (const id of company_ids ?? []) {
        const { data } = await db.rpc("sales_company_score", { p_company: id });
        const parsed = parseScore(data);
        scores[id] = { score: parsed?.total ?? null, breakdown: formatScore(parsed) };
      }
      return ok({
        points: points.map((p) => ({ type: p.type, label: p.label, points: p.points, active: p.active, derived: p.derived })),
        ...(company_ids?.length ? { scores } : {}),
        signals: filtered,
      });
    },
  );

  if (ctx.access !== "write") return;
  const guard = () => (hasSales(ctx) ? null : fail(accessError(["sales"])));

  // -------------------------------------------------------------------------
  server.registerTool(
    "add_signals",
    {
      title: "Add signals",
      description:
        "Add signals to companies (Claude and the weekly scrape): kind, title, date (posted_at), source link and optionally valid_until. The same link at the same company is not added twice (it is seen again, and opened again unless closed). A vacancy that went offline: give closed true and its signal expires. The score of the company is computed again at once; a new vacancy or other active signal puts a cooled down company back on ready, and asks for a personal follow up at a company that said no (nee_geen_interesse). Answers per company the new score.",
      inputSchema: {
        signals: z
          .array(
            z.object({
              company_id: idSchema,
              type: signalType.default("vacature"),
              title: z.string().trim().min(1).max(300),
              source_url: z.string().trim().max(1000).optional().describe("Link to the source (the vacancy, the news item)."),
              posted_at: dateSchema.optional().describe("The date of the signal (a vacancy: online since)."),
              valid_until: dateSchema.optional().describe("Until when it counts. Default: a vacancy while open, other kinds the days set in Settings."),
              role_group: z.string().trim().max(200).optional(),
              description: z.string().trim().max(20000).optional(),
              closed: z.boolean().optional().describe("true: offline, the signal expires."),
            }),
          )
          .min(1)
          .max(200),
      },
      annotations: WRITE,
    },
    async ({ signals }) => {
      const blocked = guard();
      if (blocked) return blocked;
      const ids = [...new Set(signals.map((s) => s.company_id))];
      const companies = check(await db.from("companies").select("id, domain, name").in("id", ids), "companies");
      const byId = new Map(companies.map((c) => [c.id, c]));
      const results: { company_id: string; title: string; result: "new" | "seen_again" | "failed"; error?: string }[] = [];
      for (const s of signals) {
        const company = byId.get(s.company_id);
        if (!company) {
          results.push({ company_id: s.company_id, title: s.title, result: "failed", error: "Company not found." });
          continue;
        }
        const link = s.source_url ? cleanSourceUrl(s.source_url) : null;
        if (s.source_url && !link) {
          results.push({ company_id: s.company_id, title: s.title, result: "failed", error: `"${s.source_url}" is not a web address.` });
          continue;
        }
        try {
          const r = await upsertSignal(db, {
            company_id: company.id,
            company_domain: company.domain,
            type: s.type as SignalType,
            title: s.title,
            source: "overig",
            source_url: link,
            role_group: s.role_group ?? null,
            posted_at: s.posted_at ?? null,
            description: s.description ?? null,
            closed: s.closed,
            valid_until: s.valid_until ?? null,
          });
          results.push({ company_id: s.company_id, title: s.title, result: r.created ? "new" : "seen_again" });
        } catch (error) {
          results.push({ company_id: s.company_id, title: s.title, result: "failed", error: error instanceof Error ? error.message : String(error) });
        }
      }
      const after = check(await db.from("companies").select("id, name, icp_score, lead_status").in("id", ids), "companies");
      return ok({
        added: results.filter((r) => r.result === "new").length,
        seen_again: results.filter((r) => r.result === "seen_again").length,
        failed: results.filter((r) => r.result === "failed"),
        companies: after.map((c) => ({ id: c.id, name: c.name, score: c.icp_score, lead_status: c.lead_status, url: url("company", c.id) })),
      });
    },
  );

  // -------------------------------------------------------------------------
  server.registerTool(
    "apply_contact_order",
    {
      title: "Default contact order",
      description:
        "Put contact 1 (role main) and contact 2 (backup) of a company in the default order (leadregels, deel 4): under about 30 FTE first the owner (tier 2), from 30 first the technical contact (tier 1); with a data vacancy first the head of data or BI; tier 3 (HR) only when tier 1 and 2 are missing. From then on new contacts follow the default again. To pick contacts by hand use update_contacts with role.",
      inputSchema: { company_id: idSchema },
      annotations: WRITE,
    },
    async ({ company_id }) => {
      const blocked = guard();
      if (blocked) return blocked;
      const { data, error } = await db.rpc("sales_apply_contact_order", { p_company: company_id, p_source: "claude", p_actor: actor });
      if (error) return fail(`Could not order the contacts: ${error.message}`);
      return ok({ company_id, contact_1: data?.[0] ?? null, contact_2: data?.[1] ?? null, url: url("company", company_id) });
    },
  );
}
