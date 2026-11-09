import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createNordavoMcpServer } from "@/lib/mcp/server";
import type { McpDb } from "@/lib/mcp/shared";
import type { McpTokenContext } from "@/lib/mcp/tokens";
import { amsterdamDay, amsterdamDayStart, amsterdamDueAt } from "@/lib/mcp/work-tasks";
import { dueGroup, groupByDue } from "@/lib/work/grouping";

// ---------------------------------------------------------------------------
// Grouping by deadline in the viewer's time zone (Tasks and Work merged)
// ---------------------------------------------------------------------------

test("dueGroup: overdue, today, this week up to Sunday, later and no date", () => {
  // Wednesday 4 November 2026, 10:00 in Amsterdam (09:00 UTC).
  const now = new Date("2026-11-04T09:00:00Z");
  const tz = "Europe/Amsterdam";
  assert.equal(dueGroup(null, tz, now), "none");
  assert.equal(dueGroup("2026-11-04T08:00:00Z", tz, now), "overdue");
  assert.equal(dueGroup("2026-11-04T16:00:00Z", tz, now), "today");
  assert.equal(dueGroup("2026-11-08T20:00:00Z", tz, now), "week"); // Sunday 21:00
  assert.equal(dueGroup("2026-11-08T23:30:00Z", tz, now), "later"); // Monday 00:30 in Amsterdam
  assert.equal(dueGroup("2026-12-01T12:00:00Z", tz, now), "later");
});

test("dueGroup follows the viewer's time zone", () => {
  // 20:00 UTC on Wednesday is already Thursday 01:30 in Bangalore.
  const now = new Date("2026-11-04T12:00:00Z");
  assert.equal(dueGroup("2026-11-04T20:00:00Z", "Europe/Amsterdam", now), "today");
  assert.equal(dueGroup("2026-11-04T20:00:00Z", "Asia/Kolkata", now), "week");
});

test("groupByDue keeps the order and leaves out empty groups", () => {
  const now = new Date("2026-11-04T09:00:00Z");
  const groups = groupByDue(
    [
      { id: "a", dueAt: null },
      { id: "b", dueAt: "2026-11-03T09:00:00Z" },
      { id: "c", dueAt: "2026-11-04T15:00:00Z" },
      { id: "d", dueAt: "2026-11-04T16:00:00Z" },
    ],
    "Europe/Amsterdam",
    now,
  );
  assert.deepEqual(
    groups.map((g) => [g.key, g.tasks.map((t) => t.id)]),
    [
      ["overdue", ["b"]],
      ["today", ["c", "d"]],
      ["none", ["a"]],
    ],
  );
  assert.equal(groups[0].tone, "danger");
});

test("MCP deadlines given as a day are 17:00 in Amsterdam", () => {
  assert.equal(amsterdamDueAt("2026-11-04"), "2026-11-04T16:00:00.000Z");
  assert.equal(amsterdamDueAt("2026-07-01"), "2026-07-01T15:00:00.000Z");
  assert.equal(amsterdamDayStart("2026-11-04"), "2026-11-03T23:00:00.000Z");
  assert.equal(amsterdamDay("2026-11-03T23:30:00Z"), "2026-11-04");
});

// ---------------------------------------------------------------------------
// The portal MCP writes Work tasks as the token owner
// ---------------------------------------------------------------------------

const OWNER = "00000000-0000-4000-8000-0000000000aa";
const TASK = "00000000-0000-4000-8000-0000000000b1";
const CLIENT = "00000000-0000-4000-8000-0000000000c1";

type Row = Record<string, unknown>;

/** A fake secret key client: from() answers with fixed rows, rpc() is recorded. */
function fakeDb(tables: Record<string, Row[]>, rpcResults: Record<string, { data: unknown; error: unknown }>) {
  const rpcCalls: { fn: string; args: Row }[] = [];
  const db = {
    from(table: string) {
      const rows = tables[table] ?? [];
      const result = { data: rows, error: null };
      const builder: Record<string, unknown> = {};
      for (const op of ["select", "eq", "in", "neq", "is", "order", "limit", "or"]) builder[op] = () => builder;
      builder.single = async () => ({ data: rows[0] ?? null, error: null });
      builder.maybeSingle = async () => ({ data: rows[0] ?? null, error: null });
      builder.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(result).then(resolve, reject);
      return builder;
    },
    async rpc(fn: string, args: Row) {
      rpcCalls.push({ fn, args });
      return rpcResults[fn] ?? { data: null, error: null };
    },
  };
  return { db: db as unknown as McpDb, rpcCalls };
}

async function callTool(db: McpDb, name: string, args: Row) {
  const ctx: McpTokenContext = {
    tokenId: "00000000-0000-4000-8000-000000000001",
    tokenName: "Test",
    userId: OWNER,
    access: "write",
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

const taskRow = {
  id: TASK,
  title: "Call about the intake",
  description: null,
  status: "todo",
  priority: "high",
  due_at: "2026-11-04T16:00:00Z",
  project_id: "00000000-0000-4000-8000-0000000000b2",
  reviewer_id: OWNER,
  completed_at: null,
};

test("create_task makes a Work task on the record, as the token owner", async () => {
  const { db, rpcCalls } = fakeDb(
    {
      clients: [{ id: CLIENT }],
      work_tasks: [taskRow],
      work_task_links: [{ task_id: TASK, entity_type: "client", entity_id: CLIENT }],
      work_task_assignees: [{ task_id: TASK, user_id: OWNER }],
      profiles: [{ id: OWNER, full_name: "Julius", email: "julius@nordavo.nl" }],
      work_projects: [{ id: taskRow.project_id, name: "Portal records" }],
    },
    { work_create_record_task: { data: TASK, error: null } },
  );
  const { isError, text } = await callTool(db, "create_task", {
    title: "Call about the intake",
    priority: "high",
    due_date: "2026-11-04",
    entity_type: "client",
    entity_id: CLIENT,
  });
  assert.equal(isError, false, text);
  const call = rpcCalls.find((c) => c.fn === "work_create_record_task");
  assert.ok(call);
  assert.equal(call.args.p_actor, OWNER);
  assert.equal(call.args.p_entity_type, "client");
  assert.equal(call.args.p_entity_id, CLIENT);
  assert.equal(call.args.p_due_at, "2026-11-04T16:00:00.000Z");
  assert.deepEqual(call.args.p_assignees, [OWNER]);
  const body = JSON.parse(text);
  assert.equal(body.url, `https://portal.nordavo.nl/work/tasks/${TASK}`);
  assert.equal(body.created.linked.type, "client");
});

test("update_task_status goes through work_set_status with the review rules", async () => {
  const { db, rpcCalls } = fakeDb(
    { work_tasks: [{ ...taskRow, status: "done" }] },
    { work_api_can_view_task: { data: true, error: null }, work_set_status: { data: null, error: null } },
  );
  const { isError } = await callTool(db, "update_task_status", { id: TASK, status: "done" });
  assert.equal(isError, false);
  const call = rpcCalls.find((c) => c.fn === "work_set_status");
  assert.deepEqual(call?.args, { p_task: TASK, p_status: "done", p_comment: null, p_actor: OWNER });

  const refused = fakeDb(
    {},
    {
      work_api_can_view_task: { data: true, error: null },
      work_set_status: { data: null, error: { message: "Only the reviewer or an admin can mark this task as done" } },
    },
  );
  const result = await callTool(refused.db, "update_task_status", { id: TASK, status: "done" });
  assert.equal(result.isError, true);
  assert.match(result.text, /Only the reviewer/);
});

test("a task the token owner cannot open is not found", async () => {
  const { db, rpcCalls } = fakeDb({}, { work_api_can_view_task: { data: false, error: null } });
  const result = await callTool(db, "update_task_status", { id: TASK, status: "in_progress" });
  assert.equal(result.isError, true);
  assert.match(result.text, /not found/);
  assert.equal(rpcCalls.some((c) => c.fn === "work_set_status"), false);
});
