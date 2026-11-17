import type { Tone } from "@/lib/labels";
import type { WorkAgendaStatus, WorkMeetingVisibility } from "@/lib/work/database";

/** Labels of meetings and agenda points (Work is in English). Pure, so client components and tests use it too. */

export const agendaStatuses: { value: WorkAgendaStatus; label: string; tone: Tone }[] = [
  { value: "open", label: "Open", tone: "neutral" },
  { value: "discussed", label: "Discussed", tone: "success" },
  { value: "dropped", label: "Dropped", tone: "warning" },
  { value: "forwarded", label: "Moved on", tone: "brand" },
];

export function agendaStatus(value: WorkAgendaStatus) {
  return agendaStatuses.find((s) => s.value === value) ?? agendaStatuses[0];
}

export const meetingVisibilities: { value: WorkMeetingVisibility; label: string; description: string }[] = [
  { value: "workspace", label: "Whole workspace", description: "Everyone who is an admin or member of the workspace sees the agenda." },
  { value: "invited", label: "Only people I pick", description: "Only you and the people you pick see it. Other admins of the workspace do not." },
];

/** "Moved on once", "Moved on 3 times": how often a point slid to the next meeting. */
export function carriedLabel(count: number): string | null {
  if (count <= 0) return null;
  return count === 1 ? "Moved on once" : `Moved on ${count} times`;
}

/** What a point shows next to its title: who brought it up, and whether Claude added it. */
export function bySource(source: "portal" | "claude"): string {
  return source === "claude" ? " via Claude" : "";
}
