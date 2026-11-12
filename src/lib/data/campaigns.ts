import "server-only";
import { requireModule } from "@/lib/auth";
import type { CampaignMemberStatus, CampaignProvider, CampaignStatus } from "@/lib/sales/flow-database";
import { createClient } from "@/lib/supabase/server";

// Campaigns in Instantly (mail) and Seleqt (LinkedIn) with the leads in them
// and who replied (feedback Julius, 4f7fd90a). Claude registers them through
// the MCP; the fallback job s8-instantly-campaigns syncs Instantly.

export type CampaignListItem = {
  id: string;
  name: string;
  channel: "mail" | "linkedin" | "bellen";
  provider: CampaignProvider;
  status: CampaignStatus;
  externalId: string | null;
  startedAt: string | null;
  syncedAt: string | null;
  counts: Record<CampaignMemberStatus, number> & { total: number };
};

const emptyCounts = (): CampaignListItem["counts"] => ({
  total: 0,
  queued: 0,
  active: 0,
  replied: 0,
  finished: 0,
  stopped: 0,
  bounced: 0,
  unsubscribed: 0,
});

export async function listCampaigns(options: { includeFinished?: boolean } = {}): Promise<CampaignListItem[]> {
  await requireModule("sales");
  const db = await createClient();
  let q = db
    .from("campaigns")
    .select("id, name, channel, provider, status, external_id, started_at, synced_at, created_at")
    .order("created_at", { ascending: false })
    .limit(500);
  if (!options.includeFinished) q = q.neq("status", "finished");
  const { data, error } = await q;
  if (error) {
    // Before the migration: no provider or status columns.
    if (/provider|status|does not exist/.test(error.message)) return [];
    throw new Error(error.message);
  }
  const campaigns = data ?? [];
  const counts = new Map<string, CampaignListItem["counts"]>();
  const ids = campaigns.map((c) => c.id);
  for (let i = 0; i < ids.length; i += 100) {
    for (let from = 0; from < 100000; from += 1000) {
      const { data: members, error: membersError } = await db
        .from("campaign_members")
        .select("campaign_id, status")
        .in("campaign_id", ids.slice(i, i + 100))
        .range(from, from + 999);
      if (membersError) break;
      for (const m of members ?? []) {
        const c = counts.get(m.campaign_id) ?? emptyCounts();
        c.total += 1;
        c[m.status] += 1;
        counts.set(m.campaign_id, c);
      }
      if (!members || members.length < 1000) break;
    }
  }
  return campaigns.map((c) => ({
    id: c.id,
    name: c.name,
    channel: c.channel,
    provider: c.provider,
    status: c.status,
    externalId: c.external_id,
    startedAt: c.started_at,
    syncedAt: c.synced_at,
    counts: counts.get(c.id) ?? emptyCounts(),
  }));
}

export type CampaignMember = {
  id: string;
  companyId: string;
  companyName: string;
  contactName: string | null;
  email: string | null;
  status: CampaignMemberStatus;
  addedAt: string;
  endedAt: string | null;
  repliedAt: string | null;
  replyOutcome: string | null;
};

export type CampaignDetail = Omit<CampaignListItem, "counts"> & {
  description: string | null;
  endedAt: string | null;
  members: CampaignMember[];
};

export async function getCampaign(id: string): Promise<CampaignDetail | null> {
  await requireModule("sales");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const db = await createClient();
  const { data: c, error } = await db
    .from("campaigns")
    .select("id, name, channel, provider, status, external_id, started_at, synced_at, description, ended_at")
    .eq("id", id)
    .maybeSingle();
  if (error || !c) return null;
  const members: CampaignMember[] = [];
  for (let from = 0; from < 20000; from += 1000) {
    const { data, error: membersError } = await db
      .from("campaign_members")
      .select(
        "id, company_id, status, added_at, ended_at, replied_at, reply_outcome, company:companies!campaign_members_company_id_fkey(name), contact:contacts!campaign_members_contact_id_fkey(first_name, last_name, email)",
      )
      .eq("campaign_id", id)
      .order("replied_at", { ascending: false, nullsFirst: false })
      .order("added_at", { ascending: false })
      .range(from, from + 999);
    if (membersError) throw new Error(membersError.message);
    for (const m of data ?? []) {
      members.push({
        id: m.id,
        companyId: m.company_id,
        companyName: m.company?.name ?? "Company",
        contactName: m.contact ? [m.contact.first_name, m.contact.last_name].filter(Boolean).join(" ") || null : null,
        email: m.contact?.email ?? null,
        status: m.status,
        addedAt: m.added_at,
        endedAt: m.ended_at,
        repliedAt: m.replied_at,
        replyOutcome: m.reply_outcome,
      });
    }
    if (!data || data.length < 1000) break;
  }
  return {
    id: c.id,
    name: c.name,
    channel: c.channel,
    provider: c.provider,
    status: c.status,
    externalId: c.external_id,
    startedAt: c.started_at,
    syncedAt: c.synced_at,
    description: c.description,
    endedAt: c.ended_at,
    members,
  };
}
