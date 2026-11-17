import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { buildSheetRows, groupSheetRows, type SheetCall, type SheetCompany, type SheetCompanyRow, type SheetVacancy } from "@/lib/sales/call-sheet";
import { loadViews } from "@/lib/sales/data";
import { listContacts, loadListMembers, loadQueue, type LoadedQueue } from "@/lib/sales/queue";
import type { ContactRow } from "@/lib/sales/rows";
import { vacancyKinds } from "@/lib/sales/signals";

// Loaders of the call sheet (feedback Julius, 896704e2). The team sees every
// contact of a call list, with the ones they can call now marked; an
// external caller sees their own queue only (read with the secret key after
// requireCaller()).

type Db = SupabaseClient<Database>;

async function companiesAndVacancies(db: Db, companyIds: string[]) {
  const companies = new Map<string, SheetCompany>();
  const vacancies = new Map<string, SheetVacancy[]>();
  const ids = [...new Set(companyIds)];
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const [co, sig] = await Promise.all([
      db.from("companies").select("id, name, domain, website, linkedin_url, opening_line, red_flags, general_phone, description, next_action, next_action_date").in("id", chunk),
      db
        .from("signals")
        .select("company_id, type, title, source_url, posted_at, first_seen_at, closed_at")
        .in("company_id", chunk)
        .is("closed_at", null)
        .order("first_seen_at", { ascending: true })
        .limit(5000),
    ]);
    if (co.error) throw new Error(co.error.message);
    for (const c of co.data ?? []) {
      companies.set(c.id, {
        id: c.id,
        name: c.name,
        openingLine: c.opening_line,
        redFlags: c.red_flags ?? [],
        generalPhone: c.general_phone,
        website: c.website ?? (c.domain && !c.domain.startsWith("nodomain:") ? c.domain : null),
        linkedinUrl: c.linkedin_url,
        description: c.description,
        nextAction: c.next_action,
        nextActionDate: c.next_action_date,
      });
    }
    // Without the closed_at column (older database) every signal counts as open.
    const signals = sig.error
      ? ((await db.from("signals").select("company_id, type, title, source_url, posted_at, first_seen_at").in("company_id", chunk).limit(5000)).data ?? [])
      : (sig.data ?? []);
    for (const s of signals) {
      // Funding, a new CTO and other signals are not a vacancy.
      if (!(vacancyKinds as readonly string[]).includes(s.type)) continue;
      vacancies.set(s.company_id, [
        ...(vacancies.get(s.company_id) ?? []),
        { title: s.title, url: s.source_url, since: s.posted_at ?? s.first_seen_at },
      ]);
    }
  }
  return { companies, vacancies };
}

/** The calls to these companies, newest first, with who called (a team member or an external caller). */
async function loadCalls(db: Db, companyIds: string[]): Promise<SheetCall[]> {
  const ids = [...new Set(companyIds)];
  const rows: { company_id: string; contact_id: string | null; outcome: string | null; notes: string | null; date: string; created_by: string | null; caller_id: string | null }[] = [];
  // 50 companies at a time, newest first: a response holds 1000 rows at most.
  for (let i = 0; i < ids.length; i += 50) {
    const { data, error } = await db
      .from("activities")
      .select("company_id, contact_id, outcome, notes, date, created_by, caller_id")
      .in("company_id", ids.slice(i, i + 50))
      .eq("channel", "bellen")
      .eq("type", "contact")
      .order("date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1000);
    if (error) throw new Error(error.message);
    for (const r of data ?? []) if (r.company_id) rows.push({ ...r, company_id: r.company_id });
  }
  const people = [...new Set(rows.map((r) => r.created_by).filter((v): v is string => Boolean(v)))];
  const callers = [...new Set(rows.map((r) => r.caller_id).filter((v): v is string => Boolean(v)))];
  const [profiles, callerRows] = await Promise.all([
    people.length > 0 ? db.from("profiles").select("id, full_name, email").in("id", people) : Promise.resolve({ data: [] }),
    callers.length > 0 ? db.from("callers").select("id, name").in("id", callers) : Promise.resolve({ data: [] }),
  ]);
  const who = new Map((profiles.data ?? []).map((p) => [p.id, p.full_name || p.email?.split("@")[0] || "Someone"]));
  const callerNames = new Map((callerRows.data ?? []).map((r) => [r.id, r.name]));
  return rows.map((r) => ({
    companyId: r.company_id,
    contactId: r.contact_id,
    outcome: r.outcome,
    notes: r.notes,
    at: r.date,
    by: (r.caller_id ? callerNames.get(r.caller_id) : null) ?? (r.created_by ? who.get(r.created_by) : null) ?? null,
  }));
}

/** Contacts whose mobile number a caller marked as wrong, among these companies. */
async function loadWrongPhones(db: Db, companyIds: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  const ids = [...new Set(companyIds)];
  for (let i = 0; i < ids.length; i += 200) {
    // Without the column (migration not applied) none is marked.
    const { data, error } = await db.from("contacts").select("id").in("company_id", ids.slice(i, i + 200)).not("phone_wrong_at", "is", null);
    if (!error) for (const c of data ?? []) out.add(c.id);
  }
  return out;
}

/**
 * Company rows from a loaded queue: the companies of `lead` in their order, each with
 * every contact it has. callable are the contacts in the queue.
 */
async function companyRows(db: Db, queue: LoadedQueue, lead: ContactRow[], callable: Set<string>, onlyCompanies?: Set<string>): Promise<SheetCompanyRow[]> {
  const order: string[] = [];
  for (const c of lead) if (!order.includes(c.company_id) && (!onlyCompanies || onlyCompanies.has(c.company_id))) order.push(c.company_id);
  const wanted = new Set(order);
  const byCompany = new Map<string, ContactRow[]>();
  for (const r of queue.rows.values()) {
    if (wanted.has(r.company_id)) byCompany.set(r.company_id, [...(byCompany.get(r.company_id) ?? []), r]);
  }
  // The contacts of a company as the call screen lists them: by tier.
  const contacts = order.flatMap((id) => (byCompany.get(id) ?? []).sort((a, b) => (a.tier ?? 9) - (b.tier ?? 9)));
  const [data, calls, wrong] = await Promise.all([companiesAndVacancies(db, order), loadCalls(db, order), loadWrongPhones(db, order)]);
  const rows = buildSheetRows(
    contacts.map((c) => ({ ...c, phone_wrong: wrong.has(c.id) })),
    data.companies,
    data.vacancies,
    callable,
    Date.now(),
    calls,
  );
  return groupSheetRows(rows);
}

/** Every company of a call list, in its order, with "callable now" for the team member. */
export async function loadListSheet(db: Db, listId: string, actorId: string): Promise<{ name: string; rows: SheetCompanyRow[] } | null> {
  const views = await loadViews(db, "contacts", { callListsOnly: true });
  const view = views.find((v) => v.id === listId);
  if (!view) return null;
  const [members, queue] = await Promise.all([loadListMembers(db, [listId]), loadQueue(db, { kind: "list", listId }, { actorId })]);
  const contacts = listContacts([...queue.rows.values()], view.config, members.get(listId));
  return { name: view.name, rows: await companyRows(db, queue, contacts, new Set(queue.entries.map((e) => e.contactId))) };
}

/** The queue of an external caller as a sheet: their companies in calling order. */
export async function loadCallerSheet(db: Db, callerId: string, actorId: string): Promise<SheetCompanyRow[]> {
  const queue = await loadQueue(db, { kind: "caller", callerId }, { actorId });
  const contacts = queue.entries.map((e) => queue.rows.get(e.contactId)).filter((r): r is ContactRow => Boolean(r));
  return companyRows(db, queue, contacts, new Set(contacts.map((c) => c.id)));
}

/** One company row again after a change (an outcome, a contact), for the scope the person works in. */
export async function reloadCompanyRow(
  db: Db,
  scope: { kind: "list"; listId: string } | { kind: "caller"; callerId: string },
  actorId: string,
  companyId: string,
): Promise<SheetCompanyRow | null> {
  const queue = await loadQueue(db, scope, { actorId });
  const lead = [...queue.rows.values()].filter((r) => r.company_id === companyId);
  const callable = new Set(queue.entries.map((e) => e.contactId));
  const rows = await companyRows(db, queue, lead, callable, new Set([companyId]));
  return rows[0] ?? null;
}
