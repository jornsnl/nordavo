import type { SupabaseClient } from "@supabase/supabase-js";
import type { ContactStatus, Database } from "@/lib/database.types";

// Contact statuses only move forward through outreach (section 2.6). Shared by
// the syncs (Instantly, Web Partners, Cal.com) and the enrichment jobs. Pure
// except promoteContactStatus.

const statusOrder: ContactStatus[] = ["new", "qualified", "enrich", "enriched", "in_outreach", "reached"];

/**
 * Whether a contact in `current` may move to `target`. Do not contact never
 * changes; Not interested and Not reached only reopen when the contact is
 * reached again; everything else only moves forward.
 */
export function shouldPromoteStatus(current: ContactStatus, target: ContactStatus): boolean {
  if (current === target || current === "do_not_contact") return false;
  if (target === "do_not_contact" || target === "not_interested") return true;
  if (current === "not_interested" || current === "not_reached") return target === "reached";
  const from = statusOrder.indexOf(current);
  const to = statusOrder.indexOf(target);
  return to > from;
}

/** Move a contact forward; never backwards. */
export async function promoteContactStatus(
  db: SupabaseClient<Database>,
  contactId: string,
  target: ContactStatus,
): Promise<boolean> {
  const { data, error } = await db.from("contacts").select("status").eq("id", contactId).maybeSingle();
  if (error) throw error;
  if (!data || !shouldPromoteStatus(data.status, target)) return false;
  const { error: updateError } = await db.from("contacts").update({ status: target }).eq("id", contactId);
  if (updateError) throw updateError;
  return true;
}

/** YYYY-MM-DD in Amsterdam. */
export function amsterdamDate(value: Date | string = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Amsterdam" }).format(new Date(value));
}

/** Add working days (Monday to Friday) to a YYYY-MM-DD date. */
export function addWorkingDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T12:00:00Z`);
  let left = days;
  while (left > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    const day = date.getUTCDay();
    if (day !== 0 && day !== 6) left -= 1;
  }
  return date.toISOString().slice(0, 10);
}
