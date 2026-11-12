import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { buildSheetRows, type SheetCompany, type SheetRow, type SheetVacancy } from "@/lib/sales/call-sheet";
import { loadContactRows, loadViews } from "@/lib/sales/data";
import { listContacts, loadListMembers, loadQueue } from "@/lib/sales/queue";
import type { ContactRow } from "@/lib/sales/rows";

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
      db.from("companies").select("id, name, domain, website, linkedin_url, opening_line, red_flags, general_phone").in("id", chunk),
      db
        .from("signals")
        .select("company_id, title, source_url, posted_at, first_seen_at, closed_at")
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
      });
    }
    // Without the closed_at column (older database) every signal counts as open.
    const signals = sig.error
      ? ((await db.from("signals").select("company_id, title, source_url, posted_at, first_seen_at").in("company_id", chunk).limit(5000)).data ?? [])
      : (sig.data ?? []);
    for (const s of signals) {
      vacancies.set(s.company_id, [
        ...(vacancies.get(s.company_id) ?? []),
        { title: s.title, url: s.source_url, since: s.posted_at ?? s.first_seen_at },
      ]);
    }
  }
  return { companies, vacancies };
}

function sheet(contacts: ContactRow[], callable: Set<string>, data: Awaited<ReturnType<typeof companiesAndVacancies>>): SheetRow[] {
  return buildSheetRows(contacts, data.companies, data.vacancies, callable);
}

/** Every contact of a call list, in its order, with "callable now" for the team member. */
export async function loadListSheet(db: Db, listId: string, actorId: string): Promise<{ name: string; rows: SheetRow[] } | null> {
  const views = await loadViews(db, "contacts", { callListsOnly: true });
  const view = views.find((v) => v.id === listId);
  if (!view) return null;
  const [rows, members, queue] = await Promise.all([
    loadContactRows(db),
    loadListMembers(db, [listId]),
    loadQueue(db, { kind: "list", listId }, { actorId }),
  ]);
  const contacts = listContacts(rows, view.config, members.get(listId));
  const data = await companiesAndVacancies(db, contacts.map((c) => c.company_id));
  return { name: view.name, rows: sheet(contacts, new Set(queue.entries.map((e) => e.contactId)), data) };
}

/** The queue of an external caller as a sheet: only what they may call now, in calling order. */
export async function loadCallerSheet(db: Db, callerId: string, actorId: string): Promise<SheetRow[]> {
  const queue = await loadQueue(db, { kind: "caller", callerId }, { actorId });
  const contacts = queue.entries.map((e) => queue.rows.get(e.contactId)).filter((r): r is ContactRow => Boolean(r));
  const data = await companiesAndVacancies(db, contacts.map((c) => c.company_id));
  return sheet(contacts, new Set(contacts.map((c) => c.id)), data);
}
