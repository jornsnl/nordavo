import "server-only";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { check, formatNeedsMedia, peopleById, type ContentWorkspace, type Person } from "@/lib/content/data";
import type {
  ContentActivityRow,
  ContentCommentRow,
  ContentPostRow,
  ContentPostVersionRow,
  ContentStatusLogRow,
  ContentSuggestionRow,
} from "@/lib/content/database";
import { customValues } from "@/lib/content/forms";
import type { CustomValue, PostForRules } from "@/lib/content/rules";

/**
 * Reads of posts and the editor (versions, suggestions, comments, status
 * log). RLS decides: reviewers only get posts that were sent to review.
 */

export type PostFilters = { status?: string; series?: string; q?: string; /** Only archived posts instead of the live ones. */ archived?: boolean };

export type PostListItem = {
  id: string;
  title: string;
  status: string;
  plannedDate: string | null;
  timeSlot: string | null;
  format: string | null;
  seriesId: string | null;
  author: Person | null;
  updatedAt: string;
  openSuggestions: number;
};

/** Free text to a safe ilike pattern (PostgREST filter characters dropped). */
export function likePattern(raw: string | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[,()"'*:]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  if (cleaned.length < 2) return null;
  return `%${cleaned.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

export async function listPosts(workspace: ContentWorkspace, filters: PostFilters = {}): Promise<PostListItem[]> {
  const supabase = await createClient();
  let query = supabase
    .from("content_posts")
    .select("id, title, status, planned_date, time_slot, format, series_id, author_id, updated_at")
    .eq("workspace_id", workspace.id)
    .order("planned_date", { ascending: true, nullsFirst: false })
    .order("updated_at", { ascending: false })
    .limit(500);
  query = filters.archived ? query.not("archived_at", "is", null) : query.is("archived_at", null);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.series) query = query.eq("series_id", filters.series);
  const pattern = likePattern(filters.q);
  if (pattern) query = query.or(`title.ilike.${pattern},hook.ilike.${pattern},body.ilike.${pattern}`);
  const rows = check(await query, "posts");
  const ids = rows.map((r) => r.id);
  const [people, suggestions] = await Promise.all([
    peopleById(rows.map((r) => r.author_id)),
    ids.length
      ? supabase.from("content_suggestions").select("post_id").in("post_id", ids).eq("status", "pending")
      : Promise.resolve({ data: [], error: null }),
  ]);
  const open = new Map<string, number>();
  for (const s of check(suggestions, "suggestions")) open.set(s.post_id, (open.get(s.post_id) ?? 0) + 1);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    status: r.status,
    plannedDate: r.planned_date,
    timeSlot: r.time_slot,
    format: r.format,
    seriesId: r.series_id,
    author: r.author_id ? (people.get(r.author_id) ?? null) : null,
    updatedAt: r.updated_at,
    openSuggestions: open.get(r.id) ?? 0,
  }));
}

export type SuggestionItem = ContentSuggestionRow & { authorName: string };
export type CommentItem = ContentCommentRow & { authorName: string; replies: (ContentCommentRow & { authorName: string })[] };
export type StatusLogItem = ContentStatusLogRow & { actorName: string };

export type PostDetail = {
  post: ContentPostRow;
  author: Person | null;
  customFields: Record<string, CustomValue>;
  suggestions: SuggestionItem[];
  comments: CommentItem[];
  log: StatusLogItem[];
  /** The activity log of the post (20261121010000): every change, with Claude marked. */
  activity: (ContentActivityRow & { actorName: string })[];
  ideas: { id: string; text: string }[];
  rules: PostForRules;
};

export async function getPostDetail(workspace: ContentWorkspace, id: string): Promise<PostDetail> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const { data: post, error } = await supabase.from("content_posts").select("*").eq("id", id).eq("workspace_id", workspace.id).maybeSingle();
  if (error) throw new Error(`Loading the post failed: ${error.message}`);
  if (!post) notFound();

  const [suggestions, comments, log, links, media, results, activity] = await Promise.all([
    supabase.from("content_suggestions").select("*").eq("post_id", id).eq("status", "pending").order("start_offset"),
    supabase.from("content_comments").select("*").eq("post_id", id).order("created_at"),
    supabase.from("content_status_log").select("*").eq("post_id", id).order("created_at", { ascending: false }),
    supabase.from("content_idea_posts").select("idea_id").eq("post_id", id),
    supabase.from("content_post_media").select("media_id").eq("post_id", id),
    supabase.from("content_results").select("measured_after").eq("post_id", id),
    supabase.from("content_activity").select("*").eq("post_id", id).order("created_at", { ascending: false }).limit(60),
  ]);
  const activityRows = check(activity, "activity");
  const suggestionRows = check(suggestions, "suggestions");
  const commentRows = check(comments, "comments");
  const logRows = check(log, "status log");
  const ideaIds = check(links, "idea links").map((l) => l.idea_id);
  // Ideas may be private: RLS only returns the ones this user can see.
  const ideas = ideaIds.length
    ? check(await supabase.from("content_ideas").select("id, text").in("id", ideaIds), "ideas")
    : [];
  const people = await peopleById([
    post.author_id,
    ...suggestionRows.map((s) => s.author_id),
    ...commentRows.map((c) => c.author_id),
    ...logRows.map((l) => l.actor_id),
    ...activityRows.map((a) => a.actor_id),
  ]);
  const name = (uid: string | null, fallback = "Someone") => (uid && people.get(uid)?.name) || fallback;

  const roots = commentRows.filter((c) => !c.parent_id);
  return {
    post,
    author: post.author_id ? (people.get(post.author_id) ?? null) : null,
    customFields: customValues(post.custom_fields),
    suggestions: suggestionRows.map((s) => ({ ...s, authorName: s.suggested_by === "claude" ? "Claude" : name(s.author_id) })),
    comments: roots.map((c) => ({
      ...c,
      authorName: name(c.author_id),
      replies: commentRows.filter((r) => r.parent_id === c.id).map((r) => ({ ...r, authorName: name(r.author_id) })),
    })),
    log: logRows.map((l) => ({ ...l, actorName: byLine(l.source, name(l.actor_id, "System")) })),
    activity: activityRows.map((a) => ({ ...a, actorName: byLine(a.source, name(a.actor_id, "System")) })),
    ideas,
    rules: {
      status: post.status,
      authorId: post.author_id,
      approvedAt: post.approved_at,
      publishedAt: post.published_at,
      plannedDate: post.planned_date,
      timeSlot: post.time_slot,
      linkedinUrl: post.linkedin_url,
      formatNeedsMedia: formatNeedsMedia(workspace, post.format),
      mediaCount: check(media, "media").length,
      has7dResults: check(results, "results").some((r) => r.measured_after === "7d"),
    },
  };
}

/** "Claude (for Julius)" for what Claude did with someone's token; the name otherwise. */
export function byLine(source: string | null | undefined, actorName: string): string {
  return source === "claude" ? `Claude (for ${actorName})` : actorName;
}

export type VersionItem = ContentPostVersionRow & { editorName: string };

export async function listVersions(workspace: ContentWorkspace, postId: string): Promise<{ title: string; versions: VersionItem[] }> {
  if (!/^[0-9a-f-]{36}$/i.test(postId)) notFound();
  const supabase = await createClient();
  const { data: post } = await supabase.from("content_posts").select("id, title").eq("id", postId).eq("workspace_id", workspace.id).maybeSingle();
  if (!post) notFound();
  const rows = check(
    await supabase.from("content_post_versions").select("*").eq("post_id", postId).order("version", { ascending: false }),
    "versions",
  );
  const people = await peopleById(rows.map((r) => r.edited_by));
  return {
    title: post.title,
    versions: rows.map((r) => ({ ...r, editorName: byLine(r.source, (r.edited_by && people.get(r.edited_by)?.name) || "System") })),
  };
}

/** Series of the workspace, for pickers and filters. */
export async function listSeriesChoices(workspaceId: string): Promise<{ value: string; label: string }[]> {
  const supabase = await createClient();
  const rows = check(
    await supabase.from("content_series").select("id, name").eq("workspace_id", workspaceId).is("archived_at", null).order("name"),
    "series",
  );
  return rows.map((s) => ({ value: s.id, label: s.name }));
}

/** Posts and ideas of the workspace for relation fields. */
export async function relationChoices(workspaceId: string) {
  const supabase = await createClient();
  const [posts, ideas] = await Promise.all([
    supabase.from("content_posts").select("id, title").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }).limit(200),
    supabase.from("content_ideas").select("id, text").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(200),
  ]);
  return {
    post: check(posts, "posts").map((p) => ({ value: p.id, label: p.title })),
    idea: check(ideas, "ideas").map((i) => ({ value: i.id, label: i.text.slice(0, 80) })),
  };
}

export async function mediaChoices(workspaceId: string) {
  const supabase = await createClient();
  const rows = check(
    await supabase
      .from("content_media")
      .select("id, file_name, workspace_id")
      .or(`workspace_id.eq.${workspaceId},workspace_id.is.null`)
      .order("created_at", { ascending: false })
      .limit(300),
    "media",
  );
  return rows.map((m) => ({ value: m.id, label: m.workspace_id ? m.file_name : `${m.file_name} (company)` }));
}
