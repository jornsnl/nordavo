import "server-only";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ApplicationStage, Json } from "@/lib/database.types";
import { applicationStages } from "@/lib/labels";
import {
  amsterdamDate,
  check,
  clip,
  daysSince,
  fail,
  idSchema,
  limitSchema,
  linkableTypes,
  ok,
  offsetSchema,
  personName,
  recordUrl,
  resolveLabels,
  searchPattern,
  type McpToolContext,
} from "@/lib/mcp/shared";
import { registerWriteTools } from "@/lib/mcp/write-tools";

const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;

const clientStatus = z.enum(["lead", "active", "inactive"]);
const vacancyStatus = z.enum(["open", "on_hold", "filled", "closed"]);
const candidateStatus = z.enum(["available", "in_process", "placed", "unavailable"]);
const placementStatus = z.enum(["active", "notice", "ended"]);

const searchTypes = ["client", "vacancy", "candidate", "placement", "company", "contact"] as const;

/**
 * Register every tool for this token. Read tools are always there; write
 * tools only for tokens with write access.
 */
export function registerTools(server: McpServer, ctx: McpToolContext) {
  registerReadTools(server, ctx);
  if (ctx.access === "write") registerWriteTools(server, ctx);
}

function registerReadTools(server: McpServer, ctx: McpToolContext) {
  const { db } = ctx;
  const url = (type: string, id: string) => recordUrl(ctx.siteUrl, type, id);

  // -------------------------------------------------------------------------
  server.registerTool(
    "whoami",
    {
      title: "Wie ben ik",
      description:
        "Who this token belongs to (name, email, role) and whether it can only read or also write. Call this first if unsure which tools are allowed.",
      annotations: READ_ONLY,
    },
    async () =>
      ok({
        user_id: ctx.userId,
        name: ctx.name,
        email: ctx.email,
        role: ctx.role,
        token: ctx.tokenName,
        access: ctx.access,
        portal: ctx.siteUrl,
        today: amsterdamDate(),
      }),
  );

  // -------------------------------------------------------------------------
  server.registerTool(
    "search",
    {
      title: "Zoeken",
      description:
        "Search the Nordavo portal by name or title across clients, vacancies, candidates (name, title), placements (by candidate name), GTM companies (name, domain) and GTM contacts (name, email). Returns ids to use with the get_* tools.",
      inputSchema: {
        query: z.string().min(2).max(80).describe("Search text, at least 2 characters."),
        types: z.array(z.enum(searchTypes)).min(1).optional().describe("Limit to these record types. Default: all."),
        limit: z.number().int().min(1).max(25).default(5).describe("Hits per type (default 5, max 25)."),
      },
      annotations: READ_ONLY,
    },
    async ({ query, types, limit }) => {
      const pattern = searchPattern(query);
      if (!pattern) return fail("Zoekterm te kort: gebruik minstens 2 tekens.");
      const wanted = new Set(types ?? searchTypes);
      const result: Record<string, unknown[]> = {};

      await Promise.all([
        wanted.has("client") &&
          db
            .from("clients")
            .select("id, name, city, status")
            .ilike("name", pattern)
            .order("name")
            .limit(limit)
            .then((r) => {
              result.client = check(r, "Klanten").map((c) => ({ ...c, url: url("client", c.id) }));
            }),
        wanted.has("vacancy") &&
          db
            .from("vacancies")
            .select("id, title, status, client:clients(name), company:companies(name)")
            .ilike("title", pattern)
            .order("opened_at", { ascending: false })
            .limit(limit)
            .then((r) => {
              result.vacancy = check(r, "Vacatures").map((v) => ({
                id: v.id,
                title: v.title,
                status: v.status,
                client: v.client?.name ?? v.company?.name ?? null,
                url: url("vacancy", v.id),
              }));
            }),
        wanted.has("candidate") &&
          db
            .from("candidates")
            .select("id, full_name, current_title, status")
            .or(`full_name.ilike.${pattern},current_title.ilike.${pattern}`)
            .order("full_name")
            .limit(limit)
            .then((r) => {
              result.candidate = check(r, "Kandidaten").map((c) => ({ ...c, url: url("candidate", c.id) }));
            }),
        wanted.has("placement") &&
          (async () => {
            const candidates = check(
              await db.from("candidates").select("id").ilike("full_name", pattern).limit(50),
              "Kandidaten",
            );
            if (candidates.length === 0) {
              result.placement = [];
              return;
            }
            const rows = check(
              await db
                .from("placements")
                .select("id, status, start_date, candidate:candidates(full_name), client:clients(name)")
                .in(
                  "candidate_id",
                  candidates.map((c) => c.id),
                )
                .order("start_date", { ascending: false })
                .limit(limit),
              "Plaatsingen",
            );
            result.placement = rows.map((p) => ({
              id: p.id,
              candidate: p.candidate?.full_name ?? null,
              client: p.client?.name ?? null,
              status: p.status,
              start_date: p.start_date,
              url: url("placement", p.id),
            }));
          })(),
        wanted.has("company") &&
          db
            .from("companies")
            .select("id, name, domain, status, icp_decision, client_id")
            .or(`name.ilike.${pattern},domain.ilike.${pattern}`)
            .order("icp_score", { ascending: false, nullsFirst: false })
            .limit(limit)
            .then((r) => {
              result.company = check(r, "Bedrijven").map((c) => ({ ...c, url: url("company", c.id) }));
            }),
        wanted.has("contact") &&
          db
            .from("contacts")
            .select("id, first_name, last_name, title, email, status, company:companies(id, name)")
            .or(`first_name.ilike.${pattern},last_name.ilike.${pattern},email.ilike.${pattern}`)
            .order("last_name")
            .limit(limit)
            .then((r) => {
              result.contact = check(r, "Contacten").map((c) => ({
                id: c.id,
                name: [c.first_name, c.last_name].filter(Boolean).join(" ") || null,
                title: c.title,
                email: c.email,
                status: c.status,
                company_id: c.company?.id ?? null,
                company: c.company?.name ?? null,
              }));
            }),
      ]);

      return ok(result);
    },
  );

  // -------------------------------------------------------------------------
  server.registerTool(
    "list_clients",
    {
      title: "Klanten",
      description: "List clients (companies Nordavo works for), sorted by name, with status, city and number of open vacancies.",
      inputSchema: {
        query: z.string().max(80).optional().describe("Filter on client name."),
        status: clientStatus.optional().describe("lead, active or inactive."),
        limit: limitSchema,
        offset: offsetSchema,
      },
      annotations: READ_ONLY,
    },
    async ({ query, status, limit, offset }) => {
      let q = db
        .from("clients")
        .select("id, name, status, city, industry, website, owner:profiles!clients_owner_id_fkey(full_name, email), vacancies(status)", {
          count: "exact",
        })
        .order("name")
        .range(offset, offset + limit - 1);
      const pattern = searchPattern(query);
      if (pattern) q = q.ilike("name", pattern);
      if (status) q = q.eq("status", status);
      const r = await q;
      const rows = check(r, "Klanten");
      return ok({
        total: r.count,
        clients: rows.map((c) => ({
          id: c.id,
          name: c.name,
          status: c.status,
          city: c.city,
          industry: c.industry,
          website: c.website,
          owner: personName(c.owner),
          open_vacancies: c.vacancies.filter((v) => v.status === "open").length,
        })),
      });
    },
  );

  server.registerTool(
    "get_client",
    {
      title: "Klant",
      description: "One client with its contact persons, vacancies, placements and latest notes.",
      inputSchema: { id: idSchema },
      annotations: READ_ONLY,
    },
    async ({ id }) => {
      const client = check(
        await db
          .from("clients")
          .select("id, name, status, city, industry, website, notes, created_at, owner:profiles!clients_owner_id_fkey(full_name, email)")
          .eq("id", id)
          .maybeSingle(),
        "Klant",
      );
      if (!client || Array.isArray(client)) return fail("Klant niet gevonden.");

      const [contacts, vacancies, placements, notes] = await Promise.all([
        db
          .from("client_contacts")
          .select("id, full_name, email, phone, job_title, is_primary")
          .eq("client_id", id)
          .order("is_primary", { ascending: false })
          .order("full_name")
          .limit(100),
        db
          .from("vacancies")
          .select("id, title, status, seniority, opened_at, closed_at")
          .eq("client_id", id)
          .order("opened_at", { ascending: false })
          .limit(100),
        db
          .from("placements")
          .select("id, status, start_date, end_date, monthly_rate, candidate:candidates(id, full_name), vacancy:vacancies(title)")
          .eq("client_id", id)
          .order("start_date", { ascending: false })
          .limit(100),
        latestNotes(ctx, "client", id),
      ]);

      return ok({
        ...client,
        owner: personName(client.owner),
        notes: clip(client.notes),
        url: url("client", client.id),
        contacts: check(contacts, "Contactpersonen"),
        vacancies: check(vacancies, "Vacatures").map((v) => ({
          id: v.id,
          title: v.title,
          status: v.status,
          seniority: v.seniority,
          opened_at: v.opened_at,
          days_open: daysSince(v.opened_at, v.closed_at ?? new Date()),
        })),
        placements: check(placements, "Plaatsingen").map((p) => ({
          id: p.id,
          candidate_id: p.candidate?.id ?? null,
          candidate: p.candidate?.full_name ?? null,
          vacancy: p.vacancy?.title ?? null,
          status: p.status,
          start_date: p.start_date,
          end_date: p.end_date,
          monthly_rate: p.monthly_rate,
        })),
        recent_notes: notes,
      });
    },
  );

  // -------------------------------------------------------------------------
  server.registerTool(
    "list_vacancies",
    {
      title: "Vacatures",
      description:
        "List vacancies, oldest open first, with client, status, stack, days open and number of active candidates in the pipeline.",
      inputSchema: {
        query: z.string().max(80).optional().describe("Filter on vacancy title."),
        status: z.array(vacancyStatus).optional().describe("Statuses to include. Default: open and on_hold."),
        client_id: idSchema.optional().describe("Only vacancies of this client."),
        limit: limitSchema,
        offset: offsetSchema,
      },
      annotations: READ_ONLY,
    },
    async ({ query, status, client_id, limit, offset }) => {
      let q = db
        .from("vacancies")
        .select(
          "id, title, status, seniority, stack, opened_at, closed_at, talent_stage, client_id, company_id, client:clients(name), company:companies(name), applications(stage)",
          { count: "exact" },
        )
        .in("status", status && status.length > 0 ? status : ["open", "on_hold"])
        .order("opened_at", { ascending: true })
        .range(offset, offset + limit - 1);
      const pattern = searchPattern(query);
      if (pattern) q = q.ilike("title", pattern);
      if (client_id) q = q.eq("client_id", client_id);
      const r = await q;
      return ok({
        total: r.count,
        vacancies: check(r, "Vacatures").map((v) => ({
          id: v.id,
          title: v.title,
          client_id: v.client_id,
          client: v.client?.name ?? null,
          company_id: v.company_id,
          company: v.company?.name ?? null,
          status: v.status,
          talent_stage: v.talent_stage,
          seniority: v.seniority,
          stack: v.stack,
          opened_at: v.opened_at,
          days_open: daysSince(v.opened_at, v.closed_at ?? new Date()),
          in_pipeline: v.applications.filter((a) => a.stage !== "rejected").length,
        })),
      });
    },
  );

  server.registerTool(
    "get_vacancy",
    {
      title: "Vacature",
      description:
        "One vacancy with its profile (description, stack, must-haves, budget) and the pipeline grouped per stage (sourced to placed, plus rejected), with candidate ids, scores and client decision.",
      inputSchema: { id: idSchema },
      annotations: READ_ONLY,
    },
    async ({ id }) => {
      const vacancy = check(
        await db
          .from("vacancies")
          .select(
            "id, title, status, seniority, description, stack, must_haves, nice_to_haves, monthly_budget, budget_min, budget_max, hours, timezone_overlap, desired_start_date, opened_at, closed_at, talent_stage, intake_at, profiles_sent_at, first_interview_at, client:clients(id, name), company:companies(id, name, domain), owner:profiles!vacancies_owner_id_fkey(full_name, email)",
          )
          .eq("id", id)
          .maybeSingle(),
        "Vacature",
      );
      if (!vacancy || Array.isArray(vacancy)) return fail("Vacature niet gevonden.");

      const [applications, notes] = await Promise.all([
        db
          .from("applications")
          .select(
            "id, stage, position, technical_score, english_score, client_decision, client_feedback, rejection_reason, presented_at, updated_at, candidate:candidates(id, full_name, current_title, years_experience)",
          )
          .eq("vacancy_id", id)
          .order("position")
          .limit(300),
        latestNotes(ctx, "vacancy", id),
      ]);
      const rows = check(applications, "Pipeline");
      const pipeline = applicationStages.map((s) => {
        const inStage = rows.filter((a) => a.stage === s.value);
        return {
          stage: s.value as ApplicationStage,
          label: s.label,
          count: inStage.length,
          candidates: inStage.map((a) => ({
            application_id: a.id,
            candidate_id: a.candidate?.id ?? null,
            name: a.candidate?.full_name ?? null,
            title: a.candidate?.current_title ?? null,
            years_experience: a.candidate?.years_experience ?? null,
            technical_score: a.technical_score,
            english_score: a.english_score,
            client_decision: a.client_decision,
            client_feedback: clip(a.client_feedback, 500),
            rejection_reason: clip(a.rejection_reason, 300),
            presented_at: a.presented_at,
          })),
        };
      });

      return ok({
        ...vacancy,
        description: clip(vacancy.description, 4000),
        owner: personName(vacancy.owner),
        days_open: daysSince(vacancy.opened_at, vacancy.closed_at ?? new Date()),
        url: url("vacancy", vacancy.id),
        pipeline,
        recent_notes: notes,
      });
    },
  );

  // -------------------------------------------------------------------------
  server.registerTool(
    "list_candidates",
    {
      title: "Kandidaten",
      description:
        "List candidates (Indian tech talent), sorted by name, with title, experience, skills, status and number of active applications. query matches name, title and skills; skill is an exact (case-insensitive) skill.",
      inputSchema: {
        query: z.string().max(80).optional().describe("Matches name, current title or a skill (partial)."),
        status: candidateStatus.optional(),
        skill: z.string().max(60).optional().describe("Exact skill, e.g. React."),
        limit: limitSchema,
        offset: offsetSchema,
      },
      annotations: READ_ONLY,
    },
    async ({ query, status, skill, limit, offset }) => {
      const columns = "id, full_name, current_title, years_experience, skills, status, location, applications(stage)";
      const term = query?.trim().toLowerCase();
      const skillKey = skill?.trim().toLowerCase();

      let q = db.from("candidates").select(columns, { count: "exact" }).order("full_name");
      if (status) q = q.eq("status", status);
      // Skills are a text[]; PostgREST cannot match those case-insensitively,
      // so text filters run here on a bounded set, like the candidates page.
      const filtered = Boolean(term || skillKey);
      const r = await (filtered ? q.limit(2000) : q.range(offset, offset + limit - 1));
      let rows = check(r, "Kandidaten");
      let total = r.count;
      if (filtered) {
        rows = rows.filter(
          (c) =>
            (!skillKey || c.skills.some((s) => s.toLowerCase() === skillKey)) &&
            (!term ||
              c.full_name.toLowerCase().includes(term) ||
              (c.current_title ?? "").toLowerCase().includes(term) ||
              c.skills.some((s) => s.toLowerCase().includes(term))),
        );
        total = rows.length;
        rows = rows.slice(offset, offset + limit);
      }
      return ok({
        total,
        candidates: rows.map(({ applications, ...c }) => ({
          ...c,
          active_applications: applications.filter((a) => a.stage !== "placed" && a.stage !== "rejected").length,
        })),
      });
    },
  );

  server.registerTool(
    "get_candidate",
    {
      title: "Kandidaat",
      description: "One candidate with profile, skills, all applications (vacancy, client, stage, scores, client decision), placements and latest notes.",
      inputSchema: { id: idSchema },
      annotations: READ_ONLY,
    },
    async ({ id }) => {
      const candidate = check(
        await db
          .from("candidates")
          .select(
            "id, full_name, email, phone, location, current_title, years_experience, skills, linkedin_url, video_url, cv_path, summary, status, created_at, owner:profiles!candidates_owner_id_fkey(full_name, email)",
          )
          .eq("id", id)
          .maybeSingle(),
        "Kandidaat",
      );
      if (!candidate || Array.isArray(candidate)) return fail("Kandidaat niet gevonden.");

      const [applications, placements, notes] = await Promise.all([
        db
          .from("applications")
          .select(
            "id, stage, technical_score, english_score, assessment_notes, client_decision, client_feedback, rejection_reason, presented_at, updated_at, vacancy:vacancies(id, title, status, client:clients(name))",
          )
          .eq("candidate_id", id)
          .order("updated_at", { ascending: false })
          .limit(100),
        db
          .from("placements")
          .select("id, status, start_date, end_date, monthly_rate, guarantee_until, next_checkin_at, client:clients(id, name)")
          .eq("candidate_id", id)
          .order("start_date", { ascending: false })
          .limit(50),
        latestNotes(ctx, "candidate", id),
      ]);

      const { cv_path, owner, summary, ...rest } = candidate;
      return ok({
        ...rest,
        summary: clip(summary),
        has_cv: Boolean(cv_path),
        owner: personName(owner),
        url: url("candidate", candidate.id),
        applications: check(applications, "Sollicitaties").map((a) => ({
          application_id: a.id,
          vacancy_id: a.vacancy?.id ?? null,
          vacancy: a.vacancy?.title ?? null,
          vacancy_status: a.vacancy?.status ?? null,
          client: a.vacancy?.client?.name ?? null,
          stage: a.stage,
          technical_score: a.technical_score,
          english_score: a.english_score,
          assessment_notes: clip(a.assessment_notes, 1000),
          client_decision: a.client_decision,
          client_feedback: clip(a.client_feedback, 500),
          rejection_reason: clip(a.rejection_reason, 300),
          presented_at: a.presented_at,
          updated_at: a.updated_at,
        })),
        placements: check(placements, "Plaatsingen").map((p) => ({
          id: p.id,
          client_id: p.client?.id ?? null,
          client: p.client?.name ?? null,
          status: p.status,
          start_date: p.start_date,
          end_date: p.end_date,
          monthly_rate: p.monthly_rate,
          guarantee_until: p.guarantee_until,
          next_checkin_at: p.next_checkin_at,
        })),
        recent_notes: notes,
      });
    },
  );

  // -------------------------------------------------------------------------
  server.registerTool(
    "list_placements",
    {
      title: "Plaatsingen",
      description:
        "List placements (candidates working at a client), newest start first, with monthly rate, 30-day guarantee end and next check-in.",
      inputSchema: {
        status: z.array(placementStatus).optional().describe("Statuses to include. Default: active and notice."),
        client_id: idSchema.optional(),
        candidate_id: idSchema.optional(),
        limit: limitSchema,
        offset: offsetSchema,
      },
      annotations: READ_ONLY,
    },
    async ({ status, client_id, candidate_id, limit, offset }) => {
      let q = db
        .from("placements")
        .select(
          "id, status, start_date, end_date, monthly_rate, guarantee_until, next_checkin_at, notice_given_at, client:clients(id, name), candidate:candidates(id, full_name), vacancy:vacancies(id, title)",
          { count: "exact" },
        )
        .in("status", status && status.length > 0 ? status : ["active", "notice"])
        .order("start_date", { ascending: false })
        .range(offset, offset + limit - 1);
      if (client_id) q = q.eq("client_id", client_id);
      if (candidate_id) q = q.eq("candidate_id", candidate_id);
      const r = await q;
      return ok({
        total: r.count,
        placements: check(r, "Plaatsingen").map((p) => ({
          id: p.id,
          candidate_id: p.candidate?.id ?? null,
          candidate: p.candidate?.full_name ?? null,
          client_id: p.client?.id ?? null,
          client: p.client?.name ?? null,
          vacancy_id: p.vacancy?.id ?? null,
          vacancy: p.vacancy?.title ?? null,
          status: p.status,
          start_date: p.start_date,
          end_date: p.end_date,
          monthly_rate: p.monthly_rate,
          guarantee_until: p.guarantee_until,
          next_checkin_at: p.next_checkin_at,
          notice_given_at: p.notice_given_at,
          url: url("placement", p.id),
        })),
      });
    },
  );

  // -------------------------------------------------------------------------
  server.registerTool(
    "get_company",
    {
      title: "Bedrijf (GTM)",
      description:
        "One GTM company (sales prospect) with ICP qualification, its contacts and latest hiring signals. Use search with type company to find ids.",
      inputSchema: { id: idSchema },
      annotations: READ_ONLY,
    },
    async ({ id }) => {
      const company = check(
        await db
          .from("companies")
          .select(
            "id, name, domain, website, city, sector, segment, employees, linkedin_url, status, icp_decision, icp_score, icp_reason, red_flags, opening_line, client_id, qualified_at, created_at",
          )
          .eq("id", id)
          .maybeSingle(),
        "Bedrijf",
      );
      if (!company || Array.isArray(company)) return fail("Bedrijf niet gevonden.");

      const [contacts, signals, notes] = await Promise.all([
        db
          .from("contacts")
          .select("id, first_name, last_name, title, tier, email, email_status, phone, linkedin_url, status, last_contacted_at")
          .eq("company_id", id)
          .order("tier", { ascending: true, nullsFirst: false })
          .limit(50),
        db
          .from("signals")
          .select("id, type, title, source, source_url, first_seen_at, last_seen_at")
          .eq("company_id", id)
          .order("last_seen_at", { ascending: false })
          .limit(20),
        latestNotes(ctx, "company", id),
      ]);

      return ok({
        ...company,
        icp_reason: clip(company.icp_reason, 1000),
        url: url("company", company.id),
        contacts: check(contacts, "Contacten"),
        signals: check(signals, "Signalen"),
        recent_notes: notes,
      });
    },
  );

  // -------------------------------------------------------------------------
  server.registerTool(
    "list_tasks",
    {
      title: "Taken",
      description:
        "List tasks, earliest due date first. Filter on your own tasks (mine), status, due window or a linked record. Dates are YYYY-MM-DD in Europe/Amsterdam.",
      inputSchema: {
        mine: z.boolean().default(false).describe("Only tasks assigned to the token owner."),
        status: z
          .enum(["open", "todo", "in_progress", "done", "all"])
          .default("open")
          .describe("open = todo or in_progress (default)."),
        due: z
          .enum(["overdue", "today", "week", "none"])
          .optional()
          .describe("overdue = before today, today, week = today up to 7 days ahead, none = no due date."),
        entity_type: z.enum(linkableTypes).optional().describe("Only tasks linked to this record type (requires entity_id)."),
        entity_id: idSchema.optional(),
        limit: limitSchema,
        offset: offsetSchema,
      },
      annotations: READ_ONLY,
    },
    async ({ mine, status, due, entity_type, entity_id, limit, offset }) => {
      if (Boolean(entity_type) !== Boolean(entity_id)) return fail("Geef entity_type en entity_id samen op.");
      const today = amsterdamDate();
      let q = db
        .from("tasks")
        .select(
          "id, title, description, status, priority, due_date, entity_type, entity_id, completed_at, created_at, assignee_id, assignee:profiles!tasks_assignee_id_fkey(full_name, email)",
          { count: "exact" },
        )
        .order("due_date", { ascending: true, nullsFirst: false })
        .order("created_at")
        .range(offset, offset + limit - 1);
      if (mine) q = q.eq("assignee_id", ctx.userId);
      if (status === "open") q = q.neq("status", "done");
      else if (status !== "all") q = q.eq("status", status);
      if (due === "overdue") q = q.lt("due_date", today);
      if (due === "today") q = q.eq("due_date", today);
      if (due === "week") q = q.gte("due_date", today).lte("due_date", amsterdamDate(7));
      if (due === "none") q = q.is("due_date", null);
      if (entity_type && entity_id) q = q.eq("entity_type", entity_type).eq("entity_id", entity_id);

      const r = await q;
      const rows = check(r, "Taken");
      const labels = await resolveLabels(
        db,
        rows.flatMap((t) => (t.entity_type && t.entity_id ? [{ type: t.entity_type, id: t.entity_id }] : [])),
      );
      return ok({
        today,
        total: r.count,
        tasks: rows.map((t) => ({
          id: t.id,
          title: t.title,
          description: clip(t.description, 500),
          status: t.status,
          priority: t.priority,
          due_date: t.due_date,
          overdue: Boolean(t.due_date && t.status !== "done" && t.due_date < today),
          assignee_id: t.assignee_id,
          assignee: personName(t.assignee),
          linked:
            t.entity_type && t.entity_id
              ? {
                  type: t.entity_type,
                  id: t.entity_id,
                  label: labels.get(`${t.entity_type}:${t.entity_id}`) ?? null,
                }
              : null,
          completed_at: t.completed_at,
        })),
      });
    },
  );

  // -------------------------------------------------------------------------
  server.registerTool(
    "get_activity",
    {
      title: "Activiteit",
      description:
        "Activity log (who changed what, newest first). With entity_type and entity_id: the timeline of that record, including its pipeline (applications) and linked tasks. Without: the latest activity across the portal.",
      inputSchema: {
        entity_type: z.enum(["client", "vacancy", "candidate", "placement", "application", "task"]).optional(),
        entity_id: idSchema.optional(),
        limit: limitSchema,
      },
      annotations: READ_ONLY,
    },
    async ({ entity_type, entity_id, limit }) => {
      if (Boolean(entity_type) !== Boolean(entity_id)) return fail("Geef entity_type en entity_id samen op.");

      let q = db
        .from("activity_log")
        .select("id, entity_type, entity_id, action, summary, changes, created_at, actor:profiles!activity_log_actor_id_fkey(full_name, email)")
        .order("created_at", { ascending: false })
        .limit(limit);

      if (entity_type && entity_id) {
        const filters = [`and(entity_type.eq.${entity_type},entity_id.eq.${entity_id})`];
        if (entity_type === "vacancy" || entity_type === "candidate") {
          const apps = check(
            await db
              .from("applications")
              .select("id")
              .eq(entity_type === "vacancy" ? "vacancy_id" : "candidate_id", entity_id)
              .limit(100),
            "Sollicitaties",
          );
          if (apps.length) filters.push(`and(entity_type.eq.application,entity_id.in.(${apps.map((a) => a.id).join(",")}))`);
        }
        if (entity_type !== "task") {
          const tasks = check(
            await db.from("tasks").select("id").eq("entity_type", entity_type).eq("entity_id", entity_id).limit(100),
            "Taken",
          );
          if (tasks.length) filters.push(`and(entity_type.eq.task,entity_id.in.(${tasks.map((t) => t.id).join(",")}))`);
        }
        q = q.or(filters.join(","));
      }

      const rows = check(await q, "Activiteit");
      const labels = await resolveLabels(db, rows.map((a) => ({ type: a.entity_type, id: a.entity_id })));
      return ok({
        activity: rows.map((a) => ({
          at: a.created_at,
          type: a.entity_type,
          id: a.entity_id,
          record: labels.get(`${a.entity_type}:${a.entity_id}`) ?? null,
          action: a.action,
          summary: a.summary,
          changes: compactChanges(a.changes),
          by: personName(a.actor) ?? "systeem",
        })),
      });
    },
  );
}

/** Latest notes on a record, short. */
async function latestNotes(ctx: McpToolContext, entityType: (typeof linkableTypes)[number], entityId: string) {
  const rows = check(
    await ctx.db
      .from("notes")
      .select("id, body, created_at, author:profiles!notes_author_id_fkey(full_name, email)")
      .eq("entity_type", entityType)
      .eq("entity_id", entityId)
      .order("created_at", { ascending: false })
      .limit(10),
    "Notities",
  );
  return rows.map((n) => ({ id: n.id, at: n.created_at, by: personName(n.author), body: clip(n.body, 1000) }));
}

const HIDDEN_CHANGE_FIELDS = new Set(["updated_at", "position", "id", "completed_at", "guarantee_until", "cv_path", "raw_text", "search_brief"]);

/** {field: {from, to}} with long values shortened and noise fields dropped. */
function compactChanges(changes: Json): Record<string, { from: Json; to: Json }> | undefined {
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) return undefined;
  const short = (v: Json | undefined): Json => (typeof v === "string" ? clip(v, 200) : (v ?? null));
  const result: Record<string, { from: Json; to: Json }> = {};
  for (const [field, value] of Object.entries(changes)) {
    if (HIDDEN_CHANGE_FIELDS.has(field)) continue;
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    result[field] = { from: short(value.from), to: short(value.to) };
  }
  return Object.keys(result).length ? result : undefined;
}
