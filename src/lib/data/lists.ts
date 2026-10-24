import "server-only";
import { requireStaff } from "@/lib/auth";
import type { Json, ListExportType } from "@/lib/database.types";
import { listCounts, previewList, type ListFilter, type ListPreview } from "@/lib/gtm/lists";
import { createClient } from "@/lib/supabase/server";

/** Live counts per list type for the Lijsten page. Uses the user's client, so RLS applies. */
export async function getListCounts(filter: ListFilter) {
  await requireStaff();
  const supabase = await createClient();
  return listCounts(supabase, filter);
}

export async function getListPreview(type: ListExportType, filter: ListFilter): Promise<ListPreview> {
  await requireStaff();
  const supabase = await createClient();
  return previewList(supabase, type, filter);
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

export async function listExportHistory(limit = 30): Promise<ListExportItem[]> {
  await requireStaff();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("list_exports")
    .select(
      "id, type, record_count, filter_used, destination, created_at, campaign:campaigns(name), creator:profiles!list_exports_created_by_fkey(full_name, email)",
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Exports laden mislukt: ${error.message}`);
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
