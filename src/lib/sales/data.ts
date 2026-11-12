import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { CompanyRow, CompanyVacancy, ContactRow } from "@/lib/sales/rows";
import type { CompanyFactsRow } from "@/lib/sales/leads-database";
import { vacancyFacts } from "@/lib/sales/vacancies";
import { parseViewConfig, type ViewConfig } from "@/lib/sales/grid";
import type { SalesViewEntity } from "@/lib/sales/database";

type Db = SupabaseClient<Database>;

/** All rows of a query, 1000 at a time (PostgREST caps a response). */
async function all<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  max = 20000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < max; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/**
 * All rows, with the pages after the first fetched at the same time: the
 * count comes with the first page, so 5,000 rows take two round trips
 * instead of five (docs/sales.md, Snelheid). The query must have a stable
 * order (created_at, id).
 */
async function allParallel<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null; count?: number | null }>,
  max = 50000,
): Promise<T[]> {
  const first = await page(0, 999);
  if (first.error) throw new Error(first.error.message);
  const rows = [...(first.data ?? [])];
  const total = Math.min(first.count ?? rows.length, max);
  if (rows.length < 1000 || total <= 1000) return rows;
  const pages = [];
  for (let from = 1000; from < total; from += 1000) pages.push(page(from, from + 999));
  for (const result of await Promise.all(pages)) {
    if (result.error) throw new Error(result.error.message);
    rows.push(...(result.data ?? []));
  }
  return rows;
}

/** Counts, primary contact, last contact moment and open vacancies per company, in one query. */
export async function loadCompanyFacts(db: Db): Promise<Map<string, CompanyFactsRow>> {
  const rows = await allParallel((from, to) => db.rpc("sales_company_facts", {}, { count: "exact" }).range(from, to));
  return new Map(rows.map((r) => [r.company_id, r]));
}

function personName(first: string | null, last: string | null): string | null {
  return [first, last].filter(Boolean).join(" ").trim() || null;
}

/**
 * Open vacancies per company, oldest first: the vacancies linked to the
 * company itself and those of the client it became.
 */
export async function openVacanciesByCompany(
  db: Db,
  companies: { id: string; client_id: string | null }[],
): Promise<Map<string, CompanyVacancy[]>> {
  const out = new Map<string, CompanyVacancy[]>();
  if (companies.length === 0) return out;
  const rows = await all((from, to) =>
    db
      .from("vacancies")
      .select("id, title, opened_at, company_id, client_id")
      .eq("status", "open")
      .eq("is_talent_pool", false)
      .order("opened_at", { ascending: true })
      .range(from, to),
  10000);
  const byClient = new Map<string, string[]>();
  for (const c of companies) {
    if (c.client_id) byClient.set(c.client_id, [...(byClient.get(c.client_id) ?? []), c.id]);
  }
  const known = new Set(companies.map((c) => c.id));
  for (const v of rows) {
    const owners = new Set<string>();
    if (v.company_id && known.has(v.company_id)) owners.add(v.company_id);
    for (const id of v.client_id ? (byClient.get(v.client_id) ?? []) : []) owners.add(id);
    for (const id of owners) {
      out.set(id, [...(out.get(id) ?? []), { id: v.id, title: v.title, openedAt: v.opened_at }]);
    }
  }
  return out;
}

/** Every company with what the Leads and Pipeline tables show. */
export async function loadCompanyRows(db: Db, options: { pipelineOnly?: boolean } = {}): Promise<CompanyRow[]> {
  const [companies, facts, profiles, partners] = await Promise.all([
    allParallel((from, to) => {
      let q = db
        .from("companies")
        .select(
          "id, name, domain, website, prio, category, description, sector, employees, city, linkedin_url, general_phone, red_flags, opening_line, source_note, icp_decision, icp_score, lead_status, lead_status_changed_at, pipeline_stage, pipeline_stage_changed_at, pipeline_entered_at, lost_reason, parked_until, profiles_due_on, owner_id, partner_id, next_action, next_action_date, pinned_at, manual_position, client_id, source, created_at",
          { count: "exact" },
        )
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to);
      if (options.pipelineOnly) q = q.not("pipeline_stage", "is", null);
      return q;
    }),
    loadCompanyFacts(db),
    db.from("profiles").select("id, full_name, email").in("role", ["admin", "member"]),
    db.from("partners").select("id, name"),
  ]);

  // Only the pipeline shows the recruitment vacancies; the Leads table shows the vacancy signals.
  const vacancies = options.pipelineOnly ? await openVacanciesByCompany(db, companies) : new Map<string, CompanyVacancy[]>();
  const ownerName = new Map((profiles.data ?? []).map((p) => [p.id, p.full_name || p.email || null]));
  const partnerName = new Map((partners.data ?? []).map((p) => [p.id, p.name]));
  const now = Date.now();

  return companies.map((c) => {
    const f = facts.get(c.id);
    return {
      ...c,
      red_flags: c.red_flags ?? [],
      owner_name: c.owner_id ? (ownerName.get(c.owner_id) ?? null) : null,
      partner_name: c.partner_id ? (partnerName.get(c.partner_id) ?? null) : null,
      primary_contact: f?.primary_contact ?? null,
      contacts_count: f?.contacts_count ?? 0,
      signals_count: f?.signals_count ?? 0,
      last_activity_at: f?.last_activity_at ?? null,
      last_activity: f?.last_activity ?? null,
      open_vacancies: vacancies.get(c.id) ?? [],
      ...vacancyFacts(f?.open_vacancies ?? [], now),
    };
  });
}

/** Every contact, flat with the company fields the Contacts table and call lists use. */
export async function loadContactRows(db: Db, options: { contactIds?: string[] } = {}): Promise<ContactRow[]> {
  const [contacts, callers, facts] = await Promise.all([
    allParallel((from, to) => {
      let q = db
        .from("contacts")
        .select(
          "id, company_id, first_name, last_name, full_name, title, tier, role, route, phone, phone_type, email, email_status, linkedin_url, linkedin_member_urn, status, status_changed_at, attempts, last_attempt_at, callback_at, referred_to, caller_note, assigned_caller_id, assigned_until, claimed_by, claimed_at, is_primary, pinned_at, manual_position, last_contacted_at, created_at, company:companies!contacts_company_id_fkey(name, prio, category, lead_status, pipeline_stage, city, sector, icp_decision)",
          { count: "exact" },
        )
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to);
      if (options.contactIds) q = q.in("id", options.contactIds.length > 0 ? options.contactIds : ["00000000-0000-0000-0000-000000000000"]);
      return q;
    }),
    db.from("callers").select("id, name"),
    loadCompanyFacts(db),
  ]);
  const callerName = new Map((callers.data ?? []).map((c) => [c.id, c.name]));
  const now = Date.now();
  const vacanciesOf = new Map<string, ReturnType<typeof vacancyFacts>>();
  return contacts.map((c) => {
    const { company, ...rest } = c;
    let v = vacanciesOf.get(c.company_id);
    if (!v) {
      v = vacancyFacts(facts.get(c.company_id)?.open_vacancies ?? [], now);
      vacanciesOf.set(c.company_id, v);
    }
    return {
      ...rest,
      ...v,
      full_name: c.full_name ?? personName(c.first_name, c.last_name),
      company_name: company?.name ?? "",
      company_prio: company?.prio ?? null,
      company_category: company?.category ?? null,
      company_lead_status: company?.lead_status ?? "new",
      company_pipeline_stage: company?.pipeline_stage ?? null,
      company_city: company?.city ?? null,
      company_sector: company?.sector ?? null,
      company_icp: company?.icp_decision ?? null,
      assigned_caller_name: c.assigned_caller_id ? (callerName.get(c.assigned_caller_id) ?? null) : null,
    };
  });
}

export type SalesView = {
  id: string;
  entity: SalesViewEntity;
  name: string;
  config: ViewConfig;
  isCallList: boolean;
  isShared: boolean;
  position: number;
  ownerId: string | null;
};

export async function loadViews(db: Db, entity?: SalesViewEntity, options: { callListsOnly?: boolean } = {}): Promise<SalesView[]> {
  let q = db
    .from("sales_views")
    .select("id, entity, name, config, is_call_list, is_shared, position, owner_id")
    .order("position")
    .order("created_at");
  if (entity) q = q.eq("entity", entity);
  if (options.callListsOnly) q = q.eq("is_call_list", true);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []).map((v) => ({
    id: v.id,
    entity: v.entity,
    name: v.name,
    config: parseViewConfig(v.config),
    isCallList: v.is_call_list,
    isShared: v.is_shared,
    position: v.position,
    ownerId: v.owner_id,
  }));
}
