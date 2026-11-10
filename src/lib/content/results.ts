import "server-only";
import { createClient } from "@/lib/supabase/server";
import { check, peopleById, personName, type ContentWorkspace } from "@/lib/content/data";
import type { ContentMeasuredAfter } from "@/lib/content/database";
import { addDays, averagesBy, dayKey, dueMeasurements, engagement, isSuccess, monthStart, type GroupAverage } from "@/lib/content/rules";

/**
 * Results of the content module: per post, the open measurements of a
 * workspace, the dashboard and the reviewer count. RLS applies throughout.
 */

export type Measurement = {
  impressions: number | null;
  likes: number;
  comments: number;
  reposts: number;
  enteredAt: string;
  enteredBy: string | null;
};

export type PostResults = Partial<Record<ContentMeasuredAfter, Measurement>>;

function toMeasurement(row: {
  impressions: number | null;
  likes: number;
  comments: number;
  reposts: number;
  entered_at: string;
  entered_by: string | null;
}): Measurement {
  return {
    impressions: row.impressions,
    likes: row.likes,
    comments: row.comments,
    reposts: row.reposts,
    enteredAt: row.entered_at,
    enteredBy: row.entered_by,
  };
}

export async function loadPostResults(postId: string): Promise<{
  post: { id: string; status: string; publishedAt: string | null } | null;
  results: PostResults;
}> {
  const supabase = await createClient();
  const [post, rows] = await Promise.all([
    supabase.from("content_posts").select("id, status, published_at").eq("id", postId).maybeSingle(),
    supabase.from("content_results").select("*").eq("post_id", postId),
  ]);
  const results: PostResults = {};
  for (const row of check(rows, "results")) results[row.measured_after] = toMeasurement(row);
  return {
    post: post.data ? { id: post.data.id, status: post.data.status, publishedAt: post.data.published_at } : null,
    results,
  };
}

export type OpenMeasurement = {
  postId: string;
  title: string;
  publishedAt: string;
  linkedinUrl: string | null;
  measuredAfter: ContentMeasuredAfter;
  status: string;
};

/** Every measurement that is due and not entered yet, oldest first. */
export async function listOpenMeasurements(workspaceId: string, now = new Date()): Promise<OpenMeasurement[]> {
  const supabase = await createClient();
  const since = addDays(dayKey(now), -60);
  const posts = check(
    await supabase
      .from("content_posts")
      .select("id, title, status, published_at, linkedin_url")
      .eq("workspace_id", workspaceId)
      .not("published_at", "is", null)
      .gte("published_at", since)
      .order("published_at"),
    "published posts",
  );
  if (posts.length === 0) return [];
  const rows = check(
    await supabase
      .from("content_results")
      .select("post_id, measured_after")
      .in(
        "post_id",
        posts.map((p) => p.id),
      ),
    "results",
  );
  const done = new Map<string, ContentMeasuredAfter[]>();
  for (const r of rows) done.set(r.post_id, [...(done.get(r.post_id) ?? []), r.measured_after]);
  return posts.flatMap((p) =>
    dueMeasurements(p.published_at, done.get(p.id) ?? [], now).map((measuredAfter) => ({
      postId: p.id,
      title: p.title,
      publishedAt: p.published_at!,
      linkedinUrl: p.linkedin_url,
      measuredAfter,
      status: p.status,
    })),
  );
}

export type DashboardPost = {
  id: string;
  title: string;
  publishedAt: string;
  angle: string | null;
  audience: string | null;
  format: string | null;
  theme: string | null;
  timeSlot: string | null;
  seriesId: string | null;
  result7d: { impressions: number | null; likes: number; comments: number } | null;
  result48h: { impressions: number | null; likes: number; comments: number } | null;
};

/** Published posts of the last year with their results, for the dashboard. */
export async function loadDashboardPosts(workspaceIds: string[], sinceDay?: string): Promise<(DashboardPost & { workspaceId: string })[]> {
  if (workspaceIds.length === 0) return [];
  const supabase = await createClient();
  const since = sinceDay ?? addDays(dayKey(), -365);
  const posts = check(
    await supabase
      .from("content_posts")
      .select("id, workspace_id, title, published_at, angle, audience, format, theme, time_slot, series_id")
      .in("workspace_id", workspaceIds)
      .not("published_at", "is", null)
      .gte("published_at", since)
      .order("published_at", { ascending: false })
      .limit(2000),
    "published posts",
  );
  const results = new Map<string, { "48h"?: DashboardPost["result7d"]; "7d"?: DashboardPost["result7d"] }>();
  for (let i = 0; i < posts.length; i += 200) {
    const rows = check(
      await supabase
        .from("content_results")
        .select("post_id, measured_after, impressions, likes, comments")
        .in(
          "post_id",
          posts.slice(i, i + 200).map((p) => p.id),
        ),
      "results",
    );
    for (const r of rows) {
      results.set(r.post_id, { ...results.get(r.post_id), [r.measured_after]: { impressions: r.impressions, likes: r.likes, comments: r.comments } });
    }
  }
  return posts.map((p) => ({
    id: p.id,
    workspaceId: p.workspace_id,
    title: p.title,
    publishedAt: p.published_at!,
    angle: p.angle,
    audience: p.audience,
    format: p.format,
    theme: p.theme,
    timeSlot: p.time_slot,
    seriesId: p.series_id,
    result7d: results.get(p.id)?.["7d"] ?? null,
    result48h: results.get(p.id)?.["48h"] ?? null,
  }));
}

export type MonthCount = { month: string; published: number; goal: number };

/** Target posts per month from a weekly goal (52 weeks / 12 months). */
export function monthlyGoal(weeklyGoal: number) {
  return Math.round((weeklyGoal * 52) / 12);
}

/** Posts published per month for the last months (this month included), against the goal. */
export function publishedPerMonth(posts: { publishedAt: string }[], weeklyGoal: number, months = 6, today = dayKey()): MonthCount[] {
  const list: MonthCount[] = [];
  let start = monthStart(today);
  for (let i = 0; i < months; i++) {
    list.unshift({ month: start.slice(0, 7), published: 0, goal: monthlyGoal(weeklyGoal) });
    start = monthStart(addDays(start, -1));
  }
  for (const post of posts) {
    const month = dayKey(new Date(post.publishedAt)).slice(0, 7);
    const hit = list.find((m) => m.month === month);
    if (hit) hit.published++;
  }
  return list;
}

export type Dimension = { key: "angle" | "audience" | "format" | "theme" | "timeSlot" | "series"; label: string; rows: (GroupAverage & { label: string })[] };

/** Averages per angle, audience, format, theme, time slot and series. */
export async function dashboardDimensions(workspace: ContentWorkspace, posts: DashboardPost[]): Promise<Dimension[]> {
  const supabase = await createClient();
  const series = workspace.modules.series
    ? check(await supabase.from("content_series").select("id, name").eq("workspace_id", workspace.id), "series")
    : [];
  const seriesName = new Map(series.map((s) => [s.id, s.name]));
  const label = (list: "angle" | "audience" | "format" | "theme" | "time_slot", value: string) =>
    value === "none" ? "Not set" : (workspace.options[list].find((o) => o.value === value)?.label ?? value);
  const dims: { key: Dimension["key"]; label: string; of: (p: DashboardPost) => string | null; name: (v: string) => string }[] = [
    { key: "angle", label: "Angle", of: (p) => p.angle, name: (v) => label("angle", v) },
    { key: "audience", label: "Audience", of: (p) => p.audience, name: (v) => label("audience", v) },
    { key: "format", label: "Format", of: (p) => p.format, name: (v) => label("format", v) },
    { key: "theme", label: "Theme", of: (p) => p.theme, name: (v) => label("theme", v) },
    { key: "timeSlot", label: "Time slot", of: (p) => p.timeSlot, name: (v) => label("time_slot", v) },
  ];
  if (workspace.modules.series) {
    dims.push({ key: "series", label: "Series", of: (p) => p.seriesId, name: (v) => (v === "none" ? "No series" : (seriesName.get(v) ?? "Series")) });
  }
  return dims.map((d) => ({
    key: d.key,
    label: d.label,
    rows: averagesBy(posts, d.of, workspace.successThreshold).map((row) => ({ ...row, label: d.name(row.key) })),
  }));
}

export type WorkspaceResults = { measured: number; avgEngagement: number | null; successRate: number | null };

/** Average likes plus comments and success rate of the 7 day results of posts published in the last 30 days. */
export function recentResults(posts: { publishedAt: string; result7d: DashboardPost["result7d"] }[], threshold: number, today = dayKey()): WorkspaceResults {
  const since = addDays(today, -30);
  const measured = posts.filter((p) => p.result7d && dayKey(new Date(p.publishedAt)) >= since);
  if (measured.length === 0) return { measured: 0, avgEngagement: null, successRate: null };
  return {
    measured: measured.length,
    avgEngagement: Math.round((measured.reduce((s, p) => s + engagement(p.result7d)!, 0) / measured.length) * 10) / 10,
    successRate: Math.round((measured.filter((p) => isSuccess(p.result7d, threshold)).length / measured.length) * 100),
  };
}

// ---------------------------------------------------------------------------
// Reviewer count
// ---------------------------------------------------------------------------

export type ReviewerCountRow = { workspaceId: string; workspaceName: string; reviewerId: string; reviewerName: string; reviewed: number; published: number };

/** Per workspace and reviewer for one month. Only workspaces with the module on. */
export async function loadReviewerCounts(month: string, workspaces: { id: string; name: string; modules: { reviewer_count: boolean } }[]): Promise<ReviewerCountRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("content_reviewer_counts", { p_month: `${month}-01` });
  if (error) throw new Error(`Loading the reviewer count failed: ${error.message}`);
  const on = new Map(workspaces.filter((w) => w.modules.reviewer_count).map((w) => [w.id, w.name]));
  const rows = (data ?? []).filter((r) => on.has(r.workspace_id));
  const people = await peopleById(rows.map((r) => r.reviewer_id));
  return rows
    .map((r) => ({
      workspaceId: r.workspace_id,
      workspaceName: on.get(r.workspace_id)!,
      reviewerId: r.reviewer_id,
      reviewerName: personName(people, r.reviewer_id),
      reviewed: Number(r.reviewed),
      published: Number(r.published),
    }))
    .sort((a, b) => a.workspaceName.localeCompare(b.workspaceName) || a.reviewerName.localeCompare(b.reviewerName));
}

/** "2026-11" from ?month=, or the current month. */
export function parseMonth(value: string | undefined, today = dayKey()): string {
  if (value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return value;
  return today.slice(0, 7);
}

export function monthLabel(month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1)));
}

/** CSV with a header, quoting what needs it. */
export function toCsv(rows: (string | number)[][]): string {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          const text = String(cell);
          return /[",\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
        })
        .join(","),
    )
    .join("\n");
}
