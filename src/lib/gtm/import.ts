import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

/**
 * Migration of the old Google Sheets lead lists (briefing section 13):
 * normalise domains, deduplicate through upsertCompany / upsertContact,
 * record the sheet as source, and log earlier calls or mails as activities.
 *
 * PLACEHOLDER: implemented by the ingest engineer. Signatures are the contract.
 */

/** One CSV row: column name -> cell value. */
export type LeadImportRow = Record<string, string>;

/** Which CSV column holds which field. Values are column names from the file. */
export type LeadImportMapping = {
  domain: string;
  company_name?: string;
  legal_form?: string;
  employees?: string;
  sector?: string;
  city?: string;
  company_linkedin?: string;
  full_name?: string;
  first_name?: string;
  last_name?: string;
  title?: string;
  person_linkedin?: string;
  email?: string;
  phone?: string;
  /** Date the contact was last called or mailed in the old process. */
  last_contacted_at?: string;
  /** "bellen" or "mail"; defaults to "bellen" when last_contacted_at is set. */
  contact_channel?: string;
  /** Free text outcome from the sheet, stored as the activity note. */
  contact_outcome?: string;
};

export type LeadImportResult = {
  rows: number;
  companiesCreated: number;
  companiesUpdated: number;
  contactsCreated: number;
  contactsUpdated: number;
  activitiesCreated: number;
  skipped: { row: number; reason: string }[];
};

/** Suggest a mapping from the header row (Dutch and English column names). */
export function guessMapping(headers: string[]): Partial<LeadImportMapping> {
  void headers;
  return {};
}

export async function importLeadRows(
  db: SupabaseClient<Database>,
  rows: LeadImportRow[],
  mapping: LeadImportMapping,
  source: string,
): Promise<LeadImportResult> {
  void db;
  void rows;
  void mapping;
  void source;
  throw new Error("Import is nog niet gebouwd");
}
