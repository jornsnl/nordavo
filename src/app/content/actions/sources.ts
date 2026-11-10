"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { CONTENT_BUCKET, requireAdminClient, requireContentUser } from "@/lib/content/data";
import { contentErrorMessage, type ContentActionState } from "@/lib/content/errors";
import { checkbox, text } from "@/lib/content/forms";
import { isDay } from "@/lib/content/rules";
import { safeFileName } from "@/lib/content/drive";

/** Writes of sources and series. RLS decides who may (writers for sources, the author for series). */

const id = z.guid();
const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024;

function refresh() {
  revalidatePath("/content", "layout");
}

function count(value: string | null): number | null | "invalid" {
  if (!value) return null;
  const n = Number(value.replace(/[.,\s]/g, ""));
  return Number.isInteger(n) && n >= 0 ? n : "invalid";
}

function readSource(formData: FormData) {
  const url = text(formData, "url", 2000);
  const title = text(formData, "title", 300);
  const sourceDate = text(formData, "source_date");
  const upvotes = count(text(formData, "upvotes"));
  const comments = count(text(formData, "comments_count"));
  const errors: Record<string, string> = {};
  if (!url && !title) errors.title = "Add a title or a link";
  if (url && !/^https?:\/\/\S+$/i.test(url)) errors.url = "Enter a link starting with https://";
  if (sourceDate && !isDay(sourceDate)) errors.source_date = "Enter a date";
  if (upvotes === "invalid") errors.upvotes = "Enter a whole number";
  if (comments === "invalid") errors.comments_count = "Enter a whole number";
  return {
    errors,
    values: {
      url,
      title,
      platform: text(formData, "platform", 60),
      source_date: sourceDate,
      upvotes: upvotes === "invalid" ? null : upvotes,
      comments_count: comments === "invalid" ? null : comments,
      names_blurred: checkbox(formData, "names_blurred"),
      screenshot_instruction: text(formData, "screenshot_instruction", 2000),
    },
  };
}

/** Upload a screenshot to sources/<id>/ and return its path (or an error). */
async function uploadScreenshot(sourceId: string, formData: FormData): Promise<{ path?: string; error?: string }> {
  const file = formData.get("screenshot");
  if (!(file instanceof File) || file.size === 0) return {};
  if (!file.type.startsWith("image/")) return { error: "The screenshot must be an image." };
  if (file.size > MAX_SCREENSHOT_BYTES) return { error: "Screenshots can be at most 10 MB." };
  const path = `sources/${sourceId}/${crypto.randomUUID().slice(0, 8)}-${safeFileName(file.name)}`;
  const { error } = await requireAdminClient().storage.from(CONTENT_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
  if (error) return { error: "The screenshot could not be uploaded." };
  return { path };
}

export async function createSourceAction(workspaceId: string, _prev: ContentActionState, formData: FormData): Promise<ContentActionState> {
  const user = await requireContentUser();
  if (!id.safeParse(workspaceId).success) return { error: "Workspace not found." };
  const { values, errors } = readSource(formData);
  if (Object.keys(errors).length) return { error: "Check the highlighted fields.", fieldErrors: errors };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("content_sources")
    .insert({ ...values, workspace_id: workspaceId, created_by: user.id })
    .select("id")
    .single();
  if (error) return { error: contentErrorMessage(error) };
  const upload = await uploadScreenshot(data.id, formData);
  if (upload.path) await supabase.from("content_sources").update({ screenshot_path: upload.path }).eq("id", data.id);
  refresh();
  if (upload.error) return { ok: true, id: data.id, message: `Source added, but ${upload.error.toLowerCase()}` };
  return { ok: true, id: data.id, message: "Source added." };
}

export async function updateSourceAction(sourceId: string, _prev: ContentActionState, formData: FormData): Promise<ContentActionState> {
  await requireContentUser();
  if (!id.safeParse(sourceId).success) return { error: "Source not found." };
  const { values, errors } = readSource(formData);
  if (Object.keys(errors).length) return { error: "Check the highlighted fields.", fieldErrors: errors };
  const supabase = await createClient();
  const { data: existing } = await supabase.from("content_sources").select("id, screenshot_path").eq("id", sourceId).maybeSingle();
  if (!existing) return { error: "Source not found." };
  const upload = await uploadScreenshot(sourceId, formData);
  if (upload.error) return { error: upload.error };
  const removeShot = checkbox(formData, "remove_screenshot");
  const { error } = await supabase
    .from("content_sources")
    .update({ ...values, screenshot_path: upload.path ?? (removeShot ? null : existing.screenshot_path) })
    .eq("id", sourceId);
  if (error) return { error: contentErrorMessage(error) };
  // The old file goes once the row no longer points at it.
  if (existing.screenshot_path && (upload.path || removeShot)) {
    await requireAdminClient().storage.from(CONTENT_BUCKET).remove([existing.screenshot_path]);
  }
  refresh();
  return { ok: true, message: "Saved." };
}

export async function archiveSourceAction(sourceId: string, archived: boolean): Promise<ContentActionState> {
  await requireContentUser();
  if (!id.safeParse(sourceId).success) return { error: "Source not found." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("content_sources")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", sourceId);
  if (error) return { error: contentErrorMessage(error) };
  refresh();
  return { ok: true, message: archived ? "Source archived." : "Source restored." };
}

// ---------------------------------------------------------------------------
// Series
// ---------------------------------------------------------------------------

const seriesSchema = z.object({
  name: z.string({ error: "Add a name" }).trim().min(1, { error: "Add a name" }).max(120, { error: "At most 120 characters" }),
  description: z.string().trim().max(2000, { error: "At most 2,000 characters" }).optional(),
  target_count: z.coerce.number({ error: "Enter a number" }).int({ error: "Enter a whole number" }).min(1).max(500).optional(),
});

function readSeries(formData: FormData) {
  return seriesSchema.safeParse({
    name: formData.get("name") ?? undefined,
    description: text(formData, "description", 2000) ?? undefined,
    target_count: text(formData, "target_count") ?? undefined,
  });
}

function fieldErrors(error: z.ZodError) {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".");
    if (key && !result[key]) result[key] = issue.message;
  }
  return result;
}

export async function createSeriesAction(workspaceId: string, _prev: ContentActionState, formData: FormData): Promise<ContentActionState> {
  const user = await requireContentUser();
  if (!id.safeParse(workspaceId).success) return { error: "Workspace not found." };
  const parsed = readSeries(formData);
  if (!parsed.success) return { error: "Check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
  const supabase = await createClient();
  const { error } = await supabase.from("content_series").insert({
    workspace_id: workspaceId,
    name: parsed.data.name,
    description: parsed.data.description || null,
    target_count: parsed.data.target_count ?? null,
    created_by: user.id,
  });
  if (error) return { error: contentErrorMessage(error) };
  refresh();
  return { ok: true, message: "Series added." };
}

export async function updateSeriesAction(seriesId: string, _prev: ContentActionState, formData: FormData): Promise<ContentActionState> {
  await requireContentUser();
  if (!id.safeParse(seriesId).success) return { error: "Series not found." };
  const parsed = readSeries(formData);
  if (!parsed.success) return { error: "Check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
  const supabase = await createClient();
  const { error } = await supabase
    .from("content_series")
    .update({ name: parsed.data.name, description: parsed.data.description || null, target_count: parsed.data.target_count ?? null })
    .eq("id", seriesId);
  if (error) return { error: contentErrorMessage(error) };
  refresh();
  return { ok: true, message: "Saved." };
}

export async function archiveSeriesAction(seriesId: string, archived: boolean): Promise<ContentActionState> {
  await requireContentUser();
  if (!id.safeParse(seriesId).success) return { error: "Series not found." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("content_series")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", seriesId);
  if (error) return { error: contentErrorMessage(error) };
  refresh();
  return { ok: true, message: archived ? "Series archived." : "Series restored." };
}
