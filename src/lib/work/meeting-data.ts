import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listMembers, listMyWorkspaces, namesFor, requireWorkUser, type Person, type WorkspaceItem } from "@/lib/work/data";
import type { WorkAgendaStatus, WorkMeetingVisibility, WorkStatus } from "@/lib/work/database";

/**
 * Meetings and their agendas, as the signed-in user (RLS decides what comes
 * back: work_meetings and what hangs off it follow work_private.can_view_meeting).
 * Writes live in src/app/work/meeting-actions.ts.
 */

function check<T>(result: { data: T; error: { message: string } | null }, what: string): NonNullable<T> {
  if (result.error) throw new Error(`Loading ${what} failed: ${result.error.message}`);
  return (result.data ?? []) as NonNullable<T>;
}

export type MeetingListItem = {
  id: string;
  name: string;
  visibility: WorkMeetingVisibility;
  archived: boolean;
  workspace: { id: string; name: string; slug: string; kind: WorkspaceItem["kind"] };
  createdBy: string | null;
  /** Points still to discuss in the open session. */
  openPoints: number;
  /** For "only people I pick": who is in. */
  people: Person[];
};

/** Every meeting the user can see, per workspace, archived ones last. */
export const listMeetings = cache(async (): Promise<MeetingListItem[]> => {
  await requireWorkUser();
  const supabase = await createClient();
  const [meetings, workspaces, members, open] = await Promise.all([
    supabase.from("work_meetings").select("id, workspace_id, name, visibility, archived_at, created_by").order("name"),
    listMyWorkspaces(),
    supabase.from("work_meeting_members").select("meeting_id, user_id"),
    supabase.from("work_agenda_items").select("meeting_id").eq("status", "open"),
  ]);
  const rows = check(meetings, "meetings");
  const spaces = new Map(workspaces.map((w) => [w.id, w]));
  const memberRows = check(members, "meeting people");
  const names = await namesFor([...memberRows.map((m) => m.user_id), ...rows.flatMap((m) => (m.created_by ? [m.created_by] : []))]);
  const counts = new Map<string, number>();
  for (const item of check(open, "agenda points")) counts.set(item.meeting_id, (counts.get(item.meeting_id) ?? 0) + 1);

  return rows
    .flatMap((m) => {
      const w = spaces.get(m.workspace_id);
      if (!w) return []; // an archived workspace
      const ids = [...(m.created_by ? [m.created_by] : []), ...memberRows.filter((r) => r.meeting_id === m.id).map((r) => r.user_id)];
      return [
        {
          id: m.id,
          name: m.name,
          visibility: m.visibility,
          archived: Boolean(m.archived_at),
          workspace: { id: w.id, name: w.name, slug: w.slug, kind: w.kind },
          createdBy: m.created_by,
          openPoints: counts.get(m.id) ?? 0,
          people: m.visibility === "invited" ? [...new Set(ids)].flatMap((id) => (names.get(id) ? [names.get(id)!] : [])) : [],
        },
      ];
    })
    .sort((a, b) => Number(a.archived) - Number(b.archived) || a.workspace.name.localeCompare(b.workspace.name) || a.name.localeCompare(b.name));
});

export type AgendaItem = {
  id: string;
  sessionId: string;
  title: string;
  note: string | null;
  addedBy: Person | null;
  source: "portal" | "claude";
  status: WorkAgendaStatus;
  decision: string | null;
  decidedBy: Person | null;
  decidedAt: string | null;
  task: { id: string; title: string; status: WorkStatus } | null;
  /** How often the point moved on to the next meeting before this one. */
  carriedCount: number;
  /** When the point moved on: the next round it went to. */
  forwardedToOpenedAt: string | null;
  createdAt: string;
};

export type MeetingRound = { id: string; openedAt: string; closedAt: string | null; closedBy: Person | null; items: AgendaItem[] };

export type MeetingDetail = {
  id: string;
  name: string;
  visibility: WorkMeetingVisibility;
  archived: boolean;
  workspace: WorkspaceItem;
  createdBy: string | null;
  /** Rename, change who is in, close: the maker, and workspace admins for a meeting for the whole workspace. */
  canManage: boolean;
  /** Everyone who sees the meeting (the choices for "Make task"). */
  people: Person[];
  /** The people picked, for "only people I pick". */
  picked: string[];
  /** The agenda: the open round. */
  current: MeetingRound;
  /** Earlier rounds, newest first. */
  history: MeetingRound[];
};

const ROUNDS = 6;

export const getMeeting = cache(async (meetingId: string): Promise<MeetingDetail> => {
  const user = await requireWorkUser();
  const supabase = await createClient();
  const { data: meeting } = await supabase
    .from("work_meetings")
    .select("id, workspace_id, name, visibility, archived_at, created_by")
    .eq("id", meetingId)
    .maybeSingle();
  if (!meeting) notFound();
  const workspaces = await listMyWorkspaces({ includeArchived: true });
  const workspace = workspaces.find((w) => w.id === meeting.workspace_id);
  if (!workspace) notFound();

  const [sessionsResult, membersResult] = await Promise.all([
    supabase
      .from("work_meeting_sessions")
      .select("id, opened_at, closed_at, closed_by")
      .eq("meeting_id", meetingId)
      .order("opened_at", { ascending: false })
      .limit(ROUNDS + 1),
    supabase.from("work_meeting_members").select("user_id").eq("meeting_id", meetingId),
  ]);
  const sessions = check(sessionsResult, "rounds");
  const picked = check(membersResult, "meeting people").map((m) => m.user_id);
  const itemsResult = await supabase
    .from("work_agenda_items")
    .select(
      "id, session_id, title, note, added_by, source, status, decision, decided_by, decided_at, task_id, carried_count, forwarded_to, position, created_at, task:work_tasks(id, title, status)",
    )
    .in("session_id", sessions.map((s) => s.id))
    .order("position")
    .order("created_at");
  const items = check(itemsResult, "agenda points");

  // Who sees the meeting: the maker and the people picked, or the whole workspace.
  const ws = meeting.visibility === "workspace" ? await listMembers(meeting.workspace_id) : [];
  const peopleIds = new Set<string>([
    ...picked,
    ...(meeting.created_by ? [meeting.created_by] : []),
    ...ws.filter((m) => !m.deactivatedAt && m.role !== "guest").map((m) => m.id),
  ]);
  const names = await namesFor([
    ...peopleIds,
    ...items.flatMap((i) => [i.added_by, i.decided_by].filter((id): id is string => Boolean(id))),
    ...sessions.flatMap((s) => (s.closed_by ? [s.closed_by] : [])),
  ]);
  const person = (id: string | null) => (id ? (names.get(id) ?? null) : null);

  const sessionOpened = new Map(sessions.map((s) => [s.id, s.opened_at]));
  const itemSession = new Map(items.map((i) => [i.id, i.session_id]));
  const shape = (i: (typeof items)[number]): AgendaItem => {
    const task = i.task as { id: string; title: string; status: WorkStatus } | null;
    const target = i.forwarded_to ? itemSession.get(i.forwarded_to) : undefined;
    return {
      id: i.id,
      sessionId: i.session_id,
      title: i.title,
      note: i.note,
      addedBy: person(i.added_by),
      source: i.source,
      status: i.status,
      decision: i.decision,
      decidedBy: person(i.decided_by),
      decidedAt: i.decided_at,
      task: task ? { id: task.id, title: task.title, status: task.status } : null,
      carriedCount: i.carried_count,
      forwardedToOpenedAt: target ? (sessionOpened.get(target) ?? null) : null,
      createdAt: i.created_at,
    };
  };
  const round = (s: (typeof sessions)[number]): MeetingRound => ({
    id: s.id,
    openedAt: s.opened_at,
    closedAt: s.closed_at,
    closedBy: person(s.closed_by),
    items: items.filter((i) => i.session_id === s.id).map(shape),
  });

  const open = sessions.find((s) => !s.closed_at);
  if (!open) notFound();
  const canManage = meeting.created_by === user.id || (meeting.visibility === "workspace" && workspace.role === "admin");
  return {
    id: meeting.id,
    name: meeting.name,
    visibility: meeting.visibility,
    archived: Boolean(meeting.archived_at),
    workspace,
    createdBy: meeting.created_by,
    canManage,
    people: [...peopleIds].flatMap((id) => (names.get(id) ? [names.get(id)!] : [])).sort((a, b) => a.name.localeCompare(b.name)),
    picked,
    current: round(open),
    history: sessions.filter((s) => s.closed_at).slice(0, ROUNDS).map(round),
  };
});

/** Workspaces the user may start a meeting in (not the inbox, not as a guest). */
export async function listMeetingWorkspaces(): Promise<WorkspaceItem[]> {
  const all = await listMyWorkspaces();
  return all.filter((w) => w.kind !== "inbox" && w.role !== "guest");
}
