import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

/**
 * OnePageCRM: Julius' workspace. Only qualified contacts go in (hard rule 8),
 * and every contact always has a next action with a date.
 *
 * PLACEHOLDER: implemented by the CRM engineer. Signatures are the contract.
 */

export function hasOnePage() {
  return Boolean(process.env.ONEPAGE_USER_ID && process.env.ONEPAGE_API_KEY);
}

/**
 * Create (or update) the contact and its company in OnePageCRM with a next
 * action, write onepage_id back to Supabase and log an activity.
 */
export async function pushContactToCrm(
  db: SupabaseClient<Database>,
  contactId: string,
  options: { reason: string; nextAction?: { text: string; date: string } },
): Promise<{ onepageId: string }> {
  void db;
  void contactId;
  void options;
  throw new Error("OnePageCRM is nog niet gebouwd");
}

/** Add a note to a deal, for example "Anoniem profiel verstuurd: <link>". */
export async function addDealNote(dealId: string, text: string): Promise<void> {
  void dealId;
  void text;
  throw new Error("OnePageCRM is nog niet gebouwd");
}

/** Set the next action on a OnePageCRM contact (YYYY-MM-DD). */
export async function setNextAction(onepageContactId: string, action: { text: string; date: string }): Promise<void> {
  void onepageContactId;
  void action;
  throw new Error("OnePageCRM is nog niet gebouwd");
}
