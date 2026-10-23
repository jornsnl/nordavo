"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { requireStaff } from "@/lib/auth";
import { ATTACHMENTS_BUCKET, MAX_UPLOAD_BYTES, buildStoragePath } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";
import { fieldErrorsFrom, GENERIC_ERROR, type ActionState } from "@/lib/action-state";

const entitySchema = z.object({
  entityType: z.enum(["client", "vacancy", "candidate", "application", "placement"]),
  entityId: z.uuid(),
});

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

const noteBody = z
  .string()
  .trim()
  .min(1, "Schrijf eerst iets.")
  .max(10000, "Deze notitie is te lang.");

export async function addNote(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireStaff();
  const parsed = entitySchema.extend({ body: noteBody }).safeParse({
    entityType: formData.get("entityType"),
    entityId: formData.get("entityId"),
    body: formData.get("body") ?? "",
  });
  if (!parsed.success) return { error: "Controleer je notitie.", fieldErrors: fieldErrorsFrom(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.from("notes").insert({
    entity_type: parsed.data.entityType,
    entity_id: parsed.data.entityId,
    body: parsed.data.body,
  });
  if (error) return { error: GENERIC_ERROR };
  refresh();
  return { ok: true };
}

/** Only the author can edit a note. */
export async function updateNote(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireStaff();
  const parsed = z.object({ id: z.uuid(), body: noteBody }).safeParse({
    id: formData.get("id"),
    body: formData.get("body") ?? "",
  });
  if (!parsed.success) return { error: "Controleer je notitie.", fieldErrors: fieldErrorsFrom(parsed.error) };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notes")
    .update({ body: parsed.data.body })
    .eq("id", parsed.data.id)
    .eq("author_id", user.id)
    .select("id");
  if (error) return { error: GENERIC_ERROR };
  if (data.length === 0) return { error: "Je kunt alleen je eigen notities aanpassen." };
  refresh();
  return { ok: true };
}

export async function deleteNote(noteId: string): Promise<ActionState> {
  const user = await requireStaff();
  const id = z.uuid().safeParse(noteId);
  if (!id.success) return { error: GENERIC_ERROR };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notes")
    .delete()
    .eq("id", id.data)
    .eq("author_id", user.id)
    .select("id");
  if (error) return { error: GENERIC_ERROR };
  if (data.length === 0) return { error: "Je kunt alleen je eigen notities verwijderen." };
  refresh();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Attachments
//
// Files go straight from the browser to Supabase Storage with a signed
// upload URL, so they do not pass the 1 MB Server Action body limit.
// ---------------------------------------------------------------------------

const fileMetaSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  size: z
    .number()
    .int()
    .positive("Dit bestand is leeg.")
    .max(MAX_UPLOAD_BYTES, `Bestanden mogen maximaal ${MAX_UPLOAD_BYTES / 1024 / 1024} MB zijn.`),
});

export type UploadTarget = { ok: true; path: string; token: string } | { ok: false; error: string };

/** Step 1: reserve a path and get a one-time upload token. */
export async function createUploadTarget(input: {
  entityType: string;
  entityId: string;
  fileName: string;
  size: number;
}): Promise<UploadTarget> {
  await requireStaff();
  const parsed = entitySchema.extend(fileMetaSchema.shape).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? GENERIC_ERROR };
  }

  const { entityType, entityId, fileName } = parsed.data;
  const path = buildStoragePath(entityType, entityId, fileName);
  const supabase = await createClient();
  const { data, error } = await supabase.storage.from(ATTACHMENTS_BUCKET).createSignedUploadUrl(path);
  if (error || !data) return { ok: false, error: "Uploaden lukt nu niet. Probeer het later opnieuw." };
  return { ok: true, path: data.path, token: data.token };
}

/** Step 2: after the upload, record the file on the record. */
export async function saveAttachment(input: {
  entityType: string;
  entityId: string;
  path: string;
  fileName: string;
  size: number;
  mimeType: string;
}): Promise<ActionState> {
  await requireStaff();
  const parsed = entitySchema
    .extend(fileMetaSchema.shape)
    .extend({ path: z.string().min(1).max(500), mimeType: z.string().max(200) })
    .safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? GENERIC_ERROR };

  const { entityType, entityId, path, fileName, size, mimeType } = parsed.data;
  // The path must belong to this record and contain no tricks.
  if (!path.startsWith(`${entityType}/${entityId}/`) || path.includes("..")) {
    return { error: GENERIC_ERROR };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("attachments").insert({
    entity_type: entityType,
    entity_id: entityId,
    storage_path: path,
    file_name: fileName,
    size_bytes: size,
    mime_type: mimeType || null,
  });
  if (error) {
    await supabase.storage.from(ATTACHMENTS_BUCKET).remove([path]);
    return { error: GENERIC_ERROR };
  }
  refresh();
  return { ok: true, message: "Bijlage toegevoegd." };
}

/** A short-lived link that downloads the file under its original name. */
export async function getAttachmentUrl(
  attachmentId: string,
): Promise<{ url: string } | { error: string }> {
  await requireStaff();
  const id = z.uuid().safeParse(attachmentId);
  if (!id.success) return { error: GENERIC_ERROR };

  const supabase = await createClient();
  const { data: attachment } = await supabase
    .from("attachments")
    .select("storage_path, file_name")
    .eq("id", id.data)
    .maybeSingle();
  if (!attachment) return { error: "Deze bijlage bestaat niet meer." };

  const { data, error } = await supabase.storage
    .from(ATTACHMENTS_BUCKET)
    .createSignedUrl(attachment.storage_path, 60, { download: attachment.file_name });
  if (error || !data) return { error: "Downloaden lukt nu niet. Probeer het opnieuw." };
  return { url: data.signedUrl };
}

export async function deleteAttachment(attachmentId: string): Promise<ActionState> {
  await requireStaff();
  const id = z.uuid().safeParse(attachmentId);
  if (!id.success) return { error: GENERIC_ERROR };

  const supabase = await createClient();
  const { data: attachment } = await supabase
    .from("attachments")
    .select("storage_path")
    .eq("id", id.data)
    .maybeSingle();
  if (!attachment) return { error: "Deze bijlage bestaat niet meer." };

  const { error: storageError } = await supabase.storage
    .from(ATTACHMENTS_BUCKET)
    .remove([attachment.storage_path]);
  if (storageError) return { error: GENERIC_ERROR };

  const { error } = await supabase.from("attachments").delete().eq("id", id.data);
  if (error) return { error: GENERIC_ERROR };
  refresh();
  return { ok: true };
}
