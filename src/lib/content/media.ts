import "server-only";
import { createClient } from "@/lib/supabase/server";
import { check, peopleById, signedUrls, type ContentWorkspace } from "@/lib/content/data";
import type { ContentImageBrief, ContentMediaRow, ContentSuggestedBy } from "@/lib/content/database";
import { dayKey, parseImageBrief, reuseWarning } from "@/lib/content/rules";
import { customValues } from "@/lib/content/forms";
import type { CustomValue } from "@/lib/content/rules";
import {
  mediaKind,
  parseMediaSuggestion,
  type MediaFilters,
  type MediaFacets,
  type MediaKind,
  type MediaSuggestion,
} from "@/lib/content/media-utils";

export { mediaKind, parseMediaFilters, parseMediaSuggestion, formatBytes } from "@/lib/content/media-utils";
export type { MediaFilters, MediaFacets, MediaKind, MediaSuggestion } from "@/lib/content/media-utils";

/**
 * Reads of the media library: files of a workspace or of the shared company
 * library (workspace_id null), where they were used, the chosen media of a
 * post and its image suggestions. RLS decides what comes back; thumbnails
 * are signed URLs made after that.
 */

export type MediaUse = {
  postId: string;
  title: string;
  /** Date it went live (published) or is planned. */
  date: string | null;
  published: boolean;
  workspaceSlug: string | null;
};

export type MediaItem = {
  id: string;
  workspaceId: string | null;
  fileName: string;
  mimeType: string | null;
  kind: MediaKind;
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
  folder: string | null;
  source: "upload" | "drive";
  takenOn: string | null;
  people: string[];
  authorInPhoto: boolean | null;
  setting: string | null;
  mood: string | null;
  clothing: string | null;
  orientation: ContentMediaRow["orientation"];
  usableForLinkedin: boolean;
  doNotUse: boolean;
  description: string | null;
  tags: string[];
  suggested: MediaSuggestion | null;
  customFields: Record<string, CustomValue>;
  createdAt: string;
  /** Signed URL of the file (an hour), for thumbnails and previews. */
  url: string | null;
  uses: MediaUse[];
  /** Days the file went live. */
  usedOn: string[];
};

const MEDIA_COLUMNS =
  "id, workspace_id, storage_path, file_name, mime_type, size_bytes, width, height, folder, source, drive_file_id, taken_on, people, author_in_photo, setting, mood, clothing, orientation, usable_for_linkedin, do_not_use, description, tags, suggested, suggested_at, custom_fields, uploaded_by, created_at, updated_at";

/** Where each file was used (published) or is planned (chosen on a post that is not live yet). */
async function usesFor(mediaIds: string[]): Promise<Map<string, MediaUse[]>> {
  const map = new Map<string, MediaUse[]>();
  if (mediaIds.length === 0) return map;
  const supabase = await createClient();
  const usage: { media_id: string; post_id: string; used_on: string }[] = [];
  const chosen: { media_id: string; post_id: string }[] = [];
  for (let i = 0; i < mediaIds.length; i += 200) {
    const slice = mediaIds.slice(i, i + 200);
    const [u, c] = await Promise.all([
      supabase.from("content_media_usage").select("media_id, post_id, used_on").in("media_id", slice),
      supabase.from("content_post_media").select("media_id, post_id").in("media_id", slice),
    ]);
    usage.push(...check(u, "media usage"));
    chosen.push(...check(c, "chosen media"));
  }
  const postIds = [...new Set([...usage.map((u) => u.post_id), ...chosen.map((c) => c.post_id)])];
  const posts = new Map<string, { title: string; planned_date: string | null; status: string; workspace_id: string }>();
  const slugs = new Map<string, string>();
  if (postIds.length) {
    for (let i = 0; i < postIds.length; i += 200) {
      const { data } = await supabase
        .from("content_posts")
        .select("id, title, planned_date, status, workspace_id")
        .in("id", postIds.slice(i, i + 200));
      for (const p of data ?? []) posts.set(p.id, p);
    }
    const wsIds = [...new Set([...posts.values()].map((p) => p.workspace_id))];
    if (wsIds.length) {
      const { data } = await supabase.from("content_workspaces").select("id, slug").in("id", wsIds);
      for (const w of data ?? []) slugs.set(w.id, w.slug);
    }
  }
  const published = new Set(usage.map((u) => `${u.media_id}:${u.post_id}`));
  for (const u of usage) {
    const post = posts.get(u.post_id);
    const list = map.get(u.media_id) ?? [];
    list.push({
      postId: u.post_id,
      title: post?.title ?? "A post you cannot open",
      date: u.used_on,
      published: true,
      workspaceSlug: post ? (slugs.get(post.workspace_id) ?? null) : null,
    });
    map.set(u.media_id, list);
  }
  for (const c of chosen) {
    if (published.has(`${c.media_id}:${c.post_id}`)) continue;
    const post = posts.get(c.post_id);
    // Posts this user cannot see (drafts, for a reviewer) are left out.
    if (!post || post.status === "rejected") continue;
    const list = map.get(c.media_id) ?? [];
    list.push({
      postId: c.post_id,
      title: post.title,
      date: post.planned_date,
      published: false,
      workspaceSlug: slugs.get(post.workspace_id) ?? null,
    });
    map.set(c.media_id, list);
  }
  for (const list of map.values()) list.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  return map;
}

function toItem(row: ContentMediaRow, url: string | null, uses: MediaUse[]): MediaItem {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    fileName: row.file_name,
    mimeType: row.mime_type,
    kind: mediaKind(row.mime_type),
    sizeBytes: row.size_bytes,
    width: row.width,
    height: row.height,
    folder: row.folder,
    source: row.source,
    takenOn: row.taken_on,
    people: row.people,
    authorInPhoto: row.author_in_photo,
    setting: row.setting,
    mood: row.mood,
    clothing: row.clothing,
    orientation: row.orientation,
    usableForLinkedin: row.usable_for_linkedin,
    doNotUse: row.do_not_use,
    description: row.description,
    tags: row.tags,
    suggested: parseMediaSuggestion(row.suggested),
    customFields: customValues(row.custom_fields),
    createdAt: row.created_at,
    url,
    uses,
    usedOn: uses.filter((u) => u.published && u.date).map((u) => u.date!),
  };
}

async function itemsFrom(rows: ContentMediaRow[]): Promise<MediaItem[]> {
  const [urls, uses] = await Promise.all([
    signedUrls(rows.filter((r) => mediaKind(r.mime_type) !== "other").map((r) => r.storage_path)),
    usesFor(rows.map((r) => r.id)),
  ]);
  return rows.map((r) => toItem(r, urls.get(r.storage_path) ?? null, uses.get(r.id) ?? []));
}

/** Files of a library (a workspace id, or null for the company library), filtered. */
export async function listMedia(
  workspaceId: string | null,
  filters: MediaFilters = {},
): Promise<{ items: MediaItem[]; facets: MediaFacets; total: number }> {
  const supabase = await createClient();
  let query = supabase.from("content_media").select(MEDIA_COLUMNS).order("taken_on", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false }).limit(1000);
  query = workspaceId ? query.eq("workspace_id", workspaceId) : query.is("workspace_id", null);
  const rows = check(await query, "media") as ContentMediaRow[];

  const facets: MediaFacets = {
    people: [...new Set(rows.flatMap((r) => r.people))].sort(),
    settings: [...new Set(rows.map((r) => r.setting).filter((s): s is string => Boolean(s)))].sort(),
    tags: [...new Set(rows.flatMap((r) => r.tags))].sort(),
    folders: [...new Set(rows.map((r) => r.folder).filter((s): s is string => Boolean(s)))].sort(),
  };

  const q = filters.q?.toLowerCase();
  const filtered = rows.filter(
    (r) =>
      (!filters.undescribed || !r.description) &&
      (!filters.person || r.people.includes(filters.person)) &&
      (!filters.setting || r.setting === filters.setting) &&
      (!filters.tag || r.tags.includes(filters.tag)) &&
      (!filters.folder || r.folder === filters.folder || (r.folder ?? "").startsWith(`${filters.folder}/`)) &&
      (!q ||
        r.file_name.toLowerCase().includes(q) ||
        (r.description ?? "").toLowerCase().includes(q) ||
        r.tags.some((t) => t.includes(q)) ||
        r.people.some((p) => p.toLowerCase().includes(q))),
  );
  let items = await itemsFrom(filtered);
  if (filters.unused) items = items.filter((i) => i.uses.length === 0);
  return { items, facets, total: rows.length };
}

export async function getMedia(id: string): Promise<MediaItem | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("content_media").select(MEDIA_COLUMNS).eq("id", id).maybeSingle();
  if (!data) return null;
  const [item] = await itemsFrom([data as ContentMediaRow]);
  return item;
}

// ---------------------------------------------------------------------------
// Media of a post
// ---------------------------------------------------------------------------

export type PickerItem = {
  id: string;
  fileName: string;
  kind: MediaKind;
  url: string | null;
  library: "workspace" | "company";
  folder: string | null;
  description: string | null;
  tags: string[];
  people: string[];
  doNotUse: boolean;
  usableForLinkedin: boolean;
  reuseWarning: string | null;
};

export type ImageSuggestionItem = {
  id: string;
  mediaId: string;
  fileName: string;
  kind: MediaKind;
  url: string | null;
  reason: string | null;
  score: number | null;
  status: "pending" | "picked" | "rejected";
  suggestedBy: ContentSuggestedBy;
  createdBy: string | null;
  reuseWarning: string | null;
};

export type PostMediaData = {
  post: {
    id: string;
    title: string;
    status: string;
    format: string | null;
    authorId: string | null;
    imageBrief: ContentImageBrief | null;
    imageBriefBy: ContentSuggestedBy | null;
    imageBriefDone: boolean;
  };
  chosen: (PickerItem & { position: number })[];
  suggestions: ImageSuggestionItem[];
  library: PickerItem[];
  people: Awaited<ReturnType<typeof peopleById>>;
};

/** Chosen media, image suggestions, the brief and the library to pick from, for one post. */
export async function loadPostMedia(workspace: ContentWorkspace, postId: string): Promise<PostMediaData | null> {
  const supabase = await createClient();
  const { data: post } = await supabase
    .from("content_posts")
    .select("id, title, status, format, author_id, workspace_id, image_brief, image_brief_by, image_brief_done_at")
    .eq("id", postId)
    .maybeSingle();
  if (!post || post.workspace_id !== workspace.id) return null;

  const [chosenRows, suggestionRows, libraryRows] = await Promise.all([
    supabase.from("content_post_media").select("media_id, position").eq("post_id", postId).order("position"),
    supabase
      .from("content_image_suggestions")
      .select("id, media_id, reason, score, status, suggested_by, created_by, created_at")
      .eq("post_id", postId)
      .order("created_at", { ascending: false })
      .limit(30),
    supabase
      .from("content_media")
      .select(MEDIA_COLUMNS)
      .or(`workspace_id.eq.${workspace.id},workspace_id.is.null`)
      .order("taken_on", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(1000),
  ]);
  const rows = check(libraryRows, "media") as ContentMediaRow[];
  const items = await itemsFrom(rows);
  const byId = new Map(items.map((i) => [i.id, i]));
  const today = dayKey();

  const picker = (item: MediaItem): PickerItem => ({
    id: item.id,
    fileName: item.fileName,
    kind: item.kind,
    url: item.url,
    library: item.workspaceId ? "workspace" : "company",
    folder: item.folder,
    description: item.description,
    tags: item.tags,
    people: item.people,
    doNotUse: item.doNotUse,
    usableForLinkedin: item.usableForLinkedin,
    reuseWarning: reuseWarning(
      item.uses.filter((u) => u.postId !== postId && u.published && u.date).map((u) => u.date!),
      today,
      workspace.mediaReuseMonths,
    ),
  });

  const chosen = check(chosenRows, "chosen media")
    .map((c) => {
      const item = byId.get(c.media_id);
      return item ? { ...picker(item), position: c.position } : null;
    })
    .filter((c): c is PickerItem & { position: number } => c !== null);

  const suggestions = check(suggestionRows, "image suggestions")
    .map((s): ImageSuggestionItem | null => {
      const item = byId.get(s.media_id);
      if (!item) return null;
      return {
        id: s.id,
        mediaId: s.media_id,
        fileName: item.fileName,
        kind: item.kind,
        url: item.url,
        reason: s.reason,
        score: s.score,
        status: s.status,
        suggestedBy: s.suggested_by,
        createdBy: s.created_by,
        reuseWarning: picker(item).reuseWarning,
      };
    })
    .filter((s): s is ImageSuggestionItem => s !== null);

  const people = await peopleById(suggestions.map((s) => s.createdBy));

  return {
    post: {
      id: post.id,
      title: post.title,
      status: post.status,
      format: post.format,
      authorId: post.author_id,
      imageBrief: parseImageBrief(post.image_brief),
      imageBriefBy: post.image_brief_by,
      imageBriefDone: Boolean(post.image_brief_done_at),
    },
    chosen,
    suggestions,
    library: items.filter((i) => i.usableForLinkedin || chosen.some((c) => c.id === i.id)).map(picker),
    people,
  };
}
