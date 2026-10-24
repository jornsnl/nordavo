import "server-only";
import type { EntityType } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";

export const ATTACHMENTS_BUCKET = "attachments";
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/** <entity_type>/<entity_id>/<random>-<safe file name>, matching the storage policies. */
export function buildStoragePath(entityType: EntityType, entityId: string, fileName: string) {
  const safeName = fileName
    .normalize("NFKD")
    .replace(/[^\w.\-]+/g, "-")
    .replace(/-+/g, "-")
    .slice(-120);
  return `${entityType}/${entityId}/${crypto.randomUUID().slice(0, 8)}-${safeName}`;
}

/** Short-lived download link. RLS on storage.objects decides who may open it. */
export async function createSignedUrl(path: string, expiresInSeconds = 300) {
  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from(ATTACHMENTS_BUCKET)
    .createSignedUrl(path, expiresInSeconds);
  if (error) return null;
  return data.signedUrl;
}
