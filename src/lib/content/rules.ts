// Labels and pure rules of the content module. The database enforces every
// rule (supabase/migrations/20261119000000_content.sql); the functions here
// mirror them so the interface only offers what will work and says why
// something is not possible yet. Safe for client components; unit tested in
// tests/content.test.ts. The interface is in English.

import type { Json } from "@/lib/database.types";
import type { Tone } from "@/lib/labels";
import type {
  ContentFieldType,
  ContentIdeaStatus,
  ContentImageBrief,
  ContentMeasuredAfter,
  ContentMemberRole,
  ContentModuleKey,
  ContentNotificationKind,
  ContentPrefKind,
  ContentRole,
  ContentTextField,
} from "@/lib/content/database";

export const LINKEDIN_LIMIT = 3000;

export const contentRoles: { value: ContentRole; label: string; tone: Tone; description: string }[] = [
  { value: "admin", label: "Admin", tone: "accent", description: "Sees and manages every workspace." },
  { value: "author", label: "Author", tone: "brand", description: "Owns the workspace. Writes and approves their own posts." },
  {
    value: "reviewer",
    label: "Reviewer",
    tone: "success",
    description: "Reviews, suggests changes, picks media, schedules, publishes and fills in results. Never approves.",
  },
  { value: "viewer", label: "Viewer", tone: "neutral", description: "Can only view." },
];

export const memberRoles = contentRoles.filter((r): r is (typeof contentRoles)[number] & { value: ContentMemberRole } => r.value !== "admin");

export function roleLabel(role: ContentRole | null | undefined) {
  return contentRoles.find((r) => r.value === role) ?? contentRoles[3];
}

export const ideaStatuses: { value: ContentIdeaStatus; label: string; tone: Tone }[] = [
  { value: "new", label: "New", tone: "brand" },
  { value: "shortlisted", label: "Shortlisted", tone: "accent" },
  { value: "converted", label: "Converted", tone: "success" },
  { value: "archived", label: "Archived", tone: "neutral" },
];

export const textFields: { value: ContentTextField; label: string }[] = [
  { value: "title", label: "Title" },
  { value: "hook", label: "Hook" },
  { value: "body", label: "Body" },
  { value: "closing_question", label: "Closing question" },
  { value: "first_comment", label: "First comment" },
];

export function isTextField(value: unknown): value is ContentTextField {
  return typeof value === "string" && textFields.some((f) => f.value === value);
}

export const modules: { value: ContentModuleKey; label: string; description: string }[] = [
  { value: "ideas", label: "Ideas", description: "Inbox, shortlist and archive of loose ideas." },
  { value: "series", label: "Series", description: "Group posts, with progress per series." },
  { value: "media", label: "Media library", description: "Photos and documents, with Google Drive sync and usage." },
  { value: "image_suggestions", label: "Image suggestions", description: "Up to 3 suggested images per post, and image briefs." },
  { value: "sources", label: "Sources", description: "Reddit, X and news sources with screenshots." },
  { value: "results", label: "Results", description: "Impressions, likes, comments and reposts after 48 hours and 7 days." },
  { value: "reviewer_count", label: "Reviewer count", description: "Posts the reviewer reviewed and published per month." },
];

export type ModuleSettings = Record<ContentModuleKey, boolean>;

/** Stored module switches; anything unknown or missing counts as on. */
export function parseModules(value: Json | null | undefined): ModuleSettings {
  const stored = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  return Object.fromEntries(modules.map((m) => [m.value, stored[m.value] !== false])) as ModuleSettings;
}

export const fieldTypes: { value: ContentFieldType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "single_choice", label: "Single choice" },
  { value: "multiple_choice", label: "Multiple choice" },
  { value: "link", label: "Link" },
  { value: "file", label: "File (from the media library)" },
  { value: "relation", label: "Relation" },
];

export const optionLists = [
  { value: "channel", label: "Channels" },
  { value: "language", label: "Languages" },
  { value: "audience", label: "Audiences" },
  { value: "theme", label: "Themes" },
  { value: "angle", label: "Angles" },
  { value: "format", label: "Formats" },
  { value: "priority", label: "Priorities" },
  { value: "time_slot", label: "Time slots" },
  { value: "platform", label: "Source platforms" },
] as const;

export type OptionListKey = (typeof optionLists)[number]["value"];

/** A label or a value as a stable option value: "Reddit / X" -> "reddit_x". */
export function optionValue(label: string): string {
  return (
    label
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 60) || "option"
  );
}

// ---------------------------------------------------------------------------
// Statuses
// ---------------------------------------------------------------------------

export const coreStatusTones: Record<string, Tone> = {
  draft: "neutral",
  in_review: "accent",
  changes_requested: "warning",
  approved: "brand",
  scheduled: "brand",
  published: "success",
  measured: "success",
  parked: "neutral",
  rejected: "danger",
};

export function statusTone(key: string): Tone {
  return coreStatusTones[key] ?? "neutral";
}

/** Statuses that count as "ready ahead" in the buffer meter. */
export const BUFFER_STATUSES = ["approved", "scheduled"];
/** Statuses that no longer need work before going live. */
export const DONE_STATUSES = ["published", "measured"];
export const OFF_STATUSES = ["parked", "rejected"];

export type StatusDef = { key: string; label: string; position: number; isCore: boolean; allowedRoles: ContentMemberRole[] };
export type Transition = { from: string; to: string };

export type PostForRules = {
  status: string;
  authorId: string | null;
  approvedAt: string | null;
  publishedAt: string | null;
  plannedDate: string | null;
  timeSlot: string | null;
  linkedinUrl: string | null;
  formatNeedsMedia: boolean;
  mediaCount: number;
  has7dResults: boolean;
};

export type StatusMove = { to: StatusDef; allowed: boolean; reason?: string };

/**
 * Which statuses this user can move the post to, and why the others are not
 * possible (yet). Mirrors content_private.before_post_update.
 */
export function statusMoves({
  post,
  role,
  userId,
  statuses,
  transitions,
  adminApprovalRequired,
}: {
  post: PostForRules;
  role: ContentRole;
  userId: string;
  statuses: StatusDef[];
  transitions: Transition[];
  adminApprovalRequired: boolean;
}): StatusMove[] {
  if (role === "viewer") return [];
  const moves: StatusMove[] = [];
  for (const to of statuses) {
    if (to.key === post.status) continue;
    const reason = blockedReason({ post, role, userId, to, transitions, adminApprovalRequired });
    // Steps the flow does not offer from here are left out entirely.
    if (reason === "not_next") continue;
    moves.push(reason ? { to, allowed: false, reason } : { to, allowed: true });
  }
  return moves;
}

function blockedReason({
  post,
  role,
  userId,
  to,
  transitions,
  adminApprovalRequired,
}: {
  post: PostForRules;
  role: ContentRole;
  userId: string;
  to: StatusDef;
  transitions: Transition[];
  adminApprovalRequired: boolean;
}): string | null {
  const offTrack = OFF_STATUSES.includes(to.key);
  if (role !== "admin") {
    if (!offTrack && !transitions.some((t) => t.from === post.status && t.to === to.key)) return "not_next";
    if (!to.allowedRoles.includes(role as ContentMemberRole)) {
      return to.key === "approved" ? "Only the author can approve" : `Only ${to.allowedRoles.join(" or ") || "an admin"} can set this`;
    }
  }
  if (to.key === "approved") {
    if (role === "reviewer") return "Reviewers cannot approve";
    if (role === "author" && post.authorId !== userId) return "Only the author can approve";
    if (adminApprovalRequired && role !== "admin") return "Needs approval from an admin";
  }
  if (to.key === "scheduled") {
    if (!post.approvedAt) return "Needs approval first";
    if (!post.plannedDate || !post.timeSlot) return "Pick a date and a time slot first";
    if (post.formatNeedsMedia && post.mediaCount === 0) return "Choose media first";
  }
  if (to.key === "published") {
    if (!post.approvedAt) return "Needs approval first";
    if (!post.linkedinUrl) return "Paste the LinkedIn URL first";
  }
  if (to.key === "measured") {
    if (!post.publishedAt) return "Publish first";
    if (!post.has7dResults) return "Fill in the 7 day results first";
  }
  return null;
}

// ---------------------------------------------------------------------------
// LinkedIn text and preview
// ---------------------------------------------------------------------------

export type PostText = { hook: string; body: string; closingQuestion: string };

/** The text exactly as it goes on LinkedIn: hook, body and closing question, a blank line apart. */
export function linkedInText({ hook, body, closingQuestion }: PostText): string {
  return [hook, body, closingQuestion]
    .map((part) => part.replace(/\r\n/g, "\n").replace(/\s+$/g, ""))
    .filter((part) => part.trim() !== "")
    .join("\n\n");
}

/**
 * Where LinkedIn cuts the post with "...see more": after about 210
 * characters on desktop and 140 on mobile, or after the third line, whichever
 * comes first. LinkedIn does not publish the exact rule; these are the
 * commonly measured values.
 */
export const SEE_MORE = { desktop: { chars: 210, lines: 3 }, mobile: { chars: 140, lines: 3 } } as const;

export function seeMoreCut(text: string, device: keyof typeof SEE_MORE): { visible: string; cut: boolean } {
  const { chars, lines } = SEE_MORE[device];
  let end = Math.min(text.length, chars);
  let seen = 0;
  for (let i = 0; i < end; i++) {
    if (text[i] === "\n") {
      seen++;
      if (seen >= lines) {
        end = i;
        break;
      }
    }
  }
  if (end >= text.length) return { visible: text, cut: false };
  // Do not cut in the middle of a word.
  const space = text.lastIndexOf(" ", end);
  const visible = (space > end - 20 && space > 0 ? text.slice(0, space) : text.slice(0, end)).replace(/\s+$/, "");
  return { visible, cut: true };
}

export function characterCount(text: string): number {
  // LinkedIn counts characters as the user sees them.
  return Array.from(text).length;
}

// ---------------------------------------------------------------------------
// Dates, rhythm and buffer (all in Europe/Amsterdam)
// ---------------------------------------------------------------------------

const ZONE = "Europe/Amsterdam";

/** YYYY-MM-DD of a moment in Amsterdam. */
export function dayKey(date: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

/** Add days to a YYYY-MM-DD date (calendar math, no time zones involved). */
export function addDays(day: string, days: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

/** ISO weekday of a YYYY-MM-DD date: 1 = Monday ... 7 = Sunday. */
export function weekday(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return w === 0 ? 7 : w;
}

/** Monday of the week of a YYYY-MM-DD date. */
export function weekStart(day: string): string {
  return addDays(day, 1 - weekday(day));
}

export function monthStart(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

export function isDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** The days shown in a month grid: whole weeks from Monday, covering the month. */
export function monthGrid(day: string): string[] {
  const first = monthStart(day);
  const [y, m] = first.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const days: string[] = [];
  for (let d = weekStart(first); d <= last || weekday(d) !== 1; d = addDays(d, 1)) days.push(d);
  return days;
}

export type BufferState = "low" | "ok" | "full";

export function bufferState(count: number, min: number, max: number): BufferState {
  if (count < min) return "low";
  if (count > max) return "full";
  return "ok";
}

export type WeekRhythm = { weekStart: string; planned: number; goal: number; onTrack: boolean };

/** Posts planned per week against the goal (parked and rejected do not count). */
export function weekRhythm(posts: { plannedDate: string | null; status: string }[], start: string, goal: number): WeekRhythm {
  const end = addDays(start, 7);
  const planned = posts.filter(
    (p) => p.plannedDate && p.plannedDate >= start && p.plannedDate < end && !OFF_STATUSES.includes(p.status),
  ).length;
  return { weekStart: start, planned, goal, onTrack: planned >= goal };
}

/** Posts planned tomorrow that are not approved yet: the most important signal. */
export function unapprovedTomorrow<T extends { plannedDate: string | null; status: string }>(posts: T[], today: string): T[] {
  const tomorrow = addDays(today, 1);
  return posts.filter(
    (p) => p.plannedDate === tomorrow && ![...BUFFER_STATUSES, ...DONE_STATUSES, ...OFF_STATUSES].includes(p.status),
  );
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export const measuredAfter: { value: ContentMeasuredAfter; label: string; hours: number }[] = [
  { value: "48h", label: "After 48 hours", hours: 48 },
  { value: "7d", label: "After 7 days", hours: 24 * 7 },
];

/** Which measurements are due for a post published at this moment. */
export function dueMeasurements(publishedAt: string | null, done: ContentMeasuredAfter[], now: Date = new Date()): ContentMeasuredAfter[] {
  if (!publishedAt) return [];
  const published = new Date(publishedAt).getTime();
  return measuredAfter
    .filter((m) => !done.includes(m.value) && published + m.hours * 3_600_000 <= now.getTime())
    .map((m) => m.value);
}

export function engagement(result: { likes: number; comments: number } | null | undefined): number | null {
  return result ? result.likes + result.comments : null;
}

/** Green or red: likes plus comments after 7 days against the threshold. */
export function isSuccess(result: { likes: number; comments: number } | null | undefined, threshold: number): boolean | null {
  const value = engagement(result);
  return value === null ? null : value >= threshold;
}

export type GroupAverage = { key: string; posts: number; avgImpressions: number | null; avgEngagement: number; successRate: number };

/** Averages of the 7 day results per value of one dimension (angle, audience, format...). */
export function averagesBy<T extends { result7d: { impressions: number | null; likes: number; comments: number } | null }>(
  posts: T[],
  keyOf: (post: T) => string | null | undefined,
  threshold: number,
): GroupAverage[] {
  const groups = new Map<string, T[]>();
  for (const post of posts) {
    if (!post.result7d) continue;
    const key = keyOf(post) || "none";
    groups.set(key, [...(groups.get(key) ?? []), post]);
  }
  return [...groups.entries()]
    .map(([key, list]) => {
      const withImpressions = list.filter((p) => p.result7d!.impressions !== null);
      return {
        key,
        posts: list.length,
        avgImpressions: withImpressions.length
          ? Math.round(withImpressions.reduce((sum, p) => sum + p.result7d!.impressions!, 0) / withImpressions.length)
          : null,
        avgEngagement: Math.round((list.reduce((sum, p) => sum + engagement(p.result7d)!, 0) / list.length) * 10) / 10,
        successRate: Math.round((list.filter((p) => isSuccess(p.result7d, threshold)).length / list.length) * 100),
      };
    })
    .sort((a, b) => b.avgEngagement - a.avgEngagement);
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export const notificationKinds: { value: ContentPrefKind; label: string; for: "reviewer" | "author" | "everyone" }[] = [
  { value: "in_review", label: "A post is in review", for: "reviewer" },
  { value: "approved", label: "A post is approved and needs scheduling", for: "reviewer" },
  { value: "no_url", label: "A post has no URL on its date", for: "reviewer" },
  { value: "results_due", label: "Results are due (48 hours and 7 days)", for: "reviewer" },
  { value: "image_brief", label: "An image is needed (image brief)", for: "reviewer" },
  { value: "changes_requested", label: "Changes requested", for: "author" },
  { value: "suggestions_ready", label: "Suggestions are ready", for: "author" },
  { value: "image_suggestions_ready", label: "Image suggestions are ready", for: "author" },
  { value: "unapproved_tomorrow", label: "The day before a post that is not approved", for: "author" },
  { value: "buffer_low", label: "Buffer below target", for: "author" },
  { value: "week_below_rhythm", label: "A week below the rhythm goal", for: "author" },
  { value: "next_idea", label: "Add the next idea after publishing", for: "author" },
  { value: "comment", label: "New comments", for: "everyone" },
  { value: "weekly_summary", label: "Monday morning summary", for: "everyone" },
];

export function notificationLabel(kind: ContentNotificationKind | ContentPrefKind): string {
  return notificationKinds.find((k) => k.value === kind)?.label ?? kind;
}

// ---------------------------------------------------------------------------
// Image brief and extra fields
// ---------------------------------------------------------------------------

export const imageBriefFields: { key: keyof ContentImageBrief; label: string; placeholder: string }[] = [
  { key: "what", label: "What is in it", placeholder: "Julius at a whiteboard with the team in Bangalore" },
  { key: "setting", label: "Setting", placeholder: "Office, daylight" },
  { key: "mood", label: "Mood", placeholder: "Focused, warm" },
  { key: "who", label: "Who is in it", placeholder: "Julius, two developers" },
  { key: "type", label: "Type", placeholder: "Photo, screenshot or graphic" },
  { key: "format", label: "Format", placeholder: "Portrait 4:5 or square" },
];

export function parseImageBrief(value: Json | null | undefined): ContentImageBrief | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const brief: ContentImageBrief = {};
  for (const { key } of imageBriefFields) {
    const v = (value as Record<string, unknown>)[key];
    if (typeof v === "string" && v.trim()) brief[key] = v.trim().slice(0, 500);
  }
  return Object.keys(brief).length ? brief : null;
}

export type FieldDef = {
  key: string;
  label: string;
  type: ContentFieldType;
  choices: string[];
  target: "post" | "idea" | "series" | "source" | null;
};

export type CustomValue = string | number | string[] | null;

/**
 * Clean the extra field values from a form: unknown keys are dropped, numbers
 * parsed, choices checked against the definition. Returns an error message
 * per field that is wrong.
 */
export function cleanCustomFields(
  defs: FieldDef[],
  raw: Record<string, string | string[] | undefined>,
): { values: Record<string, CustomValue>; errors: Record<string, string> } {
  const values: Record<string, CustomValue> = {};
  const errors: Record<string, string> = {};
  for (const def of defs) {
    const input = raw[def.key];
    const text = Array.isArray(input) ? input : input === undefined ? [] : [input];
    const first = (text[0] ?? "").trim();
    if (def.type === "multiple_choice") {
      const picked = [...new Set(text.map((t) => t.trim()).filter(Boolean))];
      const wrong = picked.find((p) => !def.choices.includes(p));
      if (wrong) errors[def.key] = `${wrong} is not a choice`;
      else values[def.key] = picked;
      continue;
    }
    if (!first) {
      values[def.key] = null;
      continue;
    }
    switch (def.type) {
      case "number": {
        const n = Number(first.replace(",", "."));
        if (!Number.isFinite(n)) errors[def.key] = "Enter a number";
        else values[def.key] = n;
        break;
      }
      case "date":
        if (!isDay(first)) errors[def.key] = "Enter a date";
        else values[def.key] = first;
        break;
      case "single_choice":
        if (!def.choices.includes(first)) errors[def.key] = `${first} is not a choice`;
        else values[def.key] = first;
        break;
      case "link":
        if (!/^https?:\/\/\S+$/i.test(first)) errors[def.key] = "Enter a link starting with https://";
        else values[def.key] = first.slice(0, 2000);
        break;
      case "file":
      case "relation":
        if (!/^[0-9a-f-]{36}$/i.test(first)) errors[def.key] = "Pick an item";
        else values[def.key] = first;
        break;
      default:
        values[def.key] = first.slice(0, 2000);
    }
  }
  return { values, errors };
}

export function fieldDefFrom(row: { key: string; label: string; field_type: ContentFieldType; config: Json }): FieldDef {
  const config = row.config && typeof row.config === "object" && !Array.isArray(row.config) ? (row.config as Record<string, unknown>) : {};
  const choices = Array.isArray(config.choices) ? config.choices.filter((c): c is string => typeof c === "string") : [];
  const target = config.target === "post" || config.target === "idea" || config.target === "series" || config.target === "source" ? config.target : null;
  return { key: row.key, label: row.label, type: row.field_type, choices, target };
}

/** Tags typed as "India, hiring  #story" -> ["india", "hiring", "story"]. */
export function parseTags(value: string | undefined | null): string[] {
  if (!value) return [];
  return [
    ...new Set(
      value
        .split(/[,\n#]/)
        .map((t) => t.trim().toLowerCase())
        .filter((t) => t.length > 0 && t.length <= 40),
    ),
  ].slice(0, 20);
}

/** Reusing a photo within this many months shows a warning. */
export function reuseWarning(usedOn: string[], today: string, months: number): string | null {
  if (months <= 0 || usedOn.length === 0) return null;
  const [y, m, d] = today.split("-").map(Number);
  const limit = new Date(Date.UTC(y, m - 1 - months, d)).toISOString().slice(0, 10);
  const recent = usedOn.filter((day) => day >= limit).sort().reverse();
  return recent.length ? `Used on ${recent[0]}, within the last ${months} months` : null;
}
