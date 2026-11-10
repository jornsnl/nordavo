import "server-only";
import { createClient } from "@/lib/supabase/server";
import { check, signedUrls } from "@/lib/content/data";
import type { ContentSourceRow } from "@/lib/content/database";
import { DONE_STATUSES, OFF_STATUSES } from "@/lib/content/rules";

/** Reads of sources (Reddit, X, news, own experience) and series of a workspace. */

export type LinkedItem = { id: string; label: string; status: string; plannedDate?: string | null };

export type SourceItem = {
  id: string;
  url: string | null;
  platform: string | null;
  title: string | null;
  upvotes: number | null;
  commentsCount: number | null;
  sourceDate: string | null;
  screenshotUrl: string | null;
  hasScreenshot: boolean;
  namesBlurred: boolean;
  screenshotInstruction: string | null;
  archived: boolean;
  createdAt: string;
  ideas: LinkedItem[];
  posts: LinkedItem[];
};

function sourceLabel(row: Pick<ContentSourceRow, "title" | "url">) {
  return row.title || row.url || "Source";
}

export async function listSources(workspaceId: string, { includeArchived = false } = {}): Promise<SourceItem[]> {
  const supabase = await createClient();
  let query = supabase.from("content_sources").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(500);
  if (!includeArchived) query = query.is("archived_at", null);
  const rows = check(await query, "sources");
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [ideas, posts, urls] = await Promise.all([
    supabase.from("content_ideas").select("id, text, status, source_id").in("source_id", ids),
    supabase.from("content_posts").select("id, title, status, planned_date, source_id").in("source_id", ids),
    signedUrls(rows.map((r) => r.screenshot_path)),
  ]);
  const ideaRows = check(ideas, "ideas");
  const postRows = check(posts, "posts");
  return rows.map((r) => ({
    id: r.id,
    url: r.url,
    platform: r.platform,
    title: r.title,
    upvotes: r.upvotes,
    commentsCount: r.comments_count,
    sourceDate: r.source_date,
    screenshotUrl: r.screenshot_path ? (urls.get(r.screenshot_path) ?? null) : null,
    hasScreenshot: Boolean(r.screenshot_path),
    namesBlurred: r.names_blurred,
    screenshotInstruction: r.screenshot_instruction,
    archived: Boolean(r.archived_at),
    createdAt: r.created_at,
    ideas: ideaRows.filter((i) => i.source_id === r.id).map((i) => ({ id: i.id, label: i.text.slice(0, 120), status: i.status })),
    posts: postRows
      .filter((p) => p.source_id === r.id)
      .map((p) => ({ id: p.id, label: p.title, status: p.status, plannedDate: p.planned_date })),
  }));
}

/** Sources to pick from in a post or idea form. */
export async function sourceChoices(workspaceId: string): Promise<{ value: string; label: string }[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("content_sources")
    .select("id, title, url")
    .eq("workspace_id", workspaceId)
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(300);
  return (data ?? []).map((r) => ({ value: r.id, label: sourceLabel(r).slice(0, 100) }));
}

export type SeriesItem = {
  id: string;
  name: string;
  description: string | null;
  targetCount: number | null;
  archived: boolean;
  /** Posts published or measured. */
  live: number;
  /** Posts not parked or rejected. */
  active: number;
  byStatus: Record<string, number>;
  posts: LinkedItem[];
};

export async function listSeries(workspaceId: string, { includeArchived = false } = {}): Promise<SeriesItem[]> {
  const supabase = await createClient();
  let query = supabase.from("content_series").select("*").eq("workspace_id", workspaceId).order("name");
  if (!includeArchived) query = query.is("archived_at", null);
  const rows = check(await query, "series");
  if (rows.length === 0) return [];
  const { data: posts } = await supabase
    .from("content_posts")
    .select("id, title, status, planned_date, series_id")
    .in(
      "series_id",
      rows.map((r) => r.id),
    )
    .order("planned_date", { ascending: true, nullsFirst: false });
  return rows.map((r) => {
    const list = (posts ?? []).filter((p) => p.series_id === r.id);
    const byStatus: Record<string, number> = {};
    for (const p of list) byStatus[p.status] = (byStatus[p.status] ?? 0) + 1;
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      targetCount: r.target_count,
      archived: Boolean(r.archived_at),
      live: list.filter((p) => DONE_STATUSES.includes(p.status)).length,
      active: list.filter((p) => !OFF_STATUSES.includes(p.status)).length,
      byStatus,
      posts: list.map((p) => ({ id: p.id, label: p.title, status: p.status, plannedDate: p.planned_date })),
    };
  });
}

/** Series to pick from in a post form. */
export async function seriesChoices(workspaceId: string): Promise<{ value: string; label: string }[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("content_series").select("id, name").eq("workspace_id", workspaceId).is("archived_at", null).order("name");
  return (data ?? []).map((r) => ({ value: r.id, label: r.name }));
}

/** Progress as a percentage of the target (null without a target). */
export function seriesProgress(series: Pick<SeriesItem, "live" | "targetCount">): number | null {
  if (!series.targetCount) return null;
  return Math.min(100, Math.round((series.live / series.targetCount) * 100));
}
