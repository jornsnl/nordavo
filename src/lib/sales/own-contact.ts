import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

// Own contact (migration 20261124700000_leads_own_contact_edit.sql): a company
// we have contact with ourselves (pipeline, partner, network, client). It never
// goes into a cold mail or LinkedIn campaign, on a call list or in a find-number
// batch. The database refuses it; these helpers check first, so a batch skips
// the protected leads with a message instead of failing as a whole.

type Db = SupabaseClient<Database>;

/** The triage destinations that are cold outreach. */
export const COLD_DESTINATIONS = ["find_number", "call", "mail_campaign", "linkedin_campaign"] as const;

export function isColdDestination(destination: string): boolean {
  return (COLD_DESTINATIONS as readonly string[]).includes(destination);
}

export type SkippedLead = { id: string; name: string; reason: string };

export function ownContactSkip(company: { id: string; name: string; own_contact_reason?: string | null }): SkippedLead {
  return {
    id: company.id,
    name: company.name,
    reason: `Own contact${company.own_contact_reason ? `: ${company.own_contact_reason}` : ""}`,
  };
}

/** Splits company ids in the ones that may be approached cold and the own contacts. */
export async function splitOwnContacts(
  db: Db,
  companyIds: string[],
): Promise<{ allowed: string[]; skipped: SkippedLead[] }> {
  const unique = [...new Set(companyIds)];
  const skipped: SkippedLead[] = [];
  for (let i = 0; i < unique.length; i += 200) {
    const { data, error } = await db
      .from("companies")
      .select("id, name, own_contact_reason")
      .in("id", unique.slice(i, i + 200))
      .eq("own_contact", true);
    if (error) throw new Error(error.message);
    for (const c of data ?? []) skipped.push(ownContactSkip(c));
  }
  const blocked = new Set(skipped.map((s) => s.id));
  return { allowed: unique.filter((id) => !blocked.has(id)), skipped };
}

type Member = { contact_id?: string; company_id?: string; email?: string; status?: string };

/**
 * Campaign members that would be new cold outreach: no status or a running
 * one (queued, active). Members that only report a reply, a bounce or an end
 * are not blocked. Returns the members that may go on and the skipped ones.
 */
export async function filterOwnContactMembers<M extends Member>(
  db: Db,
  members: M[],
): Promise<{ allowed: M[]; skipped: (SkippedLead & { member: M })[] }> {
  const cold = (m: M) => m.status === undefined || m.status === "queued" || m.status === "active";
  const coldMembers = members.filter(cold);
  if (coldMembers.length === 0) return { allowed: members, skipped: [] };

  const contactIds = [...new Set(coldMembers.map((m) => m.contact_id).filter((v): v is string => Boolean(v)))];
  const emails = [...new Set(coldMembers.map((m) => m.email?.trim().toLowerCase()).filter((v): v is string => Boolean(v)))];
  const companyOfContact = new Map<string, string>();
  const companyOfEmail = new Map<string, string>();
  for (let i = 0; i < contactIds.length; i += 200) {
    const { data } = await db.from("contacts").select("id, company_id").in("id", contactIds.slice(i, i + 200));
    for (const c of data ?? []) companyOfContact.set(c.id, c.company_id);
  }
  for (let i = 0; i < emails.length; i += 200) {
    const { data } = await db.from("contacts").select("email, company_id").in("email", emails.slice(i, i + 200));
    for (const c of data ?? []) if (c.email) companyOfEmail.set(c.email.toLowerCase(), c.company_id);
  }
  const companyOf = (m: M) =>
    m.company_id ??
    (m.contact_id ? companyOfContact.get(m.contact_id) : undefined) ??
    (m.email ? companyOfEmail.get(m.email.trim().toLowerCase()) : undefined);

  const ids = [...new Set(coldMembers.map(companyOf).filter((v): v is string => Boolean(v)))];
  const { skipped: own } = await splitOwnContacts(db, ids);
  const ownById = new Map(own.map((o) => [o.id, o]));

  const allowed: M[] = [];
  const skipped: (SkippedLead & { member: M })[] = [];
  for (const m of members) {
    const company = cold(m) ? companyOf(m) : undefined;
    const hit = company ? ownById.get(company) : undefined;
    if (hit) skipped.push({ ...hit, member: m });
    else allowed.push(m);
  }
  return { allowed, skipped };
}
