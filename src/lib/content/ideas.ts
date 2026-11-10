import "server-only";
import { createClient } from "@/lib/supabase/server";
import { check, peopleById, signedUrls, type ContentWorkspace, type Person } from "@/lib/content/data";
import type { ContentIdeaRow, ContentIdeaStatus } from "@/lib/content/database";
import { customValues } from "@/lib/content/forms";
import type { CustomValue } from "@/lib/content/rules";

/**
 * Reads of ideas. RLS keeps ideas private to their author (and admins)
 * unless shared, and never shows them to reviewers.
 */

export type IdeaView = "inbox" | "shortlist" | "archive";

export function parseIdeaView(value: string | undefined): IdeaView {
  return value === "shortlist" || value === "archive" ? value : "inbox";
}

const viewStatuses: Record<IdeaView, ContentIdeaStatus[]> = {
  inbox: ["new"],
  shortlist: ["shortlisted"],
  archive: ["converted", "archived"],
};

export type IdeaItem = {
  id: string;
  text: string;
  tags: string[];
  link: string | null;
  photoUrl: string | null;
  sourceId: string | null;
  sourceLabel: string | null;
  status: ContentIdeaStatus;
  isPrivate: boolean;
  author: Person | null;
  isMine: boolean;
  fromPost: { id: string; title: string } | null;
  posts: { id: string; title: string; status: string }[];
  mergedInto: string | null;
  customFields: Record<string, CustomValue>;
  createdAt: string;
};

export async function listIdeas(workspace: ContentWorkspace, userId: string, view: IdeaView): Promise<IdeaItem[]> {
  const supabase = await createClient();
  const rows = check(
    await supabase
      .from("content_ideas")
      .select("*")
      .eq("workspace_id", workspace.id)
      .in("status", viewStatuses[view])
      .order("created_at", { ascending: false })
      .limit(300),
    "ideas",
  );
  return enrichIdeas(rows, userId);
}

export async function countIdeas(workspaceId: string): Promise<Record<IdeaView, number>> {
  const supabase = await createClient();
  const rows = check(await supabase.from("content_ideas").select("status").eq("workspace_id", workspaceId), "ideas");
  const counts: Record<IdeaView, number> = { inbox: 0, shortlist: 0, archive: 0 };
  for (const row of rows) {
    if (row.status === "new") counts.inbox++;
    else if (row.status === "shortlisted") counts.shortlist++;
    else counts.archive++;
  }
  return counts;
}

async function enrichIdeas(rows: ContentIdeaRow[], userId: string): Promise<IdeaItem[]> {
  if (rows.length === 0) return [];
  const supabase = await createClient();
  const ids = rows.map((r) => r.id);
  const sourceIds = [...new Set(rows.map((r) => r.source_id).filter((v): v is string => Boolean(v)))];
  const fromIds = [...new Set(rows.map((r) => r.from_post_id).filter((v): v is string => Boolean(v)))];
  const [links, sources, people, photos] = await Promise.all([
    supabase.from("content_idea_posts").select("idea_id, post_id").in("idea_id", ids),
    sourceIds.length ? supabase.from("content_sources").select("id, title, url").in("id", sourceIds) : Promise.resolve({ data: [], error: null }),
    peopleById(rows.map((r) => r.author_id)),
    signedUrls(rows.map((r) => r.photo_path)),
  ]);
  const linkRows = check(links, "idea links");
  const postIds = [...new Set([...linkRows.map((l) => l.post_id), ...fromIds])];
  const posts = postIds.length
    ? check(await supabase.from("content_posts").select("id, title, status").in("id", postIds), "posts")
    : [];
  const postMap = new Map(posts.map((p) => [p.id, p]));
  const sourceMap = new Map(check(sources, "sources").map((s) => [s.id, s.title || s.url || "Source"]));

  return rows.map((r) => ({
    id: r.id,
    text: r.text,
    tags: r.tags,
    link: r.link,
    photoUrl: r.photo_path ? (photos.get(r.photo_path) ?? null) : null,
    sourceId: r.source_id,
    sourceLabel: r.source_id ? (sourceMap.get(r.source_id) ?? null) : null,
    status: r.status,
    isPrivate: r.is_private,
    author: r.author_id ? (people.get(r.author_id) ?? null) : null,
    isMine: r.author_id === userId,
    fromPost: r.from_post_id && postMap.get(r.from_post_id) ? { id: r.from_post_id, title: postMap.get(r.from_post_id)!.title } : null,
    posts: linkRows
      .filter((l) => l.idea_id === r.id)
      .map((l) => postMap.get(l.post_id))
      .filter((p): p is { id: string; title: string; status: string } => Boolean(p)),
    mergedInto: r.merged_into,
    customFields: customValues(r.custom_fields),
    createdAt: r.created_at,
  }));
}

/** Sources of the workspace, for pickers. */
export async function listSourceChoices(workspaceId: string): Promise<{ value: string; label: string }[]> {
  const supabase = await createClient();
  const rows = check(
    await supabase
      .from("content_sources")
      .select("id, title, url, platform")
      .eq("workspace_id", workspaceId)
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(300),
    "sources",
  );
  return rows.map((s) => ({ value: s.id, label: s.title || s.url || "Untitled source" }));
}
