import "server-only";
import { requireStaff } from "@/lib/auth";
import type { ContactStatus, EmailStatus, PhoneType } from "@/lib/database.types";
import { formatDate } from "@/lib/format";
import { contactStatuses, emailStatuses, optionFor, suppressionReasons } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";
import { getCompanySuppressions, orFilterPattern, type SuppressionItem } from "@/lib/data/companies";

export const CONTACTS_PAGE_SIZE = 100;

export function isContactStatus(value: unknown): value is ContactStatus {
  return contactStatuses.some((s) => s.value === value);
}

export function isEmailStatus(value: unknown): value is EmailStatus {
  return emailStatuses.some((s) => s.value === value);
}

export function contactName(c: { first_name: string | null; last_name: string | null }) {
  return [c.first_name, c.last_name].filter(Boolean).join(" ") || "Naam onbekend";
}

export type ContactFilters = {
  q?: string;
  status?: ContactStatus;
  tier?: 1 | 2 | 3;
  hasEmail?: boolean;
  emailStatus?: EmailStatus;
  hasMobile?: boolean;
  inOnePage?: boolean;
  page?: number;
};

export type ContactListItem = {
  id: string;
  name: string;
  title: string | null;
  tier: number | null;
  status: ContactStatus;
  email: string | null;
  emailStatus: EmailStatus | null;
  phone: string | null;
  phoneType: PhoneType | null;
  onepageId: string | null;
  lastContactedAt: string | null;
  company: { id: string; name: string; domain: string } | null;
};

export async function listGtmContacts(
  filters: ContactFilters,
): Promise<{ items: ContactListItem[]; total: number }> {
  await requireStaff();
  const supabase = await createClient();
  const page = Math.max(1, filters.page ?? 1);
  const from = (page - 1) * CONTACTS_PAGE_SIZE;

  let query = supabase
    .from("contacts")
    .select(
      "id, first_name, last_name, title, tier, status, email, email_status, phone, phone_type, onepage_id, last_contacted_at, company:companies(id, name, domain)",
      { count: "exact" },
    );

  if (filters.q) {
    const q = filters.q;
    const p = orFilterPattern(q);
    const parts = [`first_name.ilike.${p}`, `last_name.ilike.${p}`, `email.ilike.${p}`];
    const words = q.split(/\s+/).filter(Boolean);
    if (words.length >= 2) {
      const first = orFilterPattern(words[0]);
      const last = orFilterPattern(words.slice(1).join(" "));
      parts.push(`and(first_name.ilike.${first},last_name.ilike.${last})`);
    }
    // Company names live in another table: look up matching ids first.
    const { data: companies } = await supabase
      .from("companies")
      .select("id")
      .or(`name.ilike.${p},domain.ilike.${p}`)
      .limit(100);
    if (companies && companies.length > 0) {
      parts.push(`company_id.in.(${companies.map((c) => c.id).join(",")})`);
    }
    query = query.or(parts.join(","));
  }
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.tier) query = query.eq("tier", filters.tier);
  if (filters.hasEmail === true) query = query.not("email", "is", null);
  if (filters.hasEmail === false) query = query.is("email", null);
  if (filters.emailStatus) query = query.eq("email_status", filters.emailStatus);
  if (filters.hasMobile === true) query = query.eq("phone_type", "mobiel").not("phone", "is", null);
  if (filters.hasMobile === false) query = query.or("phone.is.null,phone_type.neq.mobiel,phone_type.is.null");
  if (filters.inOnePage === true) query = query.not("onepage_id", "is", null);
  if (filters.inOnePage === false) query = query.is("onepage_id", null);

  const { data, error, count } = await query
    .order("updated_at", { ascending: false })
    .range(from, from + CONTACTS_PAGE_SIZE - 1);
  if (error) throw new Error(`Contacten laden mislukt: ${error.message}`);

  const items = data.map((c) => ({
    id: c.id,
    name: contactName(c),
    title: c.title,
    tier: c.tier,
    status: c.status,
    email: c.email,
    emailStatus: c.email_status,
    phone: c.phone,
    phoneType: c.phone_type,
    onepageId: c.onepage_id,
    lastContactedAt: c.last_contacted_at,
    company: c.company,
  }));
  return { items, total: count ?? items.length };
}

/** Why a contact can or cannot be approached on one channel right now. */
export type Contactability = {
  ok: boolean;
  /** Dutch reason when not contactable, e.g. "in uitsluiting: afgemeld". */
  reason: string | null;
};

export type CompanyContact = {
  id: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
  title: string | null;
  tier: number | null;
  linkedinUrl: string | null;
  email: string | null;
  emailSource: string | null;
  emailStatus: EmailStatus | null;
  emailFoundAt: string | null;
  phone: string | null;
  phoneType: PhoneType | null;
  phoneSource: string | null;
  phoneFoundAt: string | null;
  status: ContactStatus;
  onepageId: string | null;
  lastContactedAt: string | null;
  bellen: Contactability;
  mail: Contactability;
};

const CHANNEL_SCOPES = {
  bellen: ["alle_kanalen", "alleen_bellen"],
  mail: ["alle_kanalen", "alleen_mail"],
} as const;

/**
 * The database decides (is_contactable implements rule 4); the reason is
 * reconstructed from the suppression rows and the last contact date, the same
 * inputs the function uses.
 */
function explain(
  ok: boolean | null,
  channel: "bellen" | "mail",
  contact: { id: string; email: string | null; last_contacted_at: string | null },
  companyId: string,
  suppressions: SuppressionItem[],
): Contactability {
  if (ok === true) return { ok: true, reason: null };
  const scopes: readonly string[] = CHANNEL_SCOPES[channel];
  const hit = suppressions.find(
    (s) =>
      scopes.includes(s.scope) &&
      (s.contactId === contact.id ||
        s.companyId === companyId ||
        (s.email !== null && contact.email !== null && s.email.toLowerCase() === contact.email)),
  );
  if (hit) {
    const target = hit.contactId === contact.id ? "contact" : hit.companyId === companyId ? "bedrijf" : "mailadres";
    return { ok: false, reason: `In uitsluiting (${target}): ${optionFor(suppressionReasons, hit.reason).label.toLowerCase()}` };
  }
  if (contact.last_contacted_at) {
    return { ok: false, reason: `Benaderd op ${formatDate(contact.last_contacted_at)}` };
  }
  if (ok === null) return { ok: false, reason: "Niet te controleren" };
  return { ok: false, reason: "Recent benaderd" };
}

export async function getCompanyContacts(
  companyId: string,
): Promise<{ contacts: CompanyContact[]; suppressions: SuppressionItem[] }> {
  await requireStaff();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("contacts")
    .select(
      "id, first_name, last_name, title, tier, linkedin_url, email, email_source, email_status, email_found_at, phone, phone_type, phone_source, phone_found_at, status, onepage_id, last_contacted_at",
    )
    .eq("company_id", companyId)
    .order("tier", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Contacten laden mislukt: ${error.message}`);

  const [suppressions, checks] = await Promise.all([
    getCompanySuppressions(companyId, data.map((c) => ({ id: c.id, email: c.email }))),
    Promise.all(
      data.map(async (c) => {
        const [bellen, mail] = await Promise.all([
          supabase.rpc("is_contactable", { p_contact_id: c.id, p_channel: "bellen" }),
          supabase.rpc("is_contactable", { p_contact_id: c.id, p_channel: "mail" }),
        ]);
        return {
          bellen: bellen.error ? null : bellen.data,
          mail: mail.error ? null : mail.data,
        };
      }),
    ),
  ]);

  const contacts = data.map((c, i) => ({
    id: c.id,
    name: contactName(c),
    firstName: c.first_name,
    lastName: c.last_name,
    title: c.title,
    tier: c.tier,
    linkedinUrl: c.linkedin_url,
    email: c.email,
    emailSource: c.email_source,
    emailStatus: c.email_status,
    emailFoundAt: c.email_found_at,
    phone: c.phone,
    phoneType: c.phone_type,
    phoneSource: c.phone_source,
    phoneFoundAt: c.phone_found_at,
    status: c.status,
    onepageId: c.onepage_id,
    lastContactedAt: c.last_contacted_at,
    bellen: explain(checks[i].bellen, "bellen", c, companyId, suppressions),
    mail: explain(checks[i].mail, "mail", c, companyId, suppressions),
  }));
  return { contacts, suppressions };
}
