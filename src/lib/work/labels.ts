import type { Tone } from "@/lib/labels";
import type {
  WorkAccessAction,
  WorkNotificationKind,
  WorkPriority,
  WorkRole,
  WorkStatus,
  WorkTaskType,
  WorkVisibility,
} from "@/lib/work/database";

// The task tool is in English (briefing section 10); tasks themselves can be in any language.

type Option<T extends string> = { value: T; label: string; tone: Tone };

export const workStatuses: Option<WorkStatus>[] = [
  { value: "todo", label: "To do", tone: "neutral" },
  { value: "in_progress", label: "In progress", tone: "brand" },
  { value: "review", label: "Review", tone: "accent" },
  { value: "done", label: "Done", tone: "success" },
  { value: "cancelled", label: "Cancelled", tone: "neutral" },
];

export const workPriorities: Option<WorkPriority>[] = [
  { value: "low", label: "Low", tone: "neutral" },
  { value: "normal", label: "Normal", tone: "brand" },
  { value: "high", label: "High", tone: "warning" },
  { value: "urgent", label: "Urgent", tone: "danger" },
];

/** What kind of work a task is, so someone can pick up all tasks of one kind (all calls, all programming). */
export const workTaskTypes: { value: WorkTaskType; label: string }[] = [
  { value: "call", label: "Call" },
  { value: "schedule", label: "Schedule meeting" },
  { value: "meeting", label: "Discuss" },
  { value: "teams", label: "Teams meeting" },
  { value: "brainstorm", label: "Brainstorm" },
  { value: "programming", label: "Programming" },
  { value: "design", label: "Design" },
  { value: "writing", label: "Writing" },
  { value: "email", label: "Email" },
  { value: "research", label: "Research" },
  { value: "review", label: "Check work" },
  { value: "admin", label: "Admin" },
];

export function isWorkTaskType(value: unknown): value is WorkTaskType {
  return typeof value === "string" && workTaskTypes.some((t) => t.value === value);
}

export type WorkView = "list" | "board" | "calendar" | "timeline";

/** ?view= from a URL: list (the default), board, calendar or timeline. */
export function parseWorkView(value: string | undefined): WorkView {
  return value === "board" || value === "calendar" || value === "timeline" ? value : "list";
}

/** ?type= and ?label= from a URL, for the list filters. */
export function planningParams(type: string | undefined, label: string | undefined): { taskType?: WorkTaskType | "none"; label?: string } {
  return {
    taskType: type === "none" || isWorkTaskType(type) ? type : undefined,
    label: label && label.length <= 40 ? label : undefined,
  };
}

export const taskTypeFilterOptions = [...workTaskTypes.map((t) => ({ value: t.value, label: t.label })), { value: "none", label: "No type" }];

export function workTaskTypeLabel(value: WorkTaskType | null | undefined): string | null {
  return value ? (workTaskTypes.find((t) => t.value === value)?.label ?? null) : null;
}

/** "1h 30m", "45m", "2h": an estimate in minutes, short. */
export function formatEstimate(minutes: number | null | undefined): string {
  if (!minutes) return "";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h && m ? `${h}h ${m}m` : h ? `${h}h` : `${m}m`;
}

/** "1.5", "2h", "90m", "1h30", "1:30" to minutes; null when empty, NaN when not understood. */
export function parseEstimate(input: string | null | undefined): number | null {
  const value = (input ?? "").trim().toLowerCase().replace(",", ".");
  if (!value) return null;
  let match = /^(\d+(?:\.\d+)?)\s*h?$/.exec(value);
  if (match) return Math.round(Number(match[1]) * 60);
  match = /^(\d+)\s*m(?:in)?$/.exec(value);
  if (match) return Number(match[1]);
  match = /^(\d+)\s*(?:h|:)\s*(\d{1,2})\s*m?$/.exec(value);
  if (match) return Number(match[1]) * 60 + Number(match[2]);
  return Number.NaN;
}

export const workRoles: Option<WorkRole>[] = [
  { value: "admin", label: "Admin", tone: "accent" },
  { value: "member", label: "Member", tone: "brand" },
  { value: "guest", label: "Guest", tone: "neutral" },
];

export const workVisibilities: Option<WorkVisibility>[] = [
  { value: "open", label: "Open", tone: "brand" },
  { value: "private", label: "Private", tone: "warning" },
];

export const notificationKinds: { value: WorkNotificationKind; label: string; description: string }[] = [
  { value: "review", label: "Review requests", description: "A task you review is ready for review." },
  { value: "mention", label: "Mentions", description: "Someone mentions you in a comment." },
  { value: "returned", label: "Sent back", description: "The reviewer sends your task back." },
  { value: "assigned", label: "Assigned to you", description: "You become an owner of a task." },
  { value: "comment", label: "Comments", description: "New comments on tasks you are on." },
  { value: "due_soon", label: "Due tomorrow", description: "A task you own is due tomorrow." },
  { value: "overdue", label: "Overdue", description: "A task you own is past its deadline." },
  { value: "project_added", label: "Added to a project", description: "Someone adds you to a project." },
  { value: "access_expiring", label: "Access ending", description: "Your guest access ends within 3 days." },
];

export const accessActions: Record<WorkAccessAction, string> = {
  invited: "Invited",
  invite_revoked: "Invite revoked",
  granted: "Access granted",
  revoked: "Access revoked",
  role_changed: "Role changed",
  expiry_changed: "End date changed",
  expired: "Access expired",
  deactivated: "Deactivated",
  reactivated: "Reactivated",
};

export function workOption<T extends string>(options: Option<T>[], value: T): Option<T> {
  return options.find((o) => o.value === value) ?? { value, label: value, tone: "neutral" };
}

const statusValues = new Set<string>(workStatuses.map((s) => s.value));
const priorityValues = new Set<string>(workPriorities.map((p) => p.value));

export function isWorkStatus(value: unknown): value is WorkStatus {
  return typeof value === "string" && statusValues.has(value);
}

export function isWorkPriority(value: unknown): value is WorkPriority {
  return typeof value === "string" && priorityValues.has(value);
}

export const priorityRank: Record<WorkPriority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

/** Statuses that still need work. */
export const openStatuses: WorkStatus[] = ["todo", "in_progress", "review"];
