import "server-only";
import { requireStaff } from "@/lib/auth";
import type { ActivityChannel, ActivityOutcome, ActivitySource } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";
import { contactName } from "@/lib/data/gtm-contacts";

export type GtmActivityItem = {
  id: string;
  date: string;
  channel: ActivityChannel;
  outcome: ActivityOutcome;
  source: ActivitySource;
  notes: string | null;
  nextAction: string | null;
  nextActionDate: string | null;
  contactName: string | null;
  campaignName: string | null;
  createdByName: string | null;
};

/** Outreach for a company: activities on the company itself or on any of its contacts. */
export async function getCompanyActivities(
  companyId: string,
  contactIds: string[],
  limit = 100,
): Promise<GtmActivityItem[]> {
  await requireStaff();
  const supabase = await createClient();
  const filter =
    contactIds.length > 0
      ? `company_id.eq.${companyId},contact_id.in.(${contactIds.join(",")})`
      : `company_id.eq.${companyId}`;

  const { data, error } = await supabase
    .from("activities")
    .select(
      "id, date, channel, outcome, source, notes, next_action, next_action_date, contact:contacts(first_name, last_name), campaign:campaigns(name), author:profiles!activities_created_by_fkey(full_name, email)",
    )
    .or(filter)
    .order("date", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Activiteiten laden mislukt: ${error.message}`);

  return data.map((a) => ({
    id: a.id,
    date: a.date,
    channel: a.channel,
    outcome: a.outcome,
    source: a.source,
    notes: a.notes,
    nextAction: a.next_action,
    nextActionDate: a.next_action_date,
    contactName: a.contact ? contactName(a.contact) : null,
    campaignName: a.campaign?.name ?? null,
    createdByName: a.author ? a.author.full_name || a.author.email || null : null,
  }));
}
