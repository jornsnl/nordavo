import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Database,
  EmailStatus,
  PhoneType,
  SignalSource,
  SignalType,
  TablesInsert,
} from "@/lib/database.types";
import {
  cleanLinkedinUrl,
  isLinkedinCaseRepair,
  normalizeDomain,
  normalizeEmail,
  normalizeLinkedin,
  normalizePhone,
  phoneTypeFor,
  signalDedupeKey,
} from "./normalize";

/**
 * The only way GTM records are written (hard rules 1 to 3):
 * companies are unique on their normalised domain, people on their LinkedIn
 * URL, a duplicate fills in what is missing and never creates a second
 * record, and every email and phone number keeps its source and date.
 */

type Db = SupabaseClient<Database>;

/** Fields from `incoming` that are empty on `existing`. Never overwrites a value. */
export function missingFields<T extends Record<string, unknown>>(
  existing: Record<string, unknown>,
  incoming: T,
): { [K in keyof T]?: NonNullable<T[K]> } {
  const patch: { [K in keyof T]?: NonNullable<T[K]> } = {};
  for (const key of Object.keys(incoming) as (keyof T & string)[]) {
    const next = incoming[key];
    if (next === undefined || next === null || next === "") continue;
    const current = existing[key];
    if (current === undefined || current === null || current === "") patch[key] = next as NonNullable<T[typeof key]>;
  }
  return patch;
}

function withSource(sources: string[] | null | undefined, source: string) {
  const list = sources ?? [];
  return list.includes(source) ? list : [...list, source];
}

export type CompanyInput = {
  domain: string;
  name?: string | null;
  website?: string | null;
  legal_form?: string | null;
  employees?: number | null;
  sector?: string | null;
  kvk_number?: string | null;
  linkedin_url?: string | null;
  city?: string | null;
};

export async function upsertCompany(db: Db, input: CompanyInput, source: string) {
  const domain = normalizeDomain(input.domain ?? input.website);
  if (!domain) throw new Error(`Invalid domain: ${input.domain}`);

  const { data: existing, error: findError } = await db
    .from("companies")
    .select("id, name, website, legal_form, employees, sector, kvk_number, linkedin_url, city, sources")
    .or(`domain.eq.${domain},alias_domains.cs.{${domain}}`)
    .limit(1)
    .maybeSingle();
  if (findError) throw findError;

  const incoming = {
    name: input.name?.trim() || null,
    website: input.website ?? null,
    legal_form: input.legal_form ?? null,
    employees: input.employees ?? null,
    sector: input.sector ?? null,
    kvk_number: input.kvk_number ?? null,
    linkedin_url: cleanLinkedinUrl(input.linkedin_url),
    city: input.city ?? null,
  };

  if (existing) {
    const patch = missingFields(existing, incoming);
    const sources = withSource(existing.sources, source);
    if (Object.keys(patch).length > 0 || sources.length !== existing.sources.length) {
      const { error } = await db.from("companies").update({ ...patch, sources }).eq("id", existing.id);
      if (error) throw error;
    }
    return { id: existing.id, created: false };
  }

  const row: TablesInsert<"companies"> = {
    ...incoming,
    domain,
    name: incoming.name ?? domain,
    source,
    sources: [source],
  };
  const { data, error } = await db.from("companies").insert(row).select("id").single();
  if (error) {
    // Lost a race with a parallel insert: treat as existing.
    if (error.code === "23505") return upsertCompany(db, input, source);
    throw error;
  }
  return { id: data.id, created: true };
}

export type ContactInput = {
  /** Enrich this exact contact (for example S4 adding an email to a known person). */
  id?: string;
  company_id: string;
  first_name?: string | null;
  last_name?: string | null;
  title?: string | null;
  tier?: 1 | 2 | 3 | null;
  linkedin_url?: string | null;
  email?: string | null;
  email_status?: EmailStatus | null;
  phone?: string | null;
  phone_type?: PhoneType | null;
};

export async function upsertContact(db: Db, input: ContactInput, source: string) {
  const linkedin = normalizeLinkedin(input.linkedin_url);
  const email = normalizeEmail(input.email);
  const phone = normalizePhone(input.phone);
  const now = new Date().toISOString();

  // Same person: LinkedIn link first (any case: linkedin_key); without one, the same email at the same company.
  let query = db
    .from("contacts")
    .select("id, first_name, last_name, title, tier, linkedin_url, email, email_status, phone, phone_type, sources")
    .limit(1);
  if (input.id) query = query.eq("id", input.id);
  else if (linkedin) query = query.eq("linkedin_key", linkedin);
  else if (email) query = query.eq("company_id", input.company_id).eq("email", email);
  else query = query.eq("company_id", input.company_id).eq("first_name", input.first_name ?? "").eq("last_name", input.last_name ?? "");
  const { data: found, error: findError } = await query.maybeSingle();
  if (findError) throw findError;

  const incoming = {
    first_name: input.first_name?.trim() || null,
    last_name: input.last_name?.trim() || null,
    title: input.title?.trim() || null,
    tier: input.tier ?? null,
    linkedin_url: cleanLinkedinUrl(input.linkedin_url),
  };

  if (found) {
    const patch: Record<string, unknown> = missingFields(found, incoming);
    // An old Apify link stored in lowercase gets its case back.
    if (isLinkedinCaseRepair(found.linkedin_url, incoming.linkedin_url)) patch.linkedin_url = incoming.linkedin_url;
    if (email && !found.email) {
      Object.assign(patch, { email, email_source: source, email_found_at: now, email_status: input.email_status ?? "unknown" });
    }
    if (phone && !found.phone) {
      Object.assign(patch, { phone, phone_source: source, phone_found_at: now, phone_type: input.phone_type ?? phoneTypeFor(phone) });
    }
    const sources = withSource(found.sources, source);
    if (Object.keys(patch).length > 0 || sources.length !== found.sources.length) {
      const { error } = await db.from("contacts").update({ ...patch, sources }).eq("id", found.id);
      if (error) throw error;
    }
    return { id: found.id, created: false };
  }

  const row: TablesInsert<"contacts"> = {
    ...incoming,
    company_id: input.company_id,
    source,
    sources: [source],
    ...(email ? { email, email_source: source, email_found_at: now, email_status: input.email_status ?? "unknown" } : {}),
    ...(phone ? { phone, phone_source: source, phone_found_at: now, phone_type: input.phone_type ?? phoneTypeFor(phone) } : {}),
  };
  const { data, error } = await db.from("contacts").insert(row).select("id").single();
  if (error) {
    if (error.code === "23505") return upsertContact(db, input, source);
    throw error;
  }
  return { id: data.id, created: true };
}

export type SignalInput = {
  company_id: string;
  company_domain: string;
  type: SignalType;
  title?: string | null;
  source: SignalSource;
  source_url?: string | null;
  raw_json?: unknown;
  seen_at?: string;
  /** Role group of the vacancy (for example "Backend", "Data & BI"). */
  role_group?: string | null;
  /** Date the vacancy went online (YYYY-MM-DD). */
  posted_at?: string | null;
  /** The vacancy text. */
  description?: string | null;
  /** true: offline now; false or undefined with a new sighting: open again. */
  closed?: boolean;
};

/**
 * Same vacancy seen again only updates last_seen_at (and fills in the date
 * online, role group and text when they were empty). The same link at
 * another company is another vacancy, never an update of the first one.
 */
export async function upsertSignal(db: Db, input: SignalInput): Promise<{ id: string; created: boolean }> {
  const baseKey = signalDedupeKey({
    source: input.source,
    sourceUrl: input.source_url,
    companyDomain: input.company_domain,
    title: input.title,
  });
  const seenAt = input.seen_at ?? new Date().toISOString();

  let dedupeKey = baseKey;
  let { data: existing } = await db
    .from("signals")
    .select("id, company_id, role_group, posted_at, description, closed_at")
    .eq("dedupe_key", dedupeKey)
    .maybeSingle();
  if (existing && existing.company_id !== input.company_id) {
    dedupeKey = `${baseKey}#${input.company_domain}`;
    ({ data: existing } = await db
      .from("signals")
      .select("id, company_id, role_group, posted_at, description, closed_at")
      .eq("dedupe_key", dedupeKey)
      .maybeSingle());
  }
  if (existing) {
    const { error } = await db
      .from("signals")
      .update({
        last_seen_at: seenAt,
        ...(input.role_group && !existing.role_group ? { role_group: input.role_group } : {}),
        ...(input.posted_at && !existing.posted_at ? { posted_at: input.posted_at } : {}),
        ...(input.description && !existing.description ? { description: input.description } : {}),
        ...(input.closed === true && !existing.closed_at ? { closed_at: seenAt } : {}),
        ...(input.closed !== true && existing.closed_at ? { closed_at: null } : {}),
      })
      .eq("id", existing.id);
    if (error) throw error;
    return { id: existing.id, created: false };
  }

  const { data, error } = await db
    .from("signals")
    .insert({
      company_id: input.company_id,
      type: input.type,
      title: input.title ?? null,
      source: input.source,
      source_url: input.source_url ?? null,
      dedupe_key: dedupeKey,
      first_seen_at: seenAt,
      last_seen_at: seenAt,
      role_group: input.role_group ?? null,
      posted_at: input.posted_at ?? null,
      description: input.description ?? null,
      closed_at: input.closed ? seenAt : null,
      raw_json: (input.raw_json ?? null) as Database["public"]["Tables"]["signals"]["Insert"]["raw_json"],
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") return upsertSignal(db, input);
    throw error;
  }
  return { id: data.id, created: true };
}
