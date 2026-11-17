import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createNordavoMcpServer } from "@/lib/mcp/server";
import type { McpDb } from "@/lib/mcp/shared";
import type { McpTokenContext } from "@/lib/mcp/tokens";
import { agendaStatus, bySource, carriedLabel, meetingVisibilities } from "@/lib/work/meeting-labels";
import { toolAllowed } from "@/lib/mcp/module-access";

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

test("carriedLabel says how often a point moved on", () => {
  assert.equal(carriedLabel(0), null);
  assert.equal(carriedLabel(1), "Moved on once");
  assert.equal(carriedLabel(3), "Moved on 3 times");
});

test("agenda statuses and the source of a point", () => {
  assert.equal(agendaStatus("discussed").label, "Discussed");
  assert.equal(agendaStatus("forwarded").label, "Moved on");
  assert.equal(bySource("claude"), " via Claude");
  assert.equal(bySource("portal"), "");
  assert.deepEqual(
    meetingVisibilities.map((v) => v.value),
    ["workspace", "invited"],
  );
});

// ---------------------------------------------------------------------------
// MCP: list_agenda and add_agenda_item, as the token owner
// ---------------------------------------------------------------------------

const OWNER = "00000000-0000-4000-8000-0000000000aa";
const FLORIS = "00000000-0000-4000-8000-0000000000ab";
const MEETING = "00000000-0000-4000-8000-0000000000d1";
const WORKSPACE = "00000000-0000-4000-8000-0000000000e1";
const SESSION = "00000000-0000-4000-8000-0000000000f1";
const ITEM = "00000000-0000-4000-8000-0000000000f2";

type Row = Record<string, unknown>;

/** A fake secret key client: from() answers with fixed rows, rpc() answers per function and is recorded. */
function fakeDb(tables: Record<string, Row[]>, rpcResults: Record<string, { data: unknown; error: unknown }>) {
  const rpcCalls: { fn: string; args: Row }[] = [];
  const db = {
    from(table: string) {
      const rows = tables[table] ?? [];
      const builder: Record<string, unknown> = {};
      for (const op of ["select", "eq", "in", "neq", "is", "order", "limit", "or"]) builder[op] = () => builder;
      builder.maybeSingle = async () => ({ data: rows[0] ?? null, error: null });
      builder.single = async () => ({ data: rows[0] ?? null, error: null });
      builder.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve({ data: rows, error: null }).then(resolve, reject);
      return builder;
    },
    async rpc(fn: string, args: Row) {
      rpcCalls.push({ fn, args });
      return rpcResults[fn] ?? { data: null, error: null };
    },
  };
  return { db: db as unknown as McpDb, rpcCalls };
}

async function callTool(db: McpDb, name: string, args: Row, access: "read" | "write" = "write") {
  const ctx: McpTokenContext = {
    tokenId: "00000000-0000-4000-8000-000000000001",
    tokenName: "Test",
    userId: OWNER,
    access,
    name: "Julius",
    email: "julius@nordavo.nl",
    role: "admin",
  };
  const server = createNordavoMcpServer(ctx, db, "https://portal.nordavo.nl");
  const client = new Client({ name: "test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const result = await client.callTool({ name, arguments: args });
    const text = (result.content as { type: string; text: string }[])[0].text;
    return { isError: Boolean(result.isError), text };
  } finally {
    await client.close();
    await server.close();
  }
}

const meetingRow = {
  id: MEETING,
  workspace_id: WORKSPACE,
  name: "Weekly with Floris",
  visibility: "invited",
  created_by: OWNER,
  archived_at: null,
};

test("list_agenda lists the meetings the token owner may open, with who is in", async () => {
  const { db, rpcCalls } = fakeDb(
    {
      work_workspaces: [{ id: WORKSPACE, name: "Nordavo", kind: "shared", archived_at: null }],
      work_meeting_members: [{ meeting_id: MEETING, user_id: FLORIS }],
      work_agenda_items: [{ meeting_id: MEETING }, { meeting_id: MEETING }],
      profiles: [
        { id: OWNER, full_name: "Julius", email: "julius@nordavo.nl" },
        { id: FLORIS, full_name: "Floris", email: "floris@nordavo.nl" },
      ],
    },
    { work_api_visible_meetings: { data: [meetingRow], error: null } },
  );
  const { isError, text } = await callTool(db, "list_agenda", {}, "read");
  assert.equal(isError, false);
  const result = JSON.parse(text);
  assert.equal(rpcCalls[0].fn, "work_api_visible_meetings");
  assert.equal(rpcCalls[0].args.p_user, OWNER);
  assert.equal(result.meetings.length, 1);
  assert.equal(result.meetings[0].open_points, 2);
  assert.deepEqual(
    result.meetings[0].people.map((p: { name: string }) => p.name),
    ["Julius", "Floris"],
  );
  assert.equal(result.meetings[0].url, `https://portal.nordavo.nl/work/meetings/${MEETING}`);
});

test("list_agenda with a meeting gives its open points, and nothing for a meeting the owner cannot see", async () => {
  const { db } = fakeDb(
    {
      work_meetings: [meetingRow],
      work_meeting_sessions: [{ id: SESSION, opened_at: "2026-11-17T09:00:00Z" }],
      work_agenda_items: [
        {
          id: ITEM,
          title: "Hiring plan Q1",
          note: "Two roles?",
          added_by: FLORIS,
          decided_by: null,
          source: "claude",
          created_at: "2026-11-17T10:00:00Z",
          status: "open",
          decision: null,
          carried_count: 2,
          task: null,
        },
      ],
      profiles: [{ id: FLORIS, full_name: "Floris", email: "floris@nordavo.nl" }],
    },
    { work_api_can_view_meeting: { data: true, error: null } },
  );
  const { isError, text } = await callTool(db, "list_agenda", { meeting_id: MEETING }, "read");
  assert.equal(isError, false);
  const result = JSON.parse(text);
  assert.equal(result.meeting.name, "Weekly with Floris");
  assert.equal(result.points.length, 1);
  assert.deepEqual(
    { title: result.points[0].title, by: result.points[0].brought_up_by.name, source: result.points[0].source, moved: result.points[0].moved_on_times },
    { title: "Hiring plan Q1", by: "Floris", source: "claude", moved: 2 },
  );

  const hidden = fakeDb({ work_meetings: [meetingRow] }, { work_api_can_view_meeting: { data: false, error: null } });
  const refused = await callTool(hidden.db, "list_agenda", { meeting_id: MEETING }, "read");
  assert.equal(refused.isError, true);
  assert.match(refused.text, /not found/i);
});

test("add_agenda_item adds the point as the token owner with the source claude", async () => {
  const { db, rpcCalls } = fakeDb({}, { work_api_can_view_meeting: { data: true, error: null }, work_add_agenda_item: { data: ITEM, error: null } });
  const { isError, text } = await callTool(db, "add_agenda_item", { meeting_id: MEETING, title: "  Budget 2027  ", note: "Julius has the numbers" });
  assert.equal(isError, false);
  assert.equal(JSON.parse(text).added.id, ITEM);
  const add = rpcCalls.find((c) => c.fn === "work_add_agenda_item");
  assert.deepEqual(add?.args, {
    p_meeting: MEETING,
    p_title: "Budget 2027",
    p_note: "Julius has the numbers",
    p_source: "claude",
    p_actor: OWNER,
  });
});

test("add_agenda_item refuses a meeting the token owner cannot see, and a read token cannot add", async () => {
  const hidden = fakeDb({}, { work_api_can_view_meeting: { data: false, error: null } });
  const refused = await callTool(hidden.db, "add_agenda_item", { meeting_id: MEETING, title: "Sneaky" });
  assert.equal(refused.isError, true);
  assert.equal(hidden.rpcCalls.some((c) => c.fn === "work_add_agenda_item"), false, "nothing is written");

  const readOnly = await callTool(fakeDb({}, {}).db, "add_agenda_item", { meeting_id: MEETING, title: "x" }, "read").catch((e: Error) => e);
  assert.ok(readOnly instanceof Error || (readOnly as { isError: boolean }).isError, "a read token has no add_agenda_item");
});

test("add_agenda_item follows the rights per module (Work)", () => {
  assert.equal(toolAllowed("add_agenda_item", { work: "write" }), true);
  assert.equal(toolAllowed("add_agenda_item", { work: "suggest" }), false);
  assert.equal(toolAllowed("add_agenda_item", { work: "read" }), false);
  assert.equal(toolAllowed("list_agenda", { work: "read" }), true);
});
