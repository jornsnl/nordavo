import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { SalesBucket } from "@/lib/sales/flow-database";
import { loadOccupancy } from "@/lib/sales/flow-data";
import { summarizeBuckets, summarizeSourceLists, type BucketSummary, type CompanyOccupancy, type InboxLead, type SourceListSummary } from "@/lib/sales/triage";

// The Incoming inbox (feedback Julius, 038aa8ea): every lead in exactly one
// bucket, per bucket how many and who works on it, and Incoming grouped per
// source list with how many still have no destination.

type Db = SupabaseClient<Database>;

export type InboxRow = {
  id: string;
  name: string;
  city: string | null;
  prio: number | null;
  leadStatus: string;
  bucket: SalesBucket;
  sourceList: string;
  worker: string | null;
  bucketUntil: string | null;
  bucketReason: string | null;
  createdAt: string;
  occupancy: CompanyOccupancy[];
};

export type Inbox = {
  rows: InboxRow[];
  buckets: BucketSummary[];
  sourceLists: SourceListSummary[];
};

export async function loadInbox(db: Db): Promise<Inbox> {
  const companies: {
    id: string;
    name: string;
    city: string | null;
    prio: number | null;
    lead_status: string;
    bucket: SalesBucket;
    source_list: string | null;
    bucket_until: string | null;
    bucket_reason: string | null;
    bucket_view_id: string | null;
    bucket_caller_id: string | null;
    bucket_campaign_id: string | null;
    owner_id: string | null;
    created_at: string;
  }[] = [];
  for (let from = 0; from < 50000; from += 1000) {
    const { data, error } = await db
      .from("companies")
      .select("id, name, city, prio, lead_status, bucket, source_list, bucket_until, bucket_reason, bucket_view_id, bucket_caller_id, bucket_campaign_id, owner_id, created_at")
      .order("created_at", { ascending: false })
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    companies.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }

  const [views, callers, campaigns, profiles, occupancy] = await Promise.all([
    db.from("sales_views").select("id, name").eq("is_call_list", true),
    db.from("callers").select("id, name"),
    db.from("campaigns").select("id, name"),
    db.from("profiles").select("id, full_name, email").in("role", ["admin", "member"]),
    loadOccupancy(db),
  ]);
  const viewName = new Map((views.data ?? []).map((v) => [v.id, v.name]));
  const callerName = new Map((callers.data ?? []).map((c) => [c.id, c.name]));
  const campaignName = new Map((campaigns.data ?? []).map((c) => [c.id, c.name]));
  const ownerName = new Map((profiles.data ?? []).map((p) => [p.id, p.full_name || p.email || "Someone"]));

  const workerOf = (c: (typeof companies)[number]): string | null => {
    switch (c.bucket) {
      case "find_number":
        return "Max";
      case "call":
        return c.bucket_caller_id
          ? (callerName.get(c.bucket_caller_id) ?? "Caller")
          : c.bucket_view_id
            ? (viewName.get(c.bucket_view_id) ?? "Call list")
            : "Team";
      case "mail_campaign":
      case "linkedin_campaign":
        return c.bucket_campaign_id ? (campaignName.get(c.bucket_campaign_id) ?? "Campaign") : null;
      default:
        return c.owner_id ? (ownerName.get(c.owner_id) ?? null) : null;
    }
  };

  const rows: InboxRow[] = companies.map((c) => ({
    id: c.id,
    name: c.name,
    city: c.city,
    prio: c.prio,
    leadStatus: c.lead_status,
    bucket: c.bucket,
    sourceList: c.source_list?.trim() || "No list",
    worker: workerOf(c),
    bucketUntil: c.bucket_until,
    bucketReason: c.bucket_reason,
    createdAt: c.created_at,
    occupancy: occupancy.get(c.id) ?? [],
  }));
  const leads: InboxLead[] = rows.map((r) => ({ id: r.id, bucket: r.bucket, source_list: r.sourceList, worker: r.worker }));
  return { rows, buckets: summarizeBuckets(leads), sourceLists: summarizeSourceLists(leads) };
}
