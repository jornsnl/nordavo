import "server-only";
import { requireStaff } from "@/lib/auth";
import type { ActivityOutcome, CampaignChannel } from "@/lib/database.types";
import { evaluateCampaign, type CampaignVerdict } from "@/lib/gtm/lists";
import { createClient } from "@/lib/supabase/server";

export type CampaignStats = {
  id: string;
  name: string;
  channel: CampaignChannel;
  signalType: string | null;
  segment: string | null;
  variant: string | null;
  externalId: string | null;
  startedAt: string | null;
  leads: number;
  replies: number;
  positive: number;
  meetings: number;
  verdict: CampaignVerdict;
};

const PAGE = 1000;
const MAX_ROWS = 100_000;

type ActivityRow = { campaign_id: string | null; contact_id: string | null; outcome: ActivityOutcome; date: string };
type AppointmentRow = { contact_id: string | null; date: string };

const REPLIES: ActivityOutcome[] = ["reply_positief", "reply_neutraal", "reply_negatief"];

/**
 * Per campaign: leads (contacts that got "verstuurd"), replies and positive
 * replies (distinct contacts), and meetings: contacts from the campaign with
 * an appointment (appointment_attribution) on or after their send date.
 */
export async function listCampaignStats(): Promise<CampaignStats[]> {
  await requireStaff();
  const supabase = await createClient();

  const { data: campaigns, error } = await supabase
    .from("campaigns")
    .select("id, name, channel, signal_type, segment, message_variant, external_id, started_at, created_at")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Campagnes laden mislukt: ${error.message}`);
  if (campaigns.length === 0) return [];

  const activities: ActivityRow[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error: actError } = await supabase
      .from("activities")
      .select("campaign_id, contact_id, outcome, date")
      .not("campaign_id", "is", null)
      .in("outcome", ["verstuurd", ...REPLIES])
      .order("date")
      .range(from, from + PAGE - 1);
    if (actError) throw new Error(`Activiteiten laden mislukt: ${actError.message}`);
    activities.push(...data);
    if (data.length < PAGE) break;
  }

  const appointments: AppointmentRow[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error: apptError } = await supabase
      .from("appointment_attribution")
      .select("contact_id, date")
      .order("date")
      .range(from, from + PAGE - 1);
    if (apptError) throw new Error(`Afspraken laden mislukt: ${apptError.message}`);
    appointments.push(...data);
    if (data.length < PAGE) break;
  }
  const appointmentsByContact = new Map<string, string[]>();
  for (const a of appointments) {
    if (!a.contact_id) continue;
    const list = appointmentsByContact.get(a.contact_id) ?? [];
    list.push(a.date);
    appointmentsByContact.set(a.contact_id, list);
  }

  type Acc = { sent: Map<string, string>; replies: Set<string>; positive: Set<string> };
  const acc = new Map<string, Acc>();
  for (const a of activities) {
    if (!a.campaign_id || !a.contact_id) continue;
    const entry = acc.get(a.campaign_id) ?? { sent: new Map(), replies: new Set(), positive: new Set() };
    if (a.outcome === "verstuurd") {
      const prev = entry.sent.get(a.contact_id);
      if (!prev || a.date < prev) entry.sent.set(a.contact_id, a.date);
    } else {
      entry.replies.add(a.contact_id);
      if (a.outcome === "reply_positief") entry.positive.add(a.contact_id);
    }
    acc.set(a.campaign_id, entry);
  }

  return campaigns.map((c) => {
    const entry = acc.get(c.id);
    let meetings = 0;
    for (const [contactId, sentAt] of entry?.sent ?? []) {
      if ((appointmentsByContact.get(contactId) ?? []).some((d) => d >= sentAt)) meetings += 1;
    }
    const leads = entry?.sent.size ?? 0;
    const replies = entry?.replies.size ?? 0;
    return {
      id: c.id,
      name: c.name,
      channel: c.channel,
      signalType: c.signal_type,
      segment: c.segment,
      variant: c.message_variant,
      externalId: c.external_id,
      startedAt: c.started_at ?? c.created_at,
      leads,
      replies,
      positive: entry?.positive.size ?? 0,
      meetings,
      verdict: evaluateCampaign(leads, replies),
    };
  });
}
