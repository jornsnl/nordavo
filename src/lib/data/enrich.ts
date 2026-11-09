import "server-only";
import { requireModule } from "@/lib/auth";
import type { Json, ListExportType } from "@/lib/database.types";
import { fetchEnrichCandidates } from "@/lib/gtm/max";
import { createClient } from "@/lib/supabase/server";

/** Contacts in Enrich (to Max for a phone number) and the export history. */

export type EnrichPreview = {
  count: number;
  withoutLinkedin: number;
  rows: { contactId: string; companyId: string; name: string; title: string | null; companyName: string; linkedin: string }[];
};

export async function getEnrichPreview(rows = 25): Promise<EnrichPreview> {
  await requireModule("sales");
  const supabase = await createClient();
  const { candidates, withoutLinkedin } = await fetchEnrichCandidates(supabase);
  return {
    count: candidates.length,
    withoutLinkedin,
    rows: candidates.slice(0, rows).map((c) => ({
      contactId: c.contact_id,
      companyId: c.company_id,
      name: [c.first_name, c.last_name].filter(Boolean).join(" ") || "Unknown",
      title: c.title,
      companyName: c.company_name,
      linkedin: c.linkedin_url,
    })),
  };
}

export type ListExportItem = {
  id: string;
  type: ListExportType;
  recordCount: number;
  filterUsed: Json;
  destination: string | null;
  campaignName: string | null;
  createdBy: string | null;
  createdAt: string;
};

/** Every export so far (Max, and the call lists and mail campaigns from before the sales CRM). */
export async function listExportHistory(limit = 30): Promise<ListExportItem[]> {
  await requireModule("sales");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("list_exports")
    .select(
      "id, type, record_count, filter_used, destination, created_at, campaign:campaigns(name), creator:profiles!list_exports_created_by_fkey(full_name, email)",
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Could not load exports: ${error.message}`);
  return data.map((row) => {
    const campaign = Array.isArray(row.campaign) ? row.campaign[0] : row.campaign;
    const creator = Array.isArray(row.creator) ? row.creator[0] : row.creator;
    return {
      id: row.id,
      type: row.type,
      recordCount: row.record_count,
      filterUsed: row.filter_used,
      destination: row.destination,
      campaignName: campaign?.name ?? null,
      createdBy: creator ? creator.full_name || creator.email : null,
      createdAt: row.created_at,
    };
  });
}
