import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActivityOutcome, Database } from "@/lib/database.types";
import { normalizeDomain, normalizeEmail, normalizePhone, splitName } from "./normalize";

/**
 * Web Partners (S8): they call prospects and put booked appointments in a
 * Google Sheet with the reason for the call. After the sales call Nordavo
 * marks the appointment approved or rejected in the same sheet.
 *
 * This file holds the pure parser and the matching helpers. The job in
 * src/jobs/s8-webpartners-import.ts reads the sheet and writes activities.
 */

type Db = SupabaseClient<Database>;

export type WebPartnersRow = {
  /** 1-based sheet row, for the unmatched list. */
  rowNumber: number;
  date: string | null;
  company: string | null;
  name: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  reason: string | null;
  approval: "goedgekeurd" | "afgekeurd" | null;
  outcome: ActivityOutcome;
  externalId: string;
};

type Field = "date" | "company" | "name" | "phone" | "email" | "website" | "reason" | "status";

/** Header aliases, compared lowercased without punctuation. First match wins. */
const headerAliases: Record<Field, string[]> = {
  date: ["datum", "date", "afspraakdatum", "datum afspraak", "gepland op"],
  company: ["bedrijf", "bedrijfsnaam", "company", "organisatie", "onderneming"],
  name: ["naam", "contactpersoon", "contact", "name", "persoon"],
  phone: ["telefoon", "telefoonnummer", "tel", "phone", "mobiel", "nummer"],
  email: ["email", "e-mail", "mail", "emailadres", "e-mailadres", "mailadres"],
  website: ["website", "domein", "site", "url"],
  reason: ["reden", "reden van de call", "reden call", "toelichting", "notitie", "notities", "opmerking", "opmerkingen", "reason"],
  status: ["status", "goedgekeurd", "goedkeuring", "akkoord", "beoordeling", "approved"],
};

function cleanHeader(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9 -]/g, "").replace(/\s+/g, " ");
}

/** Column index per field. Exact alias first, then "starts with" for headers like "Reden van de call (kort)". */
export function mapHeaders(header: string[]): Partial<Record<Field, number>> {
  const cleaned = header.map(cleanHeader);
  const result: Partial<Record<Field, number>> = {};
  const taken = new Set<number>();
  for (const pass of ["exact", "prefix"] as const) {
    for (const field of Object.keys(headerAliases) as Field[]) {
      if (result[field] !== undefined) continue;
      for (const alias of headerAliases[field]) {
        const index = cleaned.findIndex(
          (h, i) => !taken.has(i) && (pass === "exact" ? h === alias : h.startsWith(alias)),
        );
        if (index >= 0) {
          result[field] = index;
          taken.add(index);
          break;
        }
      }
    }
  }
  return result;
}

/** "24-10-2026", "24/10/2026 14:00", "2026-10-24" to YYYY-MM-DD. */
export function parseSheetDate(value: string | null | undefined): string | null {
  const text = value?.trim();
  if (!text) return null;
  let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) return isoDate(+match[1], +match[2], +match[3]);
  match = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (match) {
    const year = match[3].length === 2 ? 2000 + +match[3] : +match[3];
    return isoDate(year, +match[2], +match[1]);
  }
  return null;
}

function isoDate(y: number, m: number, d: number) {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1) return null;
  return date.toISOString().slice(0, 10);
}

/** Approval column to our state. Checks the negative words first ("niet goedgekeurd"). */
export function parseApproval(value: string | null | undefined): "goedgekeurd" | "afgekeurd" | null {
  const text = value?.trim().toLowerCase();
  if (!text) return null;
  if (/afgekeurd|niet goed|\bnee\b|rejected|geweigerd|^no$|^x$/.test(text)) return "afgekeurd";
  if (/goedgekeurd|akkoord|^ja$|approved|^ok$|^yes$|^v$/.test(text)) return "goedgekeurd";
  return null;
}

/**
 * Stable id for one appointment: the identity fields, not the approval or
 * the reason, so marking a row approved later updates the same activity
 * instead of counting the appointment twice.
 */
export function rowExternalId(row: { date: string | null; company: string | null; name: string | null; phone: string | null; email: string | null }) {
  const key = [
    row.date ?? "",
    (row.company ?? "").trim().toLowerCase(),
    (row.name ?? "").trim().toLowerCase(),
    normalizePhone(row.phone) ?? "",
    normalizeEmail(row.email) ?? "",
  ].join("|");
  return `webpartners:${createHash("sha256").update(key).digest("hex").slice(0, 32)}`;
}

/** Sheet rows (header first) to appointments. Empty rows are skipped. Pure. */
export function parseWebPartnersRows(rows: string[][]): { rows: WebPartnersRow[]; missingHeaders: Field[] } {
  if (rows.length === 0) return { rows: [], missingHeaders: ["company"] };
  const columns = mapHeaders(rows[0]);
  const missingHeaders = (["company", "name", "phone"] as Field[]).filter((f) => columns[f] === undefined);
  const cell = (row: string[], field: Field) => {
    const index = columns[field];
    const value = index === undefined ? undefined : row[index];
    return value?.trim() ? value.trim() : null;
  };

  const parsed: WebPartnersRow[] = [];
  rows.slice(1).forEach((row, i) => {
    if (!row.some((v) => v?.trim())) return;
    const base = {
      date: parseSheetDate(cell(row, "date")),
      company: cell(row, "company"),
      name: cell(row, "name"),
      phone: cell(row, "phone"),
      email: cell(row, "email"),
    };
    if (!base.company && !base.name && !base.phone && !base.email) return;
    const approval = parseApproval(cell(row, "status"));
    // Open question 1 (briefing section 18): what exactly is a qualified
    // appointment? It decides status, reporting and Web Partners' payment.
    // Until that is settled: a booked row is "afspraak", and only Nordavo's
    // explicit verdict after the call turns it into goedgekeurd/afgekeurd.
    const outcome: ActivityOutcome =
      approval === "goedgekeurd" ? "afspraak_goedgekeurd" : approval === "afgekeurd" ? "afspraak_afgekeurd" : "afspraak";
    parsed.push({
      rowNumber: i + 2,
      ...base,
      website: cell(row, "website"),
      reason: cell(row, "reason"),
      approval,
      outcome,
      externalId: rowExternalId(base),
    });
  });
  return { rows: parsed, missingHeaders };
}

// ---------------------------------------------------------------------------
// Matching, shared with the Cal.com webhook
// ---------------------------------------------------------------------------

const freeMailDomains = new Set([
  "gmail.com", "googlemail.com", "hotmail.com", "hotmail.nl", "outlook.com", "outlook.nl", "live.com", "live.nl",
  "msn.com", "yahoo.com", "yahoo.nl", "icloud.com", "me.com", "ziggo.nl", "kpnmail.nl", "kpnplanet.nl", "planet.nl",
  "xs4all.nl", "home.nl", "upcmail.nl", "chello.nl", "hetnet.nl", "proton.me", "protonmail.com", "gmx.com", "gmx.net",
]);

export function isFreeMailDomain(domain: string | null | undefined) {
  return Boolean(domain && freeMailDomains.has(domain.toLowerCase()));
}

/** The company domain behind an email address, or null for free mail. */
export function companyDomainFromEmail(email: string | null | undefined): string | null {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  const domain = normalizeDomain(normalized.split("@")[1]);
  return domain && !isFreeMailDomain(domain) ? domain : null;
}

export async function findContactByEmail(db: Db, email: string | null | undefined) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  const { data, error } = await db.from("contacts").select("id, company_id").eq("email", normalized).limit(1).maybeSingle();
  if (error) throw error;
  return data;
}

export async function findContactByPhone(db: Db, phone: string | null | undefined) {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  const { data, error } = await db.from("contacts").select("id, company_id").eq("phone", normalized).limit(1).maybeSingle();
  if (error) throw error;
  return data;
}

export async function findCompanyByDomain(db: Db, domain: string | null | undefined) {
  const normalized = normalizeDomain(domain);
  if (!normalized) return null;
  const { data, error } = await db.from("companies").select("id").eq("domain", normalized).maybeSingle();
  if (error) throw error;
  return data;
}

async function findCompanyByName(db: Db, name: string | null) {
  const clean = name?.trim();
  if (!clean) return null;
  // Exact name, case insensitive. Escape LIKE wildcards in the name itself.
  const pattern = clean.replace(/[\\%_]/g, (c) => `\\${c}`);
  const { data, error } = await db.from("companies").select("id").ilike("name", pattern).limit(2);
  if (error) throw error;
  return data && data.length === 1 ? data[0] : null;
}

async function findContactAtCompany(db: Db, companyId: string, fullName: string | null) {
  const { first, last } = splitName(fullName);
  if (!first) return null;
  let query = db.from("contacts").select("id, company_id").eq("company_id", companyId).ilike("first_name", first);
  if (last) query = query.ilike("last_name", last);
  const { data, error } = await query.limit(2);
  if (error) throw error;
  return data && data.length === 1 ? data[0] : null;
}

export type RowMatch =
  | { kind: "contact"; contactId: string; companyId: string; via: "telefoon" | "email" | "naam" }
  | { kind: "company"; companyId: string; via: "domein" | "bedrijfsnaam" }
  | { kind: "none" };

/** Phone first (what Web Partners dialled), then email, then company domain or name. */
export async function matchWebPartnersRow(db: Db, row: WebPartnersRow): Promise<RowMatch> {
  const byPhone = await findContactByPhone(db, row.phone);
  if (byPhone) return { kind: "contact", contactId: byPhone.id, companyId: byPhone.company_id, via: "telefoon" };
  const byEmail = await findContactByEmail(db, row.email);
  if (byEmail) return { kind: "contact", contactId: byEmail.id, companyId: byEmail.company_id, via: "email" };

  const domain = companyDomainFromEmail(row.email) ?? normalizeDomain(row.website);
  let company = await findCompanyByDomain(db, domain);
  let via: "domein" | "bedrijfsnaam" = "domein";
  if (!company) {
    company = await findCompanyByName(db, row.company);
    via = "bedrijfsnaam";
  }
  if (!company) return { kind: "none" };
  const person = await findContactAtCompany(db, company.id, row.name);
  if (person) return { kind: "contact", contactId: person.id, companyId: person.company_id, via: "naam" };
  return { kind: "company", companyId: company.id, via };
}
