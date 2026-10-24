import "server-only";
import { requireStaff } from "@/lib/auth";
import type { EntityType } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";

export type NoteItem = {
  id: string;
  body: string;
  authorId: string | null;
  authorName: string;
  createdAt: string;
  updatedAt: string;
};

/** Notes on one record, newest first. */
export async function listNotes(entityType: EntityType, entityId: string): Promise<NoteItem[]> {
  await requireStaff();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notes")
    .select("id, body, author_id, created_at, updated_at, author:profiles(full_name, email)")
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(`Notities laden mislukt: ${error.message}`);

  return data.map((n) => ({
    id: n.id,
    body: n.body,
    authorId: n.author_id,
    authorName: n.author?.full_name || n.author?.email || "Onbekend",
    createdAt: n.created_at,
    updatedAt: n.updated_at,
  }));
}
