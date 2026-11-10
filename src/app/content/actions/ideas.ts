"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { CONTENT_BUCKET, getContentWorkspace, requireAdminClient, requireContentUser } from "@/lib/content/data";
import { contentErrorMessage, type ContentActionState } from "@/lib/content/errors";
import { mergeCustomFields, readCustomFields } from "@/lib/content/forms";
import { parseTags } from "@/lib/content/rules";
import type { ContentIdeaStatus } from "@/lib/content/database";

/**
 * Writes of ideas. RLS and the triggers decide who may do what: only the
 * author of the workspace (and admins) captures ideas, only the author of
 * an idea changes it.
 */

const MAX_PHOTO_BYTES = 15 * 1024 * 1024;
const id = z.guid({ error: "Not found" });
const ideaText = z
  .string({ error: "Write the idea" })
  .trim()
  .min(1, { error: "Write the idea" })
  .max(5000, { error: "At most 5,000 characters" });
const link = z
  .string()
  .trim()
  .max(2000)
  .regex(/^https?:\/\/\S+$/i, { error: "Enter a link starting with https://" })
  .optional()
  .or(z.literal("").transform(() => undefined));

function value(formData: FormData, name: string) {
  const v = formData.get(name);
  return typeof v === "string" ? v : undefined;
}

function refresh() {
  revalidatePath("/content", "layout");
}

/** A safe file name for storage paths. */
function safeName(name: string) {
  return (
    name
      .normalize("NFKD")
      .replace(/[^\w.-]+/g, "-")
      .replace(/-+/g, "-")
      .slice(-80) || "photo"
  );
}

/** Capture an idea in one step, also from a phone: text, plus an optional tag, link and photo. */
export async function captureIdeaAction(_prev: ContentActionState, formData: FormData): Promise<ContentActionState> {
  await requireContentUser();
  const parsed = z
    .object({ workspace_id: id, text: ideaText, link, tags: z.string().max(400).optional() })
    .safeParse({ workspace_id: value(formData, "workspace_id"), text: value(formData, "text"), link: value(formData, "link"), tags: value(formData, "tags") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the idea.", fieldErrors: { [String(parsed.error.issues[0]?.path[0])]: parsed.error.issues[0]?.message } };
  }
  const photo = formData.get("photo");
  const file = photo instanceof File && photo.size > 0 ? photo : null;
  if (file && (!file.type.startsWith("image/") || file.size > MAX_PHOTO_BYTES)) {
    return { error: "The photo must be an image of at most 15 MB.", fieldErrors: { photo: "An image of at most 15 MB" } };
  }

  const supabase = await createClient();
  const { data: idea, error } = await supabase
    .from("content_ideas")
    .insert({ workspace_id: parsed.data.workspace_id, text: parsed.data.text, link: parsed.data.link ?? null, tags: parseTags(parsed.data.tags) })
    .select("id")
    .single();
  if (error || !idea) return { error: contentErrorMessage(error) };

  if (file) {
    // The idea exists, so this user may add to it; storage goes through the secret key.
    const path = `ideas/${idea.id}/${randomUUID().slice(0, 8)}-${safeName(file.name)}`;
    const admin = requireAdminClient();
    const upload = await admin.storage.from(CONTENT_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
    if (upload.error) {
      refresh();
      return { ok: true, id: idea.id, message: "Idea saved, but the photo could not be uploaded." };
    }
    await supabase.from("content_ideas").update({ photo_path: path }).eq("id", idea.id);
  }
  refresh();
  return { ok: true, id: idea.id, message: "Idea saved" };
}

/** Edit an idea: text, tags, link, source and extra fields. */
export async function updateIdeaAction(slug: string, ideaId: string, _prev: ContentActionState, formData: FormData): Promise<ContentActionState> {
  await requireContentUser();
  const workspace = await getContentWorkspace(slug);
  const parsed = z
    .object({ text: ideaText, link, tags: z.string().max(400).optional(), source_id: id.optional().or(z.literal("").transform(() => undefined)) })
    .safeParse({
      text: value(formData, "text"),
      link: value(formData, "link"),
      tags: value(formData, "tags"),
      source_id: value(formData, "source_id"),
    });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the idea." };
  const fields = workspace.fields.idea.filter((f) => !f.archived);
  const custom = readCustomFields(formData, fields);
  if (Object.keys(custom.errors).length) return { error: "Check the highlighted fields.", fieldErrors: custom.errors };

  const supabase = await createClient();
  const { data: current } = await supabase.from("content_ideas").select("custom_fields").eq("id", ideaId).maybeSingle();
  if (!current) return { error: "Idea not found." };
  const { error } = await supabase
    .from("content_ideas")
    .update({
      text: parsed.data.text,
      link: parsed.data.link ?? null,
      tags: parseTags(parsed.data.tags),
      source_id: parsed.data.source_id ?? null,
      custom_fields: mergeCustomFields(current.custom_fields, custom.values),
    })
    .eq("id", ideaId);
  if (error) return { error: contentErrorMessage(error) };
  refresh();
  return { ok: true, message: "Idea saved" };
}

const movable: ContentIdeaStatus[] = ["new", "shortlisted", "archived"];

/** Shortlist, archive or move back to the inbox. Converted is set by "Turn into post". */
export async function setIdeaStatusAction(ideaId: string, status: ContentIdeaStatus): Promise<ContentActionState> {
  await requireContentUser();
  if (!movable.includes(status)) return { error: "Not possible." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("content_ideas").update({ status }).eq("id", ideaId).select("id");
  if (error) return { error: contentErrorMessage(error) };
  if (!data?.length) return { error: "You cannot change this idea." };
  refresh();
  return { ok: true, message: status === "shortlisted" ? "Shortlisted" : status === "archived" ? "Archived" : "Back in the inbox" };
}

/** Private (only you and admins) or shared with the workspace. */
export async function setIdeaPrivacyAction(ideaId: string, isPrivate: boolean): Promise<ContentActionState> {
  await requireContentUser();
  const supabase = await createClient();
  const { data, error } = await supabase.from("content_ideas").update({ is_private: isPrivate }).eq("id", ideaId).select("id");
  if (error) return { error: contentErrorMessage(error) };
  if (!data?.length) return { error: "You cannot change this idea." };
  refresh();
  return { ok: true, message: isPrivate ? "Only you can see this idea" : "Shared with the workspace" };
}

/** Merge the selected ideas into one of them. */
export async function mergeIdeasAction(targetId: string, otherIds: string[]): Promise<ContentActionState> {
  await requireContentUser();
  const ids = z.array(id).min(1, { error: "Select at least two ideas" }).max(50).safeParse(otherIds.filter((o) => o !== targetId));
  if (!id.safeParse(targetId).success || !ids.success) return { error: "Select at least two ideas." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("content_merge_ideas", { p_target: targetId, p_others: ids.data });
  if (error) return { error: contentErrorMessage(error) };
  refresh();
  return { ok: true, message: `${ids.data.length + 1} ideas merged` };
}

/** Turn one or more ideas into a draft post, then open it. */
export async function ideasToPostAction(slug: string, ideaIds: string[], title: string): Promise<ContentActionState> {
  await requireContentUser();
  const ids = z.array(id).min(1).max(20).safeParse(ideaIds);
  if (!ids.success) return { error: "Select at least one idea." };
  const supabase = await createClient();
  const { data: postId, error } = await supabase.rpc("content_ideas_to_post", { p_ideas: ids.data, p_title: title.trim().slice(0, 300) });
  if (error || !postId) return { error: contentErrorMessage(error) };
  refresh();
  redirect(`/content/w/${slug}/posts/${postId}`);
}
