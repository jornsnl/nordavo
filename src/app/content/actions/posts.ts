"use server";

import { sendContentMailSoon } from "@/lib/content/notify";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getContentWorkspace, requireContentUser } from "@/lib/content/data";
import { contentErrorMessage, type ContentActionState } from "@/lib/content/errors";
import { mergeCustomFields, readCustomFields } from "@/lib/content/forms";
import { changesBetween, toCodePointOffset } from "@/lib/content/diff";
import { isDay, isTextField, textFields } from "@/lib/content/rules";
import type { ContentPostRow, ContentTextField } from "@/lib/content/database";

/**
 * Writes of posts and the editor. The triggers on content_posts enforce the
 * status flow and the field rules for everyone; these actions validate input
 * and turn the database's messages into something to show.
 */

const id = z.guid({ error: "Not found" });

function value(formData: FormData, name: string) {
  const v = formData.get(name);
  return typeof v === "string" ? v.trim() : "";
}

function orNull(v: string) {
  return v === "" ? null : v;
}

function refresh(slug: string, postId?: string) {
  if (postId) revalidatePath(`/content/w/${slug}/posts/${postId}`, "layout");
  revalidatePath(`/content/w/${slug}`, "layout");
  // A status change, suggestion or comment may have queued notifications.
  sendContentMailSoon();
}

/** A new draft in the workspace, opened at once. */
export async function createPostAction(slug: string): Promise<ContentActionState> {
  await requireContentUser();
  const workspace = await getContentWorkspace(slug);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("content_posts")
    .insert({ workspace_id: workspace.id, title: "Untitled post", channel: workspace.options.channel.find((o) => !o.archived)?.value ?? "linkedin" })
    .select("id")
    .single();
  if (error || !data) return { error: contentErrorMessage(error) };
  refresh(slug);
  redirect(`/content/w/${slug}/posts/${data.id}`);
}

/** Everything about a post apart from its text: dates, dropdowns, series, source, notes and extra fields. */
export async function updatePostFieldsAction(
  slug: string,
  postId: string,
  _prev: ContentActionState,
  formData: FormData,
): Promise<ContentActionState> {
  await requireContentUser();
  const workspace = await getContentWorkspace(slug);
  const plannedDate = value(formData, "planned_date");
  if (plannedDate && !isDay(plannedDate)) return { error: "Check the date.", fieldErrors: { planned_date: "Enter a date" } };
  const series = value(formData, "series_id");
  const source = value(formData, "source_id");
  if ((series && !id.safeParse(series).success) || (source && !id.safeParse(source).success)) return { error: "Check the fields." };
  const notes = value(formData, "notes");
  if (notes.length > 10_000) return { error: "Notes are at most 10,000 characters." };

  // Only offer values that exist in the option lists (or the stored one).
  const lists = ["channel", "language", "audience", "theme", "angle", "format", "priority", "time_slot"] as const;
  const picked: Record<string, string | null> = {};
  for (const list of lists) {
    const v = value(formData, list);
    if (v && !workspace.options[list].some((o) => o.value === v)) return { error: `Unknown ${list.replace("_", " ")}.` };
    picked[list] = orNull(v);
  }
  const fields = workspace.fields.post.filter((f) => !f.archived);
  const custom = readCustomFields(formData, fields);
  if (Object.keys(custom.errors).length) return { error: "Check the highlighted fields.", fieldErrors: custom.errors };

  const supabase = await createClient();
  const { data: current } = await supabase.from("content_posts").select("custom_fields").eq("id", postId).maybeSingle();
  if (!current) return { error: "Post not found." };
  const update: Partial<ContentPostRow> = {
    channel: picked.channel ?? "linkedin",
    language: picked.language,
    audience: picked.audience,
    theme: picked.theme,
    angle: picked.angle,
    format: picked.format,
    priority: picked.priority,
    time_slot: picked.time_slot,
    planned_date: orNull(plannedDate),
    series_id: orNull(series),
    source_id: orNull(source),
    notes: orNull(notes),
    custom_fields: mergeCustomFields(current.custom_fields, custom.values),
  };
  const { data, error } = await supabase.from("content_posts").update(update).eq("id", postId).select("id");
  if (error) return { error: contentErrorMessage(error) };
  if (!data?.length) return { error: "You cannot change this post." };
  refresh(slug, postId);
  return { ok: true, message: "Saved" };
}

/**
 * Save the text (title, hook, body, closing question, first comment). Each
 * save is a version. Refused when someone else saved in the meantime.
 */
export async function savePostTextAction(slug: string, postId: string, _prev: ContentActionState, formData: FormData): Promise<ContentActionState> {
  await requireContentUser();
  const version = Number(value(formData, "version"));
  const parsed = z
    .object({
      title: z.string().min(1, { error: "Add a title" }).max(300),
      hook: z.string().max(3000, { error: "The hook is at most 3,000 characters" }),
      body: z.string().max(10_000, { error: "The body is at most 10,000 characters" }),
      closing_question: z.string().max(3000),
      first_comment: z.string().max(3000, { error: "The first comment is at most 3,000 characters" }),
    })
    .safeParse({
      title: value(formData, "title"),
      hook: rawText(formData, "hook"),
      body: rawText(formData, "body"),
      closing_question: rawText(formData, "closing_question"),
      first_comment: rawText(formData, "first_comment"),
    });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { error: issue?.message ?? "Check the text.", fieldErrors: { [String(issue?.path[0])]: issue?.message ?? "" } };
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("content_posts")
    .update(parsed.data)
    .eq("id", postId)
    .eq("version", version)
    .select("id, version, status");
  if (error) return { error: contentErrorMessage(error) };
  if (!data?.length) return { error: "Someone saved this post in the meantime. Reload the page to see their version." };
  refresh(slug, postId);
  return { ok: true, message: data[0].status === "changes_requested" ? "Saved, and sent back to changes requested" : "Saved" };
}

/** Text from a textarea: line breaks kept, trailing whitespace dropped. */
function rawText(formData: FormData, name: string) {
  const v = formData.get(name);
  return typeof v === "string" ? v.replace(/\r\n/g, "\n").replace(/\s+$/, "") : "";
}

/** Move a post to another status. The database checks the flow and the rules. */
export async function setPostStatusAction(slug: string, postId: string, status: string): Promise<ContentActionState> {
  await requireContentUser();
  if (!/^[a-z][a-z0-9_]*$/.test(status)) return { error: "Unknown status." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("content_posts").update({ status }).eq("id", postId).select("id, status");
  if (error) return { error: contentErrorMessage(error) };
  if (!data?.length) return { error: "You cannot change this post." };
  refresh(slug, postId);
  return { ok: true, message: "Status changed" };
}

/**
 * Suggestion mode: the edited copy of each text field is compared with the
 * current text, and every change becomes a separate suggestion.
 */
export async function sendSuggestionsAction(slug: string, postId: string, _prev: ContentActionState, formData: FormData): Promise<ContentActionState> {
  await requireContentUser();
  const version = Number(value(formData, "version"));
  const note = value(formData, "note").slice(0, 2000) || null;
  const supabase = await createClient();
  const { data: post } = await supabase.from("content_posts").select("*").eq("id", postId).maybeSingle();
  if (!post) return { error: "Post not found." };
  if (post.version !== version) return { error: "The text changed in the meantime. Reload the page and suggest again." };

  const rows: { post_id: string; field: ContentTextField; start_offset: number; original_text: string; replacement_text: string; note: string | null; base_version: number }[] = [];
  for (const { value: field } of textFields) {
    const edited = formData.get(`edit_${field}`);
    if (typeof edited !== "string") continue;
    const original = post[field] ?? "";
    const next = field === "title" ? edited.trim() : edited.replace(/\r\n/g, "\n");
    for (const change of changesBetween(original, next)) {
      rows.push({
        post_id: postId,
        field,
        start_offset: toCodePointOffset(original, change.start),
        original_text: change.original,
        replacement_text: change.replacement,
        note,
        base_version: post.version,
      });
    }
  }
  if (rows.length === 0) return { error: "Change the text first: every change becomes a suggestion." };
  if (rows.length > 100) return { error: "That is more than 100 changes. Suggest in smaller steps, or leave a comment." };
  const { error } = await supabase.from("content_suggestions").insert(rows);
  if (error) return { error: contentErrorMessage(error) };
  refresh(slug, postId);
  return { ok: true, message: rows.length === 1 ? "1 suggestion sent" : `${rows.length} suggestions sent` };
}

export async function acceptSuggestionAction(slug: string, postId: string, suggestionId: string): Promise<ContentActionState> {
  await requireContentUser();
  if (!id.safeParse(suggestionId).success) return { error: "Not found." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("content_accept_suggestion", { p_suggestion: suggestionId });
  refresh(slug, postId);
  if (error) return { error: contentErrorMessage(error) };
  return { ok: true, message: "Accepted" };
}

export async function rejectSuggestionAction(slug: string, postId: string, suggestionId: string): Promise<ContentActionState> {
  await requireContentUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("content_suggestions")
    .update({ status: "rejected" })
    .eq("id", suggestionId)
    .eq("status", "pending")
    .select("id");
  if (error) return { error: contentErrorMessage(error) };
  if (!data?.length) return { error: "Only the author can reject suggestions." };
  refresh(slug, postId);
  return { ok: true, message: "Rejected" };
}

/** Accept or reject every open suggestion, back to front per field so offsets stay valid. */
export async function decideAllSuggestionsAction(slug: string, postId: string, accept: boolean): Promise<ContentActionState> {
  await requireContentUser();
  const supabase = await createClient();
  const { data: open } = await supabase
    .from("content_suggestions")
    .select("id, field, start_offset")
    .eq("post_id", postId)
    .eq("status", "pending")
    .order("start_offset", { ascending: false });
  if (!open?.length) return { ok: true, message: "Nothing open" };
  if (!accept) {
    const { data, error } = await supabase.from("content_suggestions").update({ status: "rejected" }).eq("post_id", postId).eq("status", "pending").select("id");
    if (error) return { error: contentErrorMessage(error) };
    if (!data?.length) return { error: "Only the author can reject suggestions." };
    refresh(slug, postId);
    return { ok: true, message: `${data.length} rejected` };
  }
  let done = 0;
  let failed = 0;
  let firstError: string | null = null;
  for (const s of open) {
    const { error } = await supabase.rpc("content_accept_suggestion", { p_suggestion: s.id });
    if (error) {
      failed++;
      firstError ??= contentErrorMessage(error);
    } else done++;
  }
  refresh(slug, postId);
  if (done === 0) return { error: firstError ?? "Nothing could be accepted." };
  return { ok: true, message: failed ? `${done} accepted, ${failed} no longer fit the text` : `${done} accepted` };
}

/** A comment on a selected piece of text, or a reply. Feedback never goes into the text. */
export async function addCommentAction(slug: string, postId: string, _prev: ContentActionState, formData: FormData): Promise<ContentActionState> {
  await requireContentUser();
  const body = value(formData, "body");
  if (!body) return { error: "Write a comment.", fieldErrors: { body: "Write a comment" } };
  if (body.length > 5000) return { error: "At most 5,000 characters." };
  const parent = value(formData, "parent_id");
  const field = value(formData, "field");
  const quote = value(formData, "quote").slice(0, 2000);
  const start = Number(value(formData, "start_offset"));
  const supabase = await createClient();
  const { error } = await supabase.from("content_comments").insert({
    post_id: postId,
    body,
    parent_id: parent && id.safeParse(parent).success ? parent : null,
    field: !parent && isTextField(field) && quote ? field : null,
    quote: !parent && quote ? quote : null,
    start_offset: !parent && quote && Number.isInteger(start) && start >= 0 ? start : null,
  });
  if (error) return { error: contentErrorMessage(error) };
  refresh(slug, postId);
  return { ok: true, message: parent ? "Reply added" : "Comment added" };
}

export async function resolveCommentAction(slug: string, postId: string, commentId: string, resolved: boolean): Promise<ContentActionState> {
  await requireContentUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("content_comments")
    .update({ resolved_at: resolved ? new Date().toISOString() : null })
    .eq("id", commentId)
    .select("id");
  if (error) return { error: contentErrorMessage(error) };
  if (!data?.length) return { error: "You cannot change this comment." };
  refresh(slug, postId);
  return { ok: true, message: resolved ? "Resolved" : "Reopened" };
}

/** After publishing: a note for a follow up post, which lands in the Ideas inbox. Empty text skips it. */
export async function nextIdeaAction(slug: string, postId: string, _prev: ContentActionState, formData: FormData): Promise<ContentActionState> {
  await requireContentUser();
  const supabase = await createClient();
  const { data: post } = await supabase.from("content_posts").select("id, workspace_id, published_at").eq("id", postId).maybeSingle();
  if (!post?.published_at) return { error: "The next idea is asked once the post is published." };
  const text = value(formData, "text");
  if (text) {
    if (text.length > 5000) return { error: "At most 5,000 characters." };
    const { error } = await supabase.from("content_ideas").insert({ workspace_id: post.workspace_id, text, from_post_id: postId });
    if (error) return { error: contentErrorMessage(error) };
  }
  const { error } = await supabase.from("content_posts").update({ next_idea_done_at: new Date().toISOString() }).eq("id", postId);
  if (error) return { error: contentErrorMessage(error) };
  refresh(slug, postId);
  return { ok: true, message: text ? "Next idea saved in the inbox" : "Skipped" };
}

/** Bring back an older version as a new version. */
export async function restoreVersionAction(slug: string, postId: string, version: number): Promise<ContentActionState> {
  await requireContentUser();
  if (!Number.isInteger(version) || version < 1) return { error: "Version not found." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("content_restore_version", { p_post: postId, p_version: version });
  if (error) return { error: contentErrorMessage(error) };
  refresh(slug, postId);
  redirect(`/content/w/${slug}/posts/${postId}`);
}
