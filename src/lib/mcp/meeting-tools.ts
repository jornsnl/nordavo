import "server-only";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { check, clip, fail, idSchema, ok, personName, type McpToolContext } from "@/lib/mcp/shared";
import type { WorkAgendaItemRow, WorkMeetingRow } from "@/lib/work/database";

/**
 * Meetings for the portal MCP: list_agenda (read) and add_agenda_item (write,
 * module Work). Which meetings the token owner may open is decided by the
 * database (work_api_visible_meetings, work_api_can_view_meeting) and the
 * point is added through work_add_agenda_item with p_actor = the token owner
 * and the source claude, so it shows "via Claude" next to their name.
 */

const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;

function meetingUrl(siteUrl: string, id: string) {
  return `${siteUrl.replace(/\/$/, "")}/work/meetings/${id}`;
}

/** The meetings the token owner can open, with who is in and how many points are open. */
export async function listMeetingsFor(ctx: McpToolContext) {
  const { db, userId, siteUrl } = ctx;
  const { data, error } = await db.rpc("work_api_visible_meetings", { p_user: userId });
  if (error) throw new Error(`Could not load meetings: ${error.message}`);
  const meetings = (data ?? []) as WorkMeetingRow[];
  if (meetings.length === 0) return { meetings: [] };
  const ids = meetings.map((m) => m.id);
  const [workspaces, members, open] = await Promise.all([
    db.from("work_workspaces").select("id, name, kind, archived_at").in("id", [...new Set(meetings.map((m) => m.workspace_id))]),
    db.from("work_meeting_members").select("meeting_id, user_id").in("meeting_id", ids),
    db.from("work_agenda_items").select("meeting_id").in("meeting_id", ids).eq("status", "open"),
  ]);
  const spaces = new Map(check(workspaces, "workspaces").map((w) => [w.id, w]));
  const memberRows = check(members, "meeting people");
  const peopleIds = [...new Set([...memberRows.map((m) => m.user_id), ...meetings.flatMap((m) => (m.created_by ? [m.created_by] : []))])];
  const profiles = peopleIds.length
    ? check(await db.from("profiles").select("id, full_name, email").in("id", peopleIds), "people")
    : [];
  const names = new Map(profiles.map((p) => [p.id, personName(p)]));
  const counts = new Map<string, number>();
  for (const row of check(open, "agenda points")) counts.set(row.meeting_id, (counts.get(row.meeting_id) ?? 0) + 1);

  return {
    meetings: meetings
      .filter((m) => !spaces.get(m.workspace_id)?.archived_at)
      .map((m) => ({
        id: m.id,
        name: m.name,
        workspace: { id: m.workspace_id, name: spaces.get(m.workspace_id)?.name ?? null, kind: spaces.get(m.workspace_id)?.kind ?? "shared" },
        visibility: m.visibility,
        people:
          m.visibility === "invited"
            ? [...new Set([...(m.created_by ? [m.created_by] : []), ...memberRows.filter((r) => r.meeting_id === m.id).map((r) => r.user_id)])].map((id) => ({
                id,
                name: names.get(id) ?? null,
              }))
            : "everyone in the workspace",
        archived: Boolean(m.archived_at),
        open_points: counts.get(m.id) ?? 0,
        url: meetingUrl(siteUrl, m.id),
      })),
  };
}

type ItemWithTask = WorkAgendaItemRow & { task: { id: string; title: string; status: string } | null };

/** The agenda of one meeting: the open round (what is to be discussed), optionally also what was handled. */
export async function readAgenda(ctx: McpToolContext, meetingId: string, includeHandled: boolean) {
  const { db, userId, siteUrl } = ctx;
  const { data: visible } = await db.rpc("work_api_can_view_meeting", { p_meeting: meetingId, p_user: userId });
  if (!visible) return null;
  const [meeting, session] = await Promise.all([
    db.from("work_meetings").select("id, name, visibility, workspace_id, archived_at").eq("id", meetingId).maybeSingle(),
    db.from("work_meeting_sessions").select("id, opened_at").eq("meeting_id", meetingId).is("closed_at", null).maybeSingle(),
  ]);
  const m = meeting.data;
  if (!m) return null;
  let query = db
    .from("work_agenda_items")
    .select("*, task:work_tasks(id, title, status)")
    .eq("meeting_id", meetingId)
    .eq("session_id", session.data?.id ?? "00000000-0000-0000-0000-000000000000")
    .order("position")
    .order("created_at");
  if (!includeHandled) query = query.eq("status", "open");
  const items = check(await query, "agenda points") as unknown as ItemWithTask[];
  const peopleIds = [...new Set(items.flatMap((i) => [i.added_by, i.decided_by].filter((id): id is string => Boolean(id))))];
  const profiles = peopleIds.length
    ? check(await db.from("profiles").select("id, full_name, email").in("id", peopleIds), "people")
    : [];
  const names = new Map(profiles.map((p) => [p.id, personName(p)]));
  const base = siteUrl.replace(/\/$/, "");
  return {
    meeting: { id: m.id, name: m.name, visibility: m.visibility, archived: Boolean(m.archived_at), url: meetingUrl(siteUrl, m.id) },
    agenda_since: session.data?.opened_at ?? null,
    points: items.map((i) => ({
      id: i.id,
      title: i.title,
      note: clip(i.note, 1000),
      brought_up_by: i.added_by ? { id: i.added_by, name: names.get(i.added_by) ?? null } : null,
      source: i.source,
      added_at: i.created_at,
      status: i.status,
      decision: clip(i.decision, 1000),
      decided_by: i.decided_by ? (names.get(i.decided_by) ?? null) : null,
      moved_on_times: i.carried_count,
      task: i.task ? { id: i.task.id, title: i.task.title, status: i.task.status, url: `${base}/work/tasks/${i.task.id}` } : null,
    })),
  };
}

export function registerMeetingTools(server: McpServer, ctx: McpToolContext) {
  const { db } = ctx;

  server.registerTool(
    "list_agenda",
    {
      title: "Meeting agendas",
      description:
        "Work meetings: agendas of recurring meetings (a weekly with a colleague, a team meeting) that people drop points on. Without meeting_id: the meetings you can open, with who is in them and how many points are open. With meeting_id: the agenda of that meeting, the points still to discuss with who brought them up, notes, decisions and linked tasks (include_handled adds the points discussed or dropped in this round). Only meetings the token owner is allowed to see are returned; a meeting for a few people stays hidden from the others, workspace admins included.",
      inputSchema: {
        meeting_id: idSchema.optional().describe("A meeting from list_agenda without meeting_id."),
        include_handled: z.boolean().default(false).describe("Also points that were discussed or dropped in the current round."),
      },
      annotations: READ_ONLY,
    },
    async ({ meeting_id, include_handled }) => {
      if (!meeting_id) return ok(await listMeetingsFor(ctx));
      const agenda = await readAgenda(ctx, meeting_id, include_handled);
      return agenda ? ok(agenda) : fail("Meeting not found. See list_agenda.");
    },
  );

  if (ctx.access !== "write") return;

  server.registerTool(
    "add_agenda_item",
    {
      title: "Add agenda point",
      description:
        "Drop a point on the agenda of a Work meeting (list_agenda shows the meetings and their ids). It lands in the open round, with the token owner as the one who brought it up, marked as added via Claude. Only call after the user asked for it. Making a task out of a point and closing a meeting are done by people in the portal.",
      inputSchema: {
        meeting_id: idSchema,
        title: z.string().trim().min(1).max(300).describe("The point, in a few words."),
        note: z.string().max(5000).optional().describe("Optional context."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ meeting_id, title, note }) => {
      const { data: visible } = await db.rpc("work_api_can_view_meeting", { p_meeting: meeting_id, p_user: ctx.userId });
      if (!visible) return fail("Meeting not found. See list_agenda.");
      const { data: itemId, error } = await db.rpc("work_add_agenda_item", {
        p_meeting: meeting_id,
        p_title: title,
        p_note: note?.trim() || null,
        p_source: "claude",
        p_actor: ctx.userId,
      });
      if (error || !itemId) return fail(`Could not add the point: ${error?.message ?? "no id returned"}`);
      return ok({ added: { id: itemId, meeting_id, title }, url: meetingUrl(ctx.siteUrl, meeting_id) });
    },
  );
}
