import "server-only";
import { requireStaff } from "@/lib/auth";
import type { EntityType } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";

export type AttachmentItem = {
  id: string;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number | null;
  uploaderName: string;
  createdAt: string;
};

/** Files attached to one record, newest first. */
export async function listAttachments(entityType: EntityType, entityId: string): Promise<AttachmentItem[]> {
  await requireStaff();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("attachments")
    .select("id, file_name, mime_type, size_bytes, created_at, uploader:profiles(full_name, email)")
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(`Bijlagen laden mislukt: ${error.message}`);

  return data.map((a) => ({
    id: a.id,
    fileName: a.file_name,
    mimeType: a.mime_type,
    sizeBytes: a.size_bytes,
    uploaderName: a.uploader?.full_name || a.uploader?.email || "Onbekend",
    createdAt: a.created_at,
  }));
}
