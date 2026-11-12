// Buckets, triage and occupancy of leads (feedback Julius, 038aa8ea and
// 264ce8e7). Pure, safe for client components; the rules themselves are in
// the database (supabase/migrations/20261123400000_sales_triage_occupancy.sql).

import type { Tone } from "@/lib/labels";
import type { OccupancyRow, SalesBucket, TriageDestination } from "@/lib/sales/flow-database";

type Option<T extends string> = { value: T; label: string; tone: Tone; description: string };

/** Every bucket or flow a lead can be in, in the order of the inbox. */
export const salesBuckets: Option<SalesBucket>[] = [
  { value: "incoming", label: "Incoming", tone: "warning", description: "New, waits for a destination" },
  { value: "find_number", label: "Find number", tone: "neutral", description: "To Max for a phone number" },
  { value: "call", label: "Call", tone: "brand", description: "On a call list or with a caller" },
  { value: "mail_campaign", label: "Mail campaign", tone: "accent", description: "In a mail campaign in Instantly" },
  { value: "linkedin_campaign", label: "LinkedIn campaign", tone: "accent", description: "In a LinkedIn campaign in Seleqt" },
  { value: "sequence", label: "Sequence", tone: "accent", description: "In a portal sequence" },
  { value: "pipeline", label: "Pipeline", tone: "success", description: "Warm, followed up in the pipeline" },
  { value: "parked", label: "Parked", tone: "neutral", description: "Back on a date" },
  { value: "no_go", label: "No go", tone: "danger", description: "Not a fit, with a reason" },
  { value: "free", label: "Free", tone: "brand", description: "Was approached without result, ready for a new destination" },
];

/** What a person picks in triage, for one lead or a selection. */
export const triageDestinations: (Option<TriageDestination> & { needs?: "list_or_caller" | "campaign" | "date" | "reason" })[] = [
  { value: "find_number", label: "Find number (Max)", tone: "neutral", description: "No number yet: goes to Max" },
  { value: "call", label: "Call", tone: "brand", description: "On a call list, or with one of the external callers", needs: "list_or_caller" },
  { value: "mail_campaign", label: "Mail campaign (Instantly)", tone: "accent", description: "Claude adds them in Instantly", needs: "campaign" },
  { value: "linkedin_campaign", label: "LinkedIn campaign (Seleqt)", tone: "accent", description: "Claude adds them in Seleqt", needs: "campaign" },
  { value: "parked", label: "Park until", tone: "neutral", description: "Comes back as the next action on that date", needs: "date" },
  { value: "no_go", label: "No go", tone: "danger", description: "Not a fit; the reason is kept", needs: "reason" },
  { value: "incoming", label: "Back to incoming", tone: "warning", description: "No destination yet" },
];

export function bucketOption(value: string | null | undefined) {
  return salesBuckets.find((b) => b.value === value) ?? salesBuckets[0];
}

/** Buckets where a lead counts as free for a new campaign or call list. */
export const freeBuckets: SalesBucket[] = ["incoming", "free"];

export type CompanyOccupancy = {
  kind: OccupancyRow["kind"];
  channel: string;
  label: string;
  since: string;
  until: string | null;
  repliedAt: string | null;
  status: string;
  active: boolean;
};

/** A lead is free when it is in Incoming or Free and nothing runs for it. */
export function isFree(bucket: SalesBucket | null | undefined, occupancy: CompanyOccupancy[]): boolean {
  return freeBuckets.includes(bucket ?? "incoming") && !occupancy.some((o) => o.active);
}

const channelText: Record<string, string> = {
  bellen: "Call",
  mail: "Mail",
  linkedin: "LinkedIn",
  sequence: "Sequence",
};

/** "Mail: Q4 CTO's (since 12 Nov, replied)" for the table and the lead page. */
export function occupancyText(o: CompanyOccupancy): string {
  const parts = [`${channelText[o.channel] ?? o.channel}: ${o.label}`];
  const extra: string[] = [];
  if (o.repliedAt) extra.push("replied");
  else if (!o.active) extra.push(o.status === "finished" ? "ended without reply" : o.status);
  if (o.until && o.active) extra.push(`until ${o.until.slice(0, 10)}`);
  return extra.length ? `${parts[0]} (${extra.join(", ")})` : parts[0];
}

/** Occupancy rows per company: running first, newest first. */
export function groupOccupancy(rows: OccupancyRow[]): Map<string, CompanyOccupancy[]> {
  const out = new Map<string, CompanyOccupancy[]>();
  for (const r of rows) {
    const list = out.get(r.company_id) ?? [];
    list.push({
      kind: r.kind,
      channel: r.channel,
      label: r.label,
      since: r.since,
      until: r.until,
      repliedAt: r.replied_at,
      status: r.status,
      active: r.active,
    });
    out.set(r.company_id, list);
  }
  for (const list of out.values()) {
    list.sort((a, b) => (a.active === b.active ? (a.since < b.since ? 1 : a.since > b.since ? -1 : 0) : a.active ? -1 : 1));
  }
  return out;
}

export type InboxLead = {
  id: string;
  bucket: SalesBucket;
  source_list: string | null;
  /** Who works on it: caller, call list or campaign name, or the owner. */
  worker: string | null;
};

export type BucketSummary = {
  bucket: SalesBucket;
  count: number;
  /** Per worker (caller, list, campaign, owner): how many. Unassigned is "". */
  workers: { name: string; count: number }[];
};

export type SourceListSummary = {
  name: string;
  /** Leads that came in with this list. */
  total: number;
  /** Still in Incoming: no destination yet. */
  incoming: number;
};

/** Counts per bucket with who works on it, in bucket order. */
export function summarizeBuckets(leads: InboxLead[]): BucketSummary[] {
  const byBucket = new Map<SalesBucket, Map<string, number>>();
  for (const l of leads) {
    const workers = byBucket.get(l.bucket) ?? new Map<string, number>();
    const name = l.worker ?? "";
    workers.set(name, (workers.get(name) ?? 0) + 1);
    byBucket.set(l.bucket, workers);
  }
  return salesBuckets.map((b) => {
    const workers = byBucket.get(b.value) ?? new Map<string, number>();
    return {
      bucket: b.value,
      count: [...workers.values()].reduce((a, n) => a + n, 0),
      workers: [...workers.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    };
  });
}

/** Per source list how many came in and how many still wait in Incoming; lists with waiting leads first. */
export function summarizeSourceLists(leads: InboxLead[]): SourceListSummary[] {
  const map = new Map<string, SourceListSummary>();
  for (const l of leads) {
    const name = l.source_list?.trim() || "No list";
    const s = map.get(name) ?? { name, total: 0, incoming: 0 };
    s.total += 1;
    if (l.bucket === "incoming") s.incoming += 1;
    map.set(name, s);
  }
  return [...map.values()].sort((a, b) => b.incoming - a.incoming || a.name.localeCompare(b.name, "nl", { numeric: true }));
}

/** Checks the extra input a destination needs; returns an error sentence or null. */
export function triageInputError(
  destination: TriageDestination,
  input: { viewId?: string | null; callerId?: string | null; campaignId?: string | null; until?: string | null; reason?: string | null },
  today: string,
): string | null {
  switch (destination) {
    case "call":
      return input.viewId || input.callerId ? null : "Pick a call list or a caller.";
    case "mail_campaign":
    case "linkedin_campaign":
      return input.campaignId ? null : "Pick a campaign.";
    case "parked":
      return input.until && /^\d{4}-\d{2}-\d{2}$/.test(input.until) && input.until >= today ? null : "Pick a date from today.";
    case "no_go":
      return input.reason?.trim() ? null : "Give a reason for no go.";
    default:
      return null;
  }
}
