import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import Papa from "papaparse";
import type { Database, PhoneType } from "@/lib/database.types";
import {
  chunk,
  isSuppressedFor,
  linkedinUrl,
  loadSuppressions,
  MAX_LIMIT,
  recordListExport,
  toCsv,
  type MaxCandidate,
} from "./lists";
import { isExcludedFromCalling, normalizeLinkedin, normalizePhone, phoneTypeFor } from "./normalize";
import { upsertContact } from "./upsert";

/**
 * S5: phone enrichment by Max (external partner, waterfall). Out: a CSV with
 * exactly the columns Max agreed on. Back: his CSV, matched on the person's
 * LinkedIn URL (normalised), phone saved through upsertContact with source
 * "max" so it keeps its source and date (rule 3) and never overwrites.
 */

type Db = SupabaseClient<Database>;

export const MAX_CSV_HEADER = ["firstname", "lastname", "company", "website", "company linkedin", "person linkedin"];

export function maxCsvRows(candidates: MaxCandidate[]): string[][] {
  return candidates.map((c) => [
    c.first_name ?? "",
    c.last_name ?? "",
    c.company_name,
    c.website || `https://${c.domain}`,
    c.company_linkedin ? linkedinUrl(c.company_linkedin) : "",
    linkedinUrl(c.linkedin_url),
  ]);
}

export function buildMaxCsv(candidates: MaxCandidate[]): string {
  return toCsv(MAX_CSV_HEADER, maxCsvRows(candidates));
}

/**
 * Who goes to Max (feedback Julius, section 2.6): contacts with status
 * Enrich, and the contacts of companies with lead status Enrich, without a
 * phone number. Max matches on the person's LinkedIn URL, so contacts without
 * one are counted apart. Suppressed contacts (calls) and contacts we may not
 * approach are left out.
 */
export async function fetchEnrichCandidates(
  db: Db,
  limit = MAX_LIMIT,
): Promise<{ candidates: MaxCandidate[]; withoutLinkedin: number }> {
  const select =
    "id, company_id, first_name, last_name, title, tier, linkedin_url, email, status, company:companies!contacts_company_id_fkey!inner(name, domain, website, linkedin_url, legal_form, segment, icp_score, lead_status)" as const;
  const [byStatus, byCompany, suppressions] = await Promise.all([
    db.from("contacts").select(select).eq("status", "enrich").is("phone", null).limit(MAX_LIMIT),
    db
      .from("contacts")
      .select(select)
      .eq("company.lead_status", "enrich")
      .is("phone", null)
      .not("status", "in", "(do_not_contact,not_interested,not_reached)")
      .limit(MAX_LIMIT),
    loadSuppressions(db),
  ]);
  if (byStatus.error) throw new Error(`Could not load contacts to enrich: ${byStatus.error.message}`);
  if (byCompany.error) throw new Error(`Could not load contacts to enrich: ${byCompany.error.message}`);

  const seen = new Set<string>();
  const candidates: MaxCandidate[] = [];
  let withoutLinkedin = 0;
  for (const c of [...byStatus.data, ...byCompany.data]) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    const company = Array.isArray(c.company) ? c.company[0] : c.company;
    if (!company) continue;
    if (company.lead_status === "do_not_contact" || company.lead_status === "no_go") continue;
    // Companies we may never call (eenmanszaak, vof): a number would only cost money at Max.
    if (isExcludedFromCalling(company.legal_form)) continue;
    if (isSuppressedFor({ contactId: c.id, companyId: c.company_id, email: c.email }, suppressions, "bellen")) continue;
    if (!c.linkedin_url) {
      withoutLinkedin += 1;
      continue;
    }
    candidates.push({
      contact_id: c.id,
      company_id: c.company_id,
      first_name: c.first_name,
      last_name: c.last_name,
      title: c.title,
      tier: c.tier,
      linkedin_url: c.linkedin_url,
      email: c.email,
      company_name: company.name,
      domain: company.domain,
      website: company.website,
      company_linkedin: company.linkedin_url,
      segment: company.segment,
      icp_score: company.icp_score,
      legal_form: company.legal_form,
    });
  }
  candidates.sort((a, b) => (b.icp_score ?? -1) - (a.icp_score ?? -1) || (a.tier ?? 9) - (b.tier ?? 9));
  return { candidates: candidates.slice(0, limit), withoutLinkedin };
}

/** The CSV for Max of everyone in Enrich, logged in list_exports (type max_verrijking). */
export async function exportEnrichList(
  db: Db,
  { createdBy = null, limit = MAX_LIMIT }: { createdBy?: string | null; limit?: number },
): Promise<{ exportId: string | null; count: number; csv: string | null; filename: string }> {
  const filename = `nordavo-max-${new Date().toISOString().slice(0, 10)}.csv`;
  const { candidates } = await fetchEnrichCandidates(db, limit);
  if (candidates.length === 0) return { exportId: null, count: 0, csv: null, filename };
  const csv = buildMaxCsv(candidates);
  const exportId = await recordListExport(db, {
    type: "max_verrijking",
    filter: { limit },
    extra: { source: "enrich" },
    recordIds: candidates.map((c) => c.contact_id),
    destination: `csv:${filename}`,
    createdBy,
  });
  return { exportId, count: candidates.length, csv, filename };
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

/** "Person LinkedIn" -> "personlinkedin" */
function headerKey(header: string) {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const LINKEDIN_HEADERS = ["personlinkedin", "personlinkedinurl", "linkedin", "linkedinurl", "linkedinprofile", "profileurl"];
const PHONE_HEADERS = ["phone", "phonenumber", "mobile", "mobilephone", "mobilenumber", "mobiel", "telefoon", "telefoonnummer", "directphone", "phone1"];
const TYPE_HEADERS = ["phonetype", "type", "numbertype", "telefoontype", "linetype"];

export type MaxRow = { line: number; linkedin: string | null; phone: string | null; phoneType: PhoneType | null };

/** "Mobile", "mobiel", "cell" -> mobiel; "landline", "vast", "office", "direct" -> vast. */
export function phoneTypeFromText(value: string | null | undefined): PhoneType | null {
  const text = (value ?? "").toLowerCase();
  if (/mobi|cell|gsm/.test(text)) return "mobiel";
  if (/vast|land|office|kantoor|direct|work|fixed/.test(text)) return "vast";
  return null;
}

function pick(row: Record<string, string>, keys: Map<string, string>, candidates: string[]): string | null {
  for (const key of candidates) {
    const header = keys.get(key);
    const value = header ? row[header]?.trim() : undefined;
    if (value) return value;
  }
  return null;
}

/** Parse Max's CSV. Throws when there is no LinkedIn or phone column. */
export function parseMaxCsv(text: string): MaxRow[] {
  const parsed = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });
  const headers = parsed.meta.fields ?? [];
  const keys = new Map<string, string>();
  for (const h of headers) if (!keys.has(headerKey(h))) keys.set(headerKey(h), h);
  if (!LINKEDIN_HEADERS.some((k) => keys.has(k))) throw new Error("No column with the person's LinkedIn URL found (expected: person linkedin).");
  if (!PHONE_HEADERS.some((k) => keys.has(k))) throw new Error("No column with a phone number found (expected: phone or mobile).");

  return parsed.data.map((row, i) => {
    const phone = normalizePhone(pick(row, keys, PHONE_HEADERS));
    const typed = phoneTypeFromText(pick(row, keys, TYPE_HEADERS));
    return {
      line: i + 2,
      linkedin: normalizeLinkedin(pick(row, keys, LINKEDIN_HEADERS)),
      phone,
      phoneType: phone ? (typed ?? phoneTypeFor(phone)) : null,
    };
  });
}

export type MaxImportResult = {
  rows: number;
  matched: number;
  updated: number;
  alreadyHadPhone: number;
  noPhone: number;
  unmatched: number;
  unmatchedSamples: string[];
  /** Companies of the contacts that got a number. */
  companyIds: string[];
};

export async function importMaxCsv(db: Db, text: string): Promise<MaxImportResult> {
  const rows = parseMaxCsv(text);
  const result: MaxImportResult = { rows: rows.length, matched: 0, updated: 0, alreadyHadPhone: 0, noPhone: 0, unmatched: 0, unmatchedSamples: [], companyIds: [] };

  const urls = [...new Set(rows.map((r) => r.linkedin).filter((u): u is string => Boolean(u)))];
  const contacts = new Map<string, { id: string; company_id: string; phone: string | null }>();
  for (const ids of chunk(urls, 100)) {
    const { data, error } = await db.from("contacts").select("id, company_id, phone, linkedin_url").in("linkedin_url", ids);
    if (error) throw new Error(`Could not look up contacts: ${error.message}`);
    for (const c of data) if (c.linkedin_url) contacts.set(c.linkedin_url, c);
  }

  for (const row of rows) {
    const contact = row.linkedin ? contacts.get(row.linkedin) : undefined;
    if (!contact) {
      result.unmatched += 1;
      if (result.unmatchedSamples.length < 10) result.unmatchedSamples.push(row.linkedin ?? `line ${row.line}`);
      continue;
    }
    result.matched += 1;
    if (!row.phone) {
      result.noPhone += 1;
      continue;
    }
    if (contact.phone) {
      result.alreadyHadPhone += 1;
      continue;
    }
    await upsertContact(
      db,
      { company_id: contact.company_id, linkedin_url: row.linkedin, phone: row.phone, phone_type: row.phoneType },
      "max",
    );
    await db.from("contacts").update({ status: "enriched" }).eq("id", contact.id).in("status", ["new", "qualified", "enrich"]);
    contact.phone = row.phone;
    result.updated += 1;
    if (!result.companyIds.includes(contact.company_id)) result.companyIds.push(contact.company_id);
  }
  return result;
}
