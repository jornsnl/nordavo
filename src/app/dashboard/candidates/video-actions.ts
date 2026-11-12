"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { GENERIC_ERROR, type ActionState } from "@/lib/action-state";
import { requireStaff } from "@/lib/auth";
import { isUuid } from "@/lib/data/candidates";
import { isVideoFile, MAX_VIDEO_BYTES } from "@/lib/recruitment/candidate-fields";
import { ATTACHMENTS_BUCKET, buildStoragePath } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";

/**
 * A copy of the candidate's video intro in the portal (feedback round 3):
 * the file goes straight from the browser to the private attachments bucket
 * with a signed upload URL (videos are larger than the server action limit)
 * and is stored as an attachment of kind video on the candidate.
 */

const metaSchema = z.object({
  candidateId: z.string().refine(isUuid),
  fileName: z.string().trim().min(1).max(255),
  size: z.number().int().positive("This file is empty.").max(MAX_VIDEO_BYTES, `Videos can be at most ${MAX_VIDEO_BYTES / 1024 / 1024} MB.`),
});

export type VideoUploadTarget = { ok: true; path: string; token: string } | { ok: false; error: string };

export async function createVideoUploadTarget(input: { candidateId: string; fileName: string; size: number; mimeType: string }): Promise<VideoUploadTarget> {
  await requireStaff();
  const parsed = metaSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? GENERIC_ERROR };
  if (!isVideoFile(parsed.data.fileName, input.mimeType)) return { ok: false, error: "Upload a video file: MP4, MOV, WEBM or M4V." };
  const path = buildStoragePath("candidate", parsed.data.candidateId, parsed.data.fileName);
  const supabase = await createClient();
  const { data, error } = await supabase.storage.from(ATTACHMENTS_BUCKET).createSignedUploadUrl(path);
  if (error || !data) return { ok: false, error: "Uploading does not work right now. Try again later." };
  return { ok: true, path: data.path, token: data.token };
}

export async function saveCandidateVideo(input: {
  candidateId: string;
  path: string;
  fileName: string;
  size: number;
  mimeType: string;
}): Promise<ActionState> {
  await requireStaff();
  const parsed = metaSchema.extend({ path: z.string().min(1).max(500), mimeType: z.string().max(200) }).safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? GENERIC_ERROR };
  const { candidateId, path, fileName, size, mimeType } = parsed.data;
  if (!path.startsWith(`candidate/${candidateId}/`) || path.includes("..")) return { error: GENERIC_ERROR };

  const supabase = await createClient();
  const { error } = await supabase.from("attachments").insert({
    entity_type: "candidate",
    entity_id: candidateId,
    storage_path: path,
    file_name: fileName,
    size_bytes: size,
    mime_type: mimeType || null,
    kind: "video",
  });
  if (error) {
    await supabase.storage.from(ATTACHMENTS_BUCKET).remove([path]);
    return { error: GENERIC_ERROR };
  }
  revalidatePath(`/dashboard/candidates/${candidateId}`);
  return { ok: true, message: "Video saved in the portal." };
}

/** A signed link to play an uploaded video (one hour). */
export async function getCandidateVideoUrl(attachmentId: string): Promise<{ url: string } | { error: string }> {
  await requireStaff();
  if (!isUuid(attachmentId)) return { error: GENERIC_ERROR };
  const supabase = await createClient();
  const { data: attachment } = await supabase
    .from("attachments")
    .select("storage_path, kind, entity_type")
    .eq("id", attachmentId)
    .maybeSingle();
  if (!attachment || attachment.kind !== "video") return { error: "This video no longer exists." };
  const { data, error } = await supabase.storage.from(ATTACHMENTS_BUCKET).createSignedUrl(attachment.storage_path, 3600);
  if (error || !data) return { error: "The video cannot be opened right now. Try again." };
  return { url: data.signedUrl };
}
