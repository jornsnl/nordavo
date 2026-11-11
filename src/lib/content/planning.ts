import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import {
  check,
  listMyContentWorkspaces,
  requireContentUser,
  type ContentWorkspace,
  type ContentWorkspaceItem,
} from "@/lib/content/data";
import {
  BUFFER_STATUSES,
  DONE_STATUSES,
  OFF_STATUSES,
  addDays,
  bufferState,
  dayKey,
  dueMeasurements,
  unapprovedTomorrow,
  weekRhythm,
  weekStart,
  type BufferState,
  type WeekRhythm,
} from "@/lib/content/rules";
import type { ContentMeasuredAfter } from "@/lib/content/database";

/**
 * Planning reads of the content module: calendar, buffer, rhythm and the to
 * do lists across workspaces. Everything runs as the signed-in user (RLS).
 */

export type PostSummary = {
  id: string;
  workspaceId: string;
  title: string;
  status: string;
  plannedDate: string | null;
  timeSlot: string | null;
  format: string | null;
  authorId: string | null;
  approvedAt: string | null;
  publishedAt: string | null;
  submittedAt: string | null;
  linkedinUrl: string | null;
  hasImageBrief: boolean;
  imageBriefDone: boolean;
  updatedAt: string;
};

const SUMMARY_COLUMNS =
  "id, workspace_id, title, status, planned_date, time_slot, format, author_id, approved_at, published_at, submitted_at, linkedin_url, image_brief, image_brief_done_at, updated_at";

type SummaryRow = {
  id: string;
  workspace_id: string;
  title: string;
  status: string;
  planned_date: string | null;
  time_slot: string | null;
  format: string | null;
  author_id: string | null;
  approved_at: string | null;
  published_at: string | null;
  submitted_at: string | null;
  linkedin_url: string | null;
  image_brief: unknown;
  image_brief_done_at: string | null;
  updated_at: string;
};

function toSummary(row: SummaryRow): PostSummary {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    title: row.title,
    status: row.status,
    plannedDate: row.planned_date,
    timeSlot: row.time_slot,
    format: row.format,
    authorId: row.author_id,
    approvedAt: row.approved_at,
    publishedAt: row.published_at,
    submittedAt: row.submitted_at,
    linkedinUrl: row.linkedin_url,
    hasImageBrief: row.image_brief !== null,
    imageBriefDone: row.image_brief_done_at !== null,
    updatedAt: row.updated_at,
  };
}

/** Every post of these workspaces that is still in play (not parked, rejected or older than 60 days live). */
export async function listActivePosts(workspaceIds: string[]): Promise<PostSummary[]> {
  if (workspaceIds.length === 0) return [];
  const supabase = await createClient();
  const since = addDays(dayKey(), -60);
  const result = await supabase
    .from("content_posts")
    .select(SUMMARY_COLUMNS)
    .in("workspace_id", workspaceIds)
    .is("archived_at", null)
    .not("status", "in", `(${OFF_STATUSES.join(",")})`)
    .or(`published_at.is.null,published_at.gte.${since}`)
    .order("planned_date", { ascending: true, nullsFirst: false })
    .limit(2000);
  return check(result, "posts").map(toSummary);
}

/** Posts of a workspace planned between two days (inclusive start, exclusive end), plus unplanned ones. */
export async function listCalendarPosts(
  workspaceId: string,
  from: string,
  to: string,
): Promise<{ planned: PostSummary[]; unplanned: PostSummary[] }> {
  const supabase = await createClient();
  const [planned, unplanned] = await Promise.all([
    supabase
      .from("content_posts")
      .select(SUMMARY_COLUMNS)
      .eq("workspace_id", workspaceId)
      .is("archived_at", null)
      .gte("planned_date", from)
      .lt("planned_date", to)
      .order("planned_date")
      .order("time_slot", { nullsFirst: false }),
    supabase
      .from("content_posts")
      .select(SUMMARY_COLUMNS)
      .eq("workspace_id", workspaceId)
      .is("archived_at", null)
      .is("planned_date", null)
      .not("status", "in", `(${[...OFF_STATUSES, ...DONE_STATUSES].join(",")})`)
      .order("updated_at", { ascending: false })
      .limit(100),
  ]);
  return { planned: check(planned, "calendar").map(toSummary), unplanned: check(unplanned, "unplanned posts").map(toSummary) };
}

export type WorkspaceStats = {
  buffer: number;
  bufferState: BufferState;
  thisWeek: WeekRhythm;
  nextWeek: WeekRhythm;
  tomorrowUnapproved: PostSummary[];
  upcoming: PostSummary[];
  nextPost: PostSummary | null;
  needsAttention: PostSummary[];
};

type StatsWorkspace = Pick<ContentWorkspace, "id" | "rhythmGoal" | "bufferMin" | "bufferMax">;

/** Buffer, rhythm and warnings of one workspace, from its active posts. */
export function statsFor(workspace: StatsWorkspace, posts: PostSummary[], today = dayKey()): WorkspaceStats {
  const own = posts.filter((p) => p.workspaceId === workspace.id);
  const buffer = own.filter((p) => BUFFER_STATUSES.includes(p.status)).length;
  const monday = weekStart(today);
  const horizon = addDays(today, 14);
  const upcoming = own
    .filter((p) => p.plannedDate && p.plannedDate >= today && p.plannedDate <= horizon)
    .sort((a, b) => (a.plannedDate! + (a.timeSlot ?? "")).localeCompare(b.plannedDate! + (b.timeSlot ?? "")));
  return {
    buffer,
    bufferState: bufferState(buffer, workspace.bufferMin, workspace.bufferMax),
    thisWeek: weekRhythm(own, monday, workspace.rhythmGoal),
    nextWeek: weekRhythm(own, addDays(monday, 7), workspace.rhythmGoal),
    tomorrowUnapproved: unapprovedTomorrow(own, today),
    upcoming,
    nextPost: upcoming.find((p) => !DONE_STATUSES.includes(p.status)) ?? null,
    needsAttention: own.filter((p) => p.status === "changes_requested" || p.status === "in_review"),
  };
}

/** Full settings of every workspace the user can open (for the overview cards). */
export const listWorkspaceSettings = cache(async () => {
  const workspaces = await listMyContentWorkspaces();
  if (workspaces.length === 0) return [];
  const supabase = await createClient();
  const result = await supabase
    .from("content_workspaces")
    .select("id, rhythm_goal, buffer_min, buffer_max, success_threshold")
    .in(
      "id",
      workspaces.map((w) => w.id),
    );
  const settings = new Map(check(result, "workspaces").map((w) => [w.id, w]));
  return workspaces
    .filter((w) => !w.archived)
    .map((w) => {
      const s = settings.get(w.id);
      return {
        ...w,
        rhythmGoal: s?.rhythm_goal ?? 2,
        bufferMin: s?.buffer_min ?? 5,
        bufferMax: s?.buffer_max ?? 10,
        successThreshold: s?.success_threshold ?? 20,
      };
    });
});

export type WorkspaceWithSettings = Awaited<ReturnType<typeof listWorkspaceSettings>>[number];

// ---------------------------------------------------------------------------
// To do across workspaces
// ---------------------------------------------------------------------------

export type TodoItem = PostSummary & { workspace: Pick<ContentWorkspaceItem, "name" | "slug">; detail?: string };

export type ReviewerTodo = {
  inReview: TodoItem[];
  readyToSchedule: TodoItem[];
  approvedUnplanned: TodoItem[];
  noUrl: TodoItem[];
  resultsDue: (TodoItem & { due: ContentMeasuredAfter[] })[];
  imageBriefs: TodoItem[];
  waitingForAuthor: TodoItem[];
};

export type AuthorTodo = {
  changesRequested: TodoItem[];
  suggestions: (TodoItem & { count: number })[];
  imageSuggestions: (TodoItem & { count: number })[];
  tomorrowUnapproved: TodoItem[];
};

export type Todo = { reviewer: ReviewerTodo | null; author: AuthorTodo | null; workspaceCount: number };

const byDate = (a: PostSummary, b: PostSummary) =>
  ((a.plannedDate ?? "9999") + (a.timeSlot ?? "")).localeCompare((b.plannedDate ?? "9999") + (b.timeSlot ?? ""));

/** What the user needs to do, across every workspace: as reviewer, and as author. */
export async function loadTodo(): Promise<Todo> {
  const user = await requireContentUser();
  const workspaces = (await listMyContentWorkspaces()).filter((w) => !w.archived);
  const reviewing = workspaces.filter((w) => w.role === "reviewer" || w.role === "admin");
  const authoring = workspaces.filter((w) => w.role === "author" || (w.role === "admin" && w.ownerId === user.id));
  const posts = await listActivePosts([...new Set([...reviewing, ...authoring].map((w) => w.id))]);
  const meta = new Map(workspaces.map((w) => [w.id, { name: w.name, slug: w.slug }]));
  const item = (p: PostSummary, detail?: string): TodoItem => ({ ...p, workspace: meta.get(p.workspaceId)!, detail });
  const today = dayKey();
  const now = new Date();

  let reviewer: ReviewerTodo | null = null;
  if (reviewing.length > 0) {
    const ids = new Set(reviewing.map((w) => w.id));
    const resultsOn = new Set(reviewing.filter((w) => w.modules.results).map((w) => w.id));
    const mine = posts.filter((p) => ids.has(p.workspaceId));
    const published = mine.filter((p) => p.publishedAt && resultsOn.has(p.workspaceId) && p.status !== "measured");
    const done = await loadMeasuredAfter(published.map((p) => p.id));
    reviewer = {
      inReview: mine.filter((p) => p.status === "in_review").sort(byDate).map((p) => item(p)),
      readyToSchedule: mine
        .filter((p) => p.status === "approved" && p.plannedDate && p.timeSlot)
        .sort(byDate)
        .map((p) => item(p)),
      approvedUnplanned: mine.filter((p) => p.status === "approved" && (!p.plannedDate || !p.timeSlot)).map((p) => item(p)),
      noUrl: mine
        .filter((p) => (p.status === "scheduled" || p.status === "approved") && !p.linkedinUrl && p.plannedDate && p.plannedDate <= today)
        .sort(byDate)
        .map((p) => item(p)),
      resultsDue: published
        .map((p) => ({ ...item(p), due: dueMeasurements(p.publishedAt, done.get(p.id) ?? [], now) }))
        .filter((p) => p.due.length > 0),
      imageBriefs: mine.filter((p) => p.hasImageBrief && !p.imageBriefDone && p.submittedAt && !DONE_STATUSES.includes(p.status)).map((p) => item(p)),
      waitingForAuthor: mine.filter((p) => p.status === "changes_requested").map((p) => item(p)),
    };
  }

  let author: AuthorTodo | null = null;
  if (authoring.length > 0) {
    const ids = new Set(authoring.map((w) => w.id));
    const mine = posts.filter((p) => ids.has(p.workspaceId) && (p.authorId === user.id || p.authorId === null));
    const open = mine.filter((p) => !DONE_STATUSES.includes(p.status));
    const [suggestions, images] = await Promise.all([
      countPending("content_suggestions", open.map((p) => p.id)),
      countPending("content_image_suggestions", open.map((p) => p.id)),
    ]);
    author = {
      changesRequested: mine.filter((p) => p.status === "changes_requested").map((p) => item(p)),
      suggestions: open.filter((p) => suggestions.has(p.id)).map((p) => ({ ...item(p), count: suggestions.get(p.id)! })),
      imageSuggestions: open.filter((p) => images.has(p.id)).map((p) => ({ ...item(p), count: images.get(p.id)! })),
      tomorrowUnapproved: unapprovedTomorrow(mine, today).map((p) => item(p)),
    };
  }

  return { reviewer, author, workspaceCount: workspaces.length };
}

async function countPending(table: "content_suggestions" | "content_image_suggestions", postIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (postIds.length === 0) return counts;
  const supabase = await createClient();
  for (let i = 0; i < postIds.length; i += 200) {
    const result = await supabase.from(table).select("post_id").eq("status", "pending").in("post_id", postIds.slice(i, i + 200));
    for (const row of check(result, "suggestions")) counts.set(row.post_id, (counts.get(row.post_id) ?? 0) + 1);
  }
  return counts;
}

/** Which measurements were entered per post. */
export async function loadMeasuredAfter(postIds: string[]): Promise<Map<string, ContentMeasuredAfter[]>> {
  const map = new Map<string, ContentMeasuredAfter[]>();
  if (postIds.length === 0) return map;
  const supabase = await createClient();
  for (let i = 0; i < postIds.length; i += 200) {
    const result = await supabase.from("content_results").select("post_id, measured_after").in("post_id", postIds.slice(i, i + 200));
    for (const row of check(result, "results")) map.set(row.post_id, [...(map.get(row.post_id) ?? []), row.measured_after]);
  }
  return map;
}

// ---------------------------------------------------------------------------
// One post, for the publish panel
// ---------------------------------------------------------------------------

export type PublishData = {
  post: {
    id: string;
    title: string;
    status: string;
    authorId: string | null;
    hook: string;
    body: string;
    closingQuestion: string;
    firstComment: string;
    plannedDate: string | null;
    timeSlot: string | null;
    format: string | null;
    angle: string | null;
    linkedinUrl: string | null;
    approvedAt: string | null;
    publishedAt: string | null;
  };
  media: { id: string; fileName: string; mimeType: string | null }[];
  needsBlurCheck: boolean;
  has7dResults: boolean;
};

export async function loadPublishData(postId: string): Promise<PublishData | null> {
  const supabase = await createClient();
  const { data: post } = await supabase
    .from("content_posts")
    .select(
      "id, title, status, author_id, hook, body, closing_question, first_comment, planned_date, time_slot, format, angle, linkedin_url, approved_at, published_at, source_id",
    )
    .eq("id", postId)
    .maybeSingle();
  if (!post) return null;
  const [chosen, source, results] = await Promise.all([
    supabase.from("content_post_media").select("media_id, position").eq("post_id", postId).order("position"),
    post.source_id
      ? supabase.from("content_sources").select("platform").eq("id", post.source_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from("content_results").select("measured_after").eq("post_id", postId).eq("measured_after", "7d"),
  ]);
  const order = check(chosen, "chosen media");
  let media: PublishData["media"] = [];
  if (order.length > 0) {
    const files = await supabase
      .from("content_media")
      .select("id, file_name, mime_type")
      .in(
        "id",
        order.map((o) => o.media_id),
      );
    const byId = new Map(check(files, "media").map((m) => [m.id, m]));
    media = order
      .map((o) => byId.get(o.media_id))
      .filter((m): m is NonNullable<typeof m> => Boolean(m))
      .map((m) => ({ id: m.id, fileName: m.file_name, mimeType: m.mime_type }));
  }
  const platform = (source.data as { platform: string | null } | null)?.platform ?? null;
  return {
    post: {
      id: post.id,
      title: post.title,
      status: post.status,
      authorId: post.author_id,
      hook: post.hook,
      body: post.body,
      closingQuestion: post.closing_question,
      firstComment: post.first_comment,
      plannedDate: post.planned_date,
      timeSlot: post.time_slot,
      format: post.format,
      angle: post.angle,
      linkedinUrl: post.linkedin_url,
      approvedAt: post.approved_at,
      publishedAt: post.published_at,
    },
    media,
    needsBlurCheck: platform === "reddit" || platform === "x" || post.angle === "screenshot",
    has7dResults: (results.data ?? []).length > 0,
  };
}

/** Time slots of a workspace with their time and weekdays (ISO 1..7; empty means every day). */
export function timeSlots(workspace: ContentWorkspace, current?: string | null) {
  return workspace.options.time_slot
    .filter((o) => !o.archived || o.value === current)
    .map((o) => ({
      value: o.value,
      label: o.label,
      time: typeof o.meta.time === "string" ? o.meta.time : o.label,
      weekdays: Array.isArray(o.meta.weekdays) ? o.meta.weekdays.filter((d): d is number => typeof d === "number") : [],
      archived: o.archived,
    }));
}

export type SlotInfo = ReturnType<typeof timeSlots>[number];
