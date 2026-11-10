"use server";

import { sendContentMailSoon } from "@/lib/content/notify";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import {
  CONTENT_BUCKET,
  requireAdminClient,
  requireContentUser,
} from "@/lib/content/data";
import { CONTENT_GENERIC_ERROR, contentErrorMessage, type ContentActionState } from "@/lib/content/errors";
import { checkbox, mergeCustomFields, readCustomFields, text } from "@/lib/content/forms";
import { fieldDefFrom, imageBriefFields, isDay, parseTags } from "@/lib/content/rules";
import { parseMediaSuggestion } from "@/lib/content/media-utils";
import {
  DRIVE_SETUP_HELP,
  extractFolderId,
  folderName,
  hasGoogleDrive,
  safeFileName,
  summaryText,
  syncDriveFolder,
} from "@/lib/content/drive";
import type { ContentImageBrief, ContentMediaRow } from "@/lib/content/database";
import type { Json } from "@/lib/database.types";

/**
 * Writes of the media library, image suggestions, image briefs and Drive
 * folders. Each action checks the session; RLS and the content triggers
 * decide the rest. Files go to the private bucket with the secret key after
 * content_can_edit_media said yes for this user.
 */

// Server actions accept at most 21 MB per request (next.config.ts).
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const ALLOWED = /^(image\/|video\/|application\/pdf$)/;

const id = z.guid();

function refresh() {
  revalidatePath("/content", "layout");
  // Image suggestions and briefs queue notifications.
  sendContentMailSoon();
}

async function mayEditLibrary(workspaceId: string | null) {
  const supabase = await createClient();
  const { data } = await supabase.rpc("content_can_edit_media", { p_workspace: workspaceId });
  return data === true;
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

export async function uploadMediaAction(workspaceId: string | null, _prev: ContentActionState, formData: FormData): Promise<ContentActionState> {
  const user = await requireContentUser();
  if (workspaceId !== null && !id.safeParse(workspaceId).success) return { error: "Library not found." };
  if (!(await mayEditLibrary(workspaceId))) return { error: "You cannot add files to this library." };

  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return { error: "Pick one or more files." };
  const total = files.reduce((sum, f) => sum + f.size, 0);
  if (total > MAX_UPLOAD_BYTES) return { error: "At most 20 MB per upload. Add large videos through a Google Drive folder." };
  const wrong = files.find((f) => !ALLOWED.test(f.type));
  if (wrong) return { error: `${wrong.name} is not a photo, video or PDF.` };

  const folder = text(formData, "folder", 300);
  const admin = requireAdminClient();
  const supabase = await createClient();
  const library = workspaceId ?? "company";
  let added = 0;
  for (const file of files) {
    const path = `media/${library}/${crypto.randomUUID().slice(0, 8)}-${safeFileName(file.name)}`;
    const { error: uploadError } = await admin.storage.from(CONTENT_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
    if (uploadError) {
      console.error("[content] upload failed:", uploadError.message);
      return { error: added ? `${added} added, then ${file.name} could not be uploaded.` : "The file could not be uploaded." };
    }
    const width = Number(formData.get(`width_${file.name}`)) || null;
    const height = Number(formData.get(`height_${file.name}`)) || null;
    const { error } = await supabase.from("content_media").insert({
      workspace_id: workspaceId,
      storage_path: path,
      file_name: file.name.slice(0, 255) || "file",
      mime_type: file.type,
      size_bytes: file.size,
      width,
      height,
      orientation: width && height ? (width / height > 1.05 ? "landscape" : width / height < 0.95 ? "portrait" : "square") : null,
      folder,
      source: "upload",
      uploaded_by: user.id,
    });
    if (error) {
      await admin.storage.from(CONTENT_BUCKET).remove([path]);
      return { error: contentErrorMessage(error) };
    }
    added++;
  }
  refresh();
  return { ok: true, message: added === 1 ? "File added." : `${added} files added.` };
}

const orientation = z.enum(["portrait", "landscape", "square"]).nullable();

export async function updateMediaAction(mediaId: string, _prev: ContentActionState, formData: FormData): Promise<ContentActionState> {
  await requireContentUser();
  if (!id.safeParse(mediaId).success) return { error: "File not found." };
  const supabase = await createClient();
  const { data: media } = await supabase.from("content_media").select("id, workspace_id, custom_fields").eq("id", mediaId).maybeSingle();
  if (!media) return { error: "File not found." };

  const taken = text(formData, "taken_on");
  if (taken && !isDay(taken)) return { error: "Check the highlighted fields.", fieldErrors: { taken_on: "Enter a date" } };
  const parsedOrientation = orientation.safeParse(text(formData, "orientation"));
  if (!parsedOrientation.success) return { error: "Check the highlighted fields.", fieldErrors: { orientation: "Pick an orientation" } };
  const authorInPhoto = formData.get("author_in_photo");

  let customFields: Json = media.custom_fields;
  if (media.workspace_id) {
    const { data: defs } = await supabase
      .from("content_field_definitions")
      .select("key, label, field_type, config")
      .eq("workspace_id", media.workspace_id)
      .eq("entity", "media")
      .is("archived_at", null);
    const { values, errors } = readCustomFields(formData, (defs ?? []).map(fieldDefFrom));
    if (Object.keys(errors).length) return { error: "Check the highlighted fields.", fieldErrors: errors };
    customFields = mergeCustomFields(media.custom_fields, values);
  }

  const { error } = await supabase
    .from("content_media")
    .update({
      description: text(formData, "description", 2000),
      folder: text(formData, "folder", 300),
      taken_on: taken,
      people: parseList(text(formData, "people", 2000)),
      author_in_photo: authorInPhoto === "yes" ? true : authorInPhoto === "no" ? false : null,
      setting: text(formData, "setting", 200),
      mood: text(formData, "mood", 200),
      clothing: text(formData, "clothing", 200),
      orientation: parsedOrientation.data,
      usable_for_linkedin: checkbox(formData, "usable_for_linkedin"),
      do_not_use: checkbox(formData, "do_not_use"),
      tags: parseTags(text(formData, "tags", 2000)),
      custom_fields: customFields,
    })
    .eq("id", mediaId);
  if (error) return { error: contentErrorMessage(error) };
  refresh();
  return { ok: true, message: "Saved." };
}

/** "Julius, Floris" -> ["Julius", "Floris"] (names keep their capitals). */
function parseList(value: string | null): string[] {
  if (!value) return [];
  return [...new Set(value.split(/[,\n]/).map((s) => s.trim()).filter((s) => s.length > 0 && s.length <= 80))].slice(0, 30);
}

/**
 * Accept Claude's suggestion for a file: all of it, or only the keys given.
 * Lists (tags, people) are added to what is there. The suggestion is cleared.
 */
export async function acceptMediaSuggestionAction(mediaId: string, keys?: string[]): Promise<ContentActionState> {
  await requireContentUser();
  if (!id.safeParse(mediaId).success) return { error: "File not found." };
  const supabase = await createClient();
  const { data: media } = await supabase.from("content_media").select("*").eq("id", mediaId).maybeSingle();
  if (!media) return { error: "File not found." };
  const suggestion = parseMediaSuggestion(media.suggested);
  if (!suggestion) return { error: "There is no suggestion for this file." };
  const take = (key: string) => !keys || keys.includes(key);
  const update: Partial<ContentMediaRow> = { suggested: null, suggested_at: null };
  if (take("description") && suggestion.description) update.description = suggestion.description.slice(0, 2000);
  if (take("tags") && suggestion.tags) update.tags = parseTags([...media.tags, ...suggestion.tags].join(","));
  if (take("people") && suggestion.people) update.people = [...new Set([...media.people, ...suggestion.people])].slice(0, 30);
  if (take("setting") && suggestion.setting) update.setting = suggestion.setting.slice(0, 200);
  if (take("mood") && suggestion.mood) update.mood = suggestion.mood.slice(0, 200);
  if (take("clothing") && suggestion.clothing) update.clothing = suggestion.clothing.slice(0, 200);
  if (take("orientation") && suggestion.orientation) update.orientation = suggestion.orientation;
  if (take("author_in_photo") && suggestion.author_in_photo !== undefined) update.author_in_photo = suggestion.author_in_photo;
  const { error } = await supabase.from("content_media").update(update).eq("id", mediaId);
  if (error) return { error: contentErrorMessage(error) };
  refresh();
  return { ok: true, message: "Suggestion accepted." };
}

export async function rejectMediaSuggestionAction(mediaId: string): Promise<ContentActionState> {
  await requireContentUser();
  if (!id.safeParse(mediaId).success) return { error: "File not found." };
  const supabase = await createClient();
  const { error } = await supabase.from("content_media").update({ suggested: null, suggested_at: null }).eq("id", mediaId);
  if (error) return { error: contentErrorMessage(error) };
  refresh();
  return { ok: true, message: "Suggestion rejected." };
}

// ---------------------------------------------------------------------------
// Chosen media of a post
// ---------------------------------------------------------------------------

export async function addPostMediaAction(postId: string, mediaId: string): Promise<ContentActionState> {
  await requireContentUser();
  if (!id.safeParse(postId).success || !id.safeParse(mediaId).success) return { error: "Not found." };
  const supabase = await createClient();
  const { data: last } = await supabase
    .from("content_post_media")
    .select("position")
    .eq("post_id", postId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { error } = await supabase.from("content_post_media").insert({ post_id: postId, media_id: mediaId, position: (last?.position ?? -1) + 1 });
  if (error) return { error: error.code === "23505" ? "That file is already chosen." : contentErrorMessage(error) };
  refresh();
  return { ok: true, message: "Media added." };
}

export async function removePostMediaAction(postId: string, mediaId: string): Promise<ContentActionState> {
  await requireContentUser();
  if (!id.safeParse(postId).success || !id.safeParse(mediaId).success) return { error: "Not found." };
  const supabase = await createClient();
  const { error } = await supabase.from("content_post_media").delete().eq("post_id", postId).eq("media_id", mediaId);
  if (error) return { error: contentErrorMessage(error) };
  refresh();
  return { ok: true, message: "Media removed." };
}

/** Move a file one place up or down in the order of the post. */
export async function movePostMediaAction(postId: string, mediaId: string, direction: "up" | "down"): Promise<ContentActionState> {
  await requireContentUser();
  if (!id.safeParse(postId).success || !id.safeParse(mediaId).success) return { error: "Not found." };
  const supabase = await createClient();
  const { data } = await supabase.from("content_post_media").select("media_id, position").eq("post_id", postId).order("position").order("created_at");
  const list = (data ?? []).map((r) => r.media_id);
  const index = list.indexOf(mediaId);
  const target = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || target < 0 || target >= list.length) return { ok: true };
  [list[index], list[target]] = [list[target], list[index]];
  for (let i = 0; i < list.length; i++) {
    const { error } = await supabase.from("content_post_media").update({ position: i }).eq("post_id", postId).eq("media_id", list[i]);
    if (error) return { error: contentErrorMessage(error) };
  }
  refresh();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Image suggestions
// ---------------------------------------------------------------------------

const suggestionSchema = z.object({
  media_id: z.guid({ error: "Pick a file" }),
  reason: z.string().trim().max(500, { error: "At most 500 characters" }).optional(),
  score: z.coerce.number().int().min(1).max(5).optional(),
});

export async function addImageSuggestionAction(postId: string, _prev: ContentActionState, formData: FormData): Promise<ContentActionState> {
  await requireContentUser();
  if (!id.safeParse(postId).success) return { error: "Post not found." };
  const parsed = suggestionSchema.safeParse({
    media_id: formData.get("media_id"),
    reason: text(formData, "reason", 500) ?? undefined,
    score: text(formData, "score") ?? undefined,
  });
  if (!parsed.success) return { error: "Check the highlighted fields.", fieldErrors: { media_id: "Pick a file" } };
  const supabase = await createClient();
  const { error } = await supabase.from("content_image_suggestions").insert({
    post_id: postId,
    media_id: parsed.data.media_id,
    reason: parsed.data.reason || null,
    score: parsed.data.score ?? null,
  });
  if (error) return { error: contentErrorMessage(error) };
  refresh();
  return { ok: true, message: "Suggestion added." };
}

export async function pickImageSuggestionAction(suggestionId: string): Promise<ContentActionState> {
  await requireContentUser();
  if (!id.safeParse(suggestionId).success) return { error: "Suggestion not found." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("content_pick_image", { p_suggestion: suggestionId });
  if (error) return { error: contentErrorMessage(error) };
  refresh();
  return { ok: true, message: "Picked as chosen media." };
}

export async function rejectImageSuggestionAction(suggestionId: string): Promise<ContentActionState> {
  await requireContentUser();
  if (!id.safeParse(suggestionId).success) return { error: "Suggestion not found." };
  const supabase = await createClient();
  const { error } = await supabase.from("content_image_suggestions").update({ status: "rejected" }).eq("id", suggestionId).eq("status", "pending");
  if (error) return { error: contentErrorMessage(error) };
  refresh();
  return { ok: true, message: "Suggestion rejected." };
}

/** Reject every open suggestion of a post at once. */
export async function rejectAllImageSuggestionsAction(postId: string): Promise<ContentActionState> {
  await requireContentUser();
  if (!id.safeParse(postId).success) return { error: "Post not found." };
  const supabase = await createClient();
  const { error } = await supabase.from("content_image_suggestions").update({ status: "rejected" }).eq("post_id", postId).eq("status", "pending");
  if (error) return { error: contentErrorMessage(error) };
  refresh();
  return { ok: true, message: "Suggestions rejected." };
}

// ---------------------------------------------------------------------------
// Image brief
// ---------------------------------------------------------------------------

export async function saveImageBriefAction(postId: string, _prev: ContentActionState, formData: FormData): Promise<ContentActionState> {
  await requireContentUser();
  if (!id.safeParse(postId).success) return { error: "Post not found." };
  const brief: ContentImageBrief = {};
  for (const { key } of imageBriefFields) {
    const value = text(formData, key, 500);
    if (value) brief[key] = value;
  }
  const supabase = await createClient();
  const empty = Object.keys(brief).length === 0;
  const { error } = await supabase
    .from("content_posts")
    .update({ image_brief: empty ? null : (brief as Json), image_brief_by: empty ? null : "user", image_brief_done_at: null })
    .eq("id", postId);
  if (error) return { error: contentErrorMessage(error) };
  refresh();
  return { ok: true, message: empty ? "Brief cleared." : "Brief saved." };
}

/** Keep Claude's brief as written: it becomes the brief of a person. */
export async function acceptImageBriefAction(postId: string): Promise<ContentActionState> {
  await requireContentUser();
  if (!id.safeParse(postId).success) return { error: "Post not found." };
  const supabase = await createClient();
  const { error } = await supabase.from("content_posts").update({ image_brief_by: "user" }).eq("id", postId).eq("image_brief_by", "claude");
  if (error) return { error: contentErrorMessage(error) };
  refresh();
  return { ok: true, message: "Brief accepted." };
}

export async function setImageBriefDoneAction(postId: string, done: boolean): Promise<ContentActionState> {
  await requireContentUser();
  if (!id.safeParse(postId).success) return { error: "Post not found." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("content_posts")
    .update({ image_brief_done_at: done ? new Date().toISOString() : null })
    .eq("id", postId);
  if (error) return { error: contentErrorMessage(error) };
  refresh();
  return { ok: true, message: done ? "Brief marked as done." : "Brief open again." };
}

export async function clearImageBriefAction(postId: string): Promise<ContentActionState> {
  await requireContentUser();
  if (!id.safeParse(postId).success) return { error: "Post not found." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("content_posts")
    .update({ image_brief: null, image_brief_by: null, image_brief_done_at: null })
    .eq("id", postId);
  if (error) return { error: contentErrorMessage(error) };
  refresh();
  return { ok: true, message: "Brief removed." };
}

// ---------------------------------------------------------------------------
// Google Drive folders
// ---------------------------------------------------------------------------

/** The author of the workspace or an admin; the company library: portal admins. */
async function mayManageFolder(workspaceId: string | null): Promise<boolean> {
  const user = await requireContentUser();
  if (workspaceId === null) return user.isAdmin;
  const supabase = await createClient();
  const { data } = await supabase.rpc("content_my_role", { p_workspace: workspaceId });
  return data === "admin" || data === "author";
}

export async function addDriveFolderAction(workspaceId: string | null, _prev: ContentActionState, formData: FormData): Promise<ContentActionState> {
  const user = await requireContentUser();
  if (workspaceId !== null && !id.safeParse(workspaceId).success) return { error: "Library not found." };
  if (!(await mayManageFolder(workspaceId))) return { error: "You cannot link folders to this library." };
  const folderId = extractFolderId(text(formData, "folder", 2000));
  if (!folderId) return { error: "Check the highlighted fields.", fieldErrors: { folder: "Paste the link of a Google Drive folder" } };
  if (!hasGoogleDrive()) return { error: DRIVE_SETUP_HELP };

  let name: string;
  try {
    name = await folderName(folderId);
  } catch (error) {
    return { error: error instanceof Error ? error.message : CONTENT_GENERIC_ERROR };
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("content_drive_folders")
    .insert({ workspace_id: workspaceId, folder_id: folderId, name: name.slice(0, 200), created_by: user.id })
    .select("id")
    .single();
  if (error) return { error: error.code === "23505" ? "That folder is already linked." : contentErrorMessage(error) };
  refresh();
  return { ok: true, message: `Linked "${name}". Sync it to import the files.`, id: data.id };
}

export async function removeDriveFolderAction(folderRowId: string): Promise<ContentActionState> {
  await requireContentUser();
  if (!id.safeParse(folderRowId).success) return { error: "Folder not found." };
  const supabase = await createClient();
  const { data: folder } = await supabase.from("content_drive_folders").select("workspace_id").eq("id", folderRowId).maybeSingle();
  if (!folder || !(await mayManageFolder(folder.workspace_id))) return { error: "Folder not found." };
  const { error } = await supabase.from("content_drive_folders").delete().eq("id", folderRowId);
  if (error) return { error: contentErrorMessage(error) };
  refresh();
  return { ok: true, message: "Folder unlinked. Files already imported stay in the library." };
}

export async function syncDriveFolderAction(folderRowId: string): Promise<ContentActionState> {
  await requireContentUser();
  if (!id.safeParse(folderRowId).success) return { error: "Folder not found." };
  if (!hasGoogleDrive()) return { error: DRIVE_SETUP_HELP };
  const supabase = await createClient();
  // RLS: only who may see the library finds the row.
  const { data: folder } = await supabase
    .from("content_drive_folders")
    .select("id, workspace_id, folder_id, name, created_by")
    .eq("id", folderRowId)
    .maybeSingle();
  if (!folder || !(await mayManageFolder(folder.workspace_id))) return { error: "Folder not found." };
  try {
    const summary = await syncDriveFolder(requireAdminClient(), folder);
    refresh();
    return { ok: true, message: `Synced: ${summaryText(summary)}.` };
  } catch (error) {
    refresh();
    return { error: error instanceof Error ? error.message : CONTENT_GENERIC_ERROR };
  }
}

