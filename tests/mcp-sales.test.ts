import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createNordavoMcpServer } from "@/lib/mcp/server";
import { companyPatch, icpLeadStatus, SALES_READ_TOOLS, SALES_WRITE_TOOLS } from "@/lib/mcp/sales-tools";
import type { McpDb } from "@/lib/mcp/shared";
import type { McpTokenContext } from "@/lib/mcp/tokens";
import type { PortalModule } from "@/lib/database.types";

const USER = "00000000-0000-4000-8000-0000000000aa";
const ID_A = "00000000-0000-4000-8000-00000000000a";
const ID_B = "00000000-0000-4000-8000-00000000000b";

type RpcCall = { fn: string; args: Record<string, unknown> };

/** A db that records rpc calls and answers every table query with an empty result. */
function fakeDb(rpcResult: unknown = 1) {
  const calls: RpcCall[] = [];
  const empty = { data: null, error: null, count: 0 };
  const builder: unknown = new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === "then") return (resolve: (v: unknown) => unknown) => Promise.resolve(empty).then(resolve);
      return () => builder;
    },
    apply() {
      return builder;
    },
  });
  const db = {
    from: () => builder,
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return { data: rpcResult, error: null };
    },
  };
  return { db: db as unknown as McpDb, calls };
}

async function connect(
  access: "read" | "write",
  options: { role?: "admin" | "member"; modules?: PortalModule[]; db?: McpDb } = {},
) {
  const ctx: McpTokenContext = {
    tokenId: "00000000-0000-4000-8000-000000000001",
    tokenName: "Scheduled tasks",
    userId: USER,
    access,
    name: "Julius",
    email: "julius@nordavo.nl",
    role: options.role ?? "member",
    modules: options.modules,
  };
  const server = createNordavoMcpServer(ctx, options.db ?? ({} as McpDb), "https://portal.nordavo.nl");
  const client = new Client({ name: "test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    async close() {
      await client.close();
      await server.close();
    },
  };
}

/** Call a tool; returns the text and whether it was an error (validation errors may throw). */
async function call(client: Client, name: string, args: Record<string, unknown>) {
  try {
    const result = await client.callTool({ name, arguments: args });
    const text = (result.content as { type: string; text: string }[]).map((c) => c.text).join("\n");
    return { isError: Boolean(result.isError), text };
  } catch (error) {
    return { isError: true, text: error instanceof Error ? error.message : String(error) };
  }
}

test("a read token gets the sales read tools, none of the sales write tools", async () => {
  const { client, close } = await connect("read");
  try {
    const names = (await client.listTools()).tools.map((t) => t.name);
    for (const tool of SALES_READ_TOOLS) assert.ok(names.includes(tool), `${tool} missing`);
    for (const tool of SALES_WRITE_TOOLS) assert.ok(!names.includes(tool), `${tool} should not be listed`);
  } finally {
    await close();
  }
});

test("a write token gets every sales tool", async () => {
  const { client, close } = await connect("write");
  try {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    for (const tool of [...SALES_READ_TOOLS, ...SALES_WRITE_TOOLS]) assert.ok(names.includes(tool), `${tool} missing`);
    for (const tool of SALES_READ_TOOLS) {
      assert.equal(tools.find((t) => t.name === tool)?.annotations?.readOnlyHint, true, `${tool} should be read only`);
    }
  } finally {
    await close();
  }
});

test("an owner without the sales module gets no sales tools", async () => {
  const { client, close } = await connect("write", { modules: ["recruitment"] });
  try {
    const names = (await client.listTools()).tools.map((t) => t.name);
    for (const tool of [...SALES_READ_TOOLS, ...SALES_WRITE_TOOLS]) assert.ok(!names.includes(tool), `${tool} should not be listed`);
  } finally {
    await close();
  }
});

test("update_companies validates its fields before touching the database", async () => {
  const { db, calls } = fakeDb();
  const { client, close } = await connect("write", { db });
  try {
    const lost = await call(client, "update_companies", { ids: [ID_A], fields: { pipeline_stage: "lost" } });
    assert.ok(lost.isError);
    assert.match(lost.text, /lost_reason/);
    const unknown = await call(client, "update_companies", { ids: [ID_A], fields: { domain: "evil.nl" } });
    assert.ok(unknown.isError);
    const empty = await call(client, "update_companies", { ids: [ID_A], fields: {} });
    assert.ok(empty.isError);
    const badPrio = await call(client, "update_companies", { ids: [ID_A], fields: { prio: 9 } });
    assert.ok(badPrio.isError);
    const badId = await call(client, "update_companies", { ids: ["nope"], fields: { prio: 1 } });
    assert.ok(badId.isError);
    assert.equal(calls.length, 0);
  } finally {
    await close();
  }
});

test("update_companies writes through sales_update as the token owner with source claude", async () => {
  const { db, calls } = fakeDb(2);
  const { client, close } = await connect("write", { db });
  try {
    const result = await call(client, "update_companies", {
      ids: [ID_A, ID_B, ID_A],
      fields: { lead_status: "ready", prio: 2, pinned: true, pipeline_stage: "lost", lost_reason: "Hired in house" },
    });
    assert.ok(!result.isError, result.text);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].fn, "sales_update");
    assert.deepEqual(calls[0].args.p_ids, [ID_A, ID_B]);
    assert.equal(calls[0].args.p_entity, "company");
    assert.equal(calls[0].args.p_source, "claude");
    assert.equal(calls[0].args.p_actor, USER);
    const fields = calls[0].args.p_fields as Record<string, unknown>;
    assert.equal(fields.lead_status, "ready");
    assert.equal(typeof fields.pinned_at, "string");
    assert.equal(fields.pinned, undefined);
    assert.deepEqual(JSON.parse(result.text), { updated: 2, requested: 2 });
  } finally {
    await close();
  }
});

test("log_activity needs a target and only reviews replies", async () => {
  const { db, calls } = fakeDb("00000000-0000-4000-8000-0000000000f1");
  const { client, close } = await connect("write", { db });
  try {
    assert.ok((await call(client, "log_activity", { channel: "mail", type: "reply" })).isError);
    assert.ok(
      (await call(client, "log_activity", { company_id: ID_A, channel: "mail", type: "contact", review: true })).isError,
    );
    assert.ok((await call(client, "log_activity", { company_id: ID_A, channel: "fax" })).isError);
    const ok = await call(client, "log_activity", {
      company_id: ID_A,
      channel: "mail",
      type: "reply",
      outcome: "reply_neutraal",
      notes: "Maybe in Q1",
      source: "instantly",
      external_id: "inst-42",
      review: true,
      suggestion: { classification: "not now", lead_status: "cooled_down" },
    });
    assert.ok(!ok.isError, ok.text);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].fn, "sales_log_activity");
    assert.equal(calls[0].args.p_source, "instantly");
    assert.equal(calls[0].args.p_direction, "inbound");
    assert.equal(calls[0].args.p_review, true);
    assert.equal(calls[0].args.p_actor, USER);
  } finally {
    await close();
  }
});

test("call lists can only be opened by admin token owners", async () => {
  const { db } = fakeDb();
  const member = await connect("write", { db });
  try {
    const result = await call(member.client, "open_list_for_callers", { view_id: ID_A, caller_ids: [ID_B] });
    assert.ok(result.isError);
    assert.match(result.text, /admin/);
    assert.ok((await call(member.client, "close_list_for_callers", { view_id: ID_A })).isError);
  } finally {
    await member.close();
  }
});

test("log_job_run only takes claude-* names and checks start and finish", async () => {
  const { db } = fakeDb();
  const { client, close } = await connect("write", { db });
  try {
    assert.ok((await call(client, "log_job_run", { action: "start", job_name: "s1-signals" })).isError);
    assert.ok((await call(client, "log_job_run", { action: "start" })).isError);
    assert.ok((await call(client, "log_job_run", { action: "finish", status: "success" })).isError);
    assert.ok((await call(client, "log_job_run", { action: "finish", run_id: ID_A })).isError);
  } finally {
    await close();
  }
});

test("start_sequence starts per company with source claude and keeps contact_id to one company", async () => {
  const { db, calls } = fakeDb("00000000-0000-4000-8000-0000000000e1");
  const { client, close } = await connect("write", { db });
  try {
    assert.ok((await call(client, "start_sequence", { sequence_id: ID_A, company_ids: [ID_A, ID_B], contact_id: ID_A })).isError);
    const result = await call(client, "start_sequence", { sequence_id: ID_A, company_ids: [ID_A, ID_B] });
    assert.ok(!result.isError, result.text);
    assert.deepEqual(
      calls.map((c) => [c.fn, c.args.p_company, c.args.p_source, c.args.p_actor]),
      [
        ["sales_start_sequence", ID_A, "claude", USER],
        ["sales_start_sequence", ID_B, "claude", USER],
      ],
    );
    assert.equal(JSON.parse(result.text).started, 2);
  } finally {
    await close();
  }
});

test("upsert_companies rejects only the company without a domain or LinkedIn URL", async () => {
  const { db } = fakeDb();
  const { client, close } = await connect("write", { db });
  try {
    // The batch is not rejected: the company without a key is reported with its reason (143e4a7a).
    const result = await call(client, "upsert_companies", { source: "apify", companies: [{ name: "No key BV" }] });
    assert.ok(!result.isError);
    const body = JSON.parse(result.text);
    assert.equal(body.failed, 1);
    assert.match(body.results[0].error, /No website or company LinkedIn page/);
    assert.ok((await call(client, "upsert_companies", { source: "indeed", companies: [{ name: "X", domain: "x.nl" }] })).isError);
  } finally {
    await close();
  }
});

test("sales_stats custom needs from and to", async () => {
  const { db } = fakeDb();
  const { client, close } = await connect("read", { db });
  try {
    const result = await call(client, "sales_stats", { period: "custom", from: "2026-11-01" });
    assert.ok(result.isError);
    assert.match(result.text, /from and to/);
  } finally {
    await close();
  }
});

test("icpLeadStatus follows the verdict only for companies not approached yet", () => {
  assert.equal(icpLeadStatus("GO", "new"), "ready");
  assert.equal(icpLeadStatus("REVIEW", "new"), "review");
  assert.equal(icpLeadStatus("NO_GO", "ready"), "no_go");
  assert.equal(icpLeadStatus("GO", "ready"), null);
  assert.equal(icpLeadStatus("GO", "in_sequence"), null);
  assert.equal(icpLeadStatus("GO", "in_sequence", "review"), "review");
});

test("companyPatch turns pinned into pinned_at and keeps null to clear", () => {
  const now = new Date("2026-11-09T10:00:00Z");
  assert.deepEqual(companyPatch({ pinned: true, owner_id: null }, now), { pinned_at: "2026-11-09T10:00:00.000Z", owner_id: null });
  assert.deepEqual(companyPatch({ pinned: false }, now), { pinned_at: null });
});

test("a recruitment owner gets the matching and screening tools and log_job_run, only for recruitment tasks", async () => {
  const { RECRUITMENT_AI_READ_TOOLS, RECRUITMENT_AI_WRITE_TOOLS } = await import("@/lib/mcp/recruitment-ai-tools");
  const { db } = fakeDb();
  const { client, close } = await connect("write", { modules: ["recruitment"], db });
  try {
    const names = (await client.listTools()).tools.map((t) => t.name);
    for (const tool of [...RECRUITMENT_AI_READ_TOOLS, ...RECRUITMENT_AI_WRITE_TOOLS, "log_job_run"]) {
      assert.ok(names.includes(tool), `${tool} missing`);
    }
    const sales = await call(client, "log_job_run", { action: "start", job_name: "claude-replies" });
    assert.ok(sales.isError);
    assert.match(sales.text, /Sales/);
  } finally {
    await close();
  }
});

test("a sales owner gets no matching or screening tools", async () => {
  const { RECRUITMENT_AI_READ_TOOLS, RECRUITMENT_AI_WRITE_TOOLS } = await import("@/lib/mcp/recruitment-ai-tools");
  const { client, close } = await connect("write", { modules: ["sales"] });
  try {
    const names = (await client.listTools()).tools.map((t) => t.name);
    for (const tool of [...RECRUITMENT_AI_READ_TOOLS, ...RECRUITMENT_AI_WRITE_TOOLS]) assert.ok(!names.includes(tool), `${tool} should not be listed`);
    assert.ok(names.includes("log_job_run"));
  } finally {
    await close();
  }
});

test("claude-match and claude-screening are recruitment jobs, other claude-* jobs sales", async () => {
  const { jobModule } = await import("@/lib/modules");
  assert.equal(jobModule("claude-match"), "recruitment");
  assert.equal(jobModule("claude-screening"), "recruitment");
  assert.equal(jobModule("claude-replies"), "sales");
});

test("every AI request kind has an answer schema, and the request tools follow the modules", async () => {
  const { aiTasks, AI_REQUEST_KINDS } = await import("@/lib/ai/tasks");
  assert.ok(AI_REQUEST_KINDS.length >= 9);
  for (const kind of AI_REQUEST_KINDS) assert.ok(aiTasks[kind].schema && aiTasks[kind].what, `${kind} incomplete`);

  const academy = await connect("write", { modules: ["academy"] });
  try {
    const names = (await academy.client.listTools()).tools.map((t) => t.name);
    assert.ok(names.includes("list_ai_requests") && names.includes("complete_ai_request") && names.includes("log_job_run"));
  } finally {
    await academy.close();
  }
  const sales = await connect("write", { modules: ["sales"] });
  try {
    const names = (await sales.client.listTools()).tools.map((t) => t.name);
    assert.ok(!names.includes("list_ai_requests"));
  } finally {
    await sales.close();
  }
});

test("complete_ai_request needs a result or a reason and refuses unknown requests", async () => {
  const { db } = fakeDb();
  const { client, close } = await connect("write", { modules: ["recruitment"], db });
  try {
    const missing = await call(client, "complete_ai_request", { request_id: ID_A, result: { x: 1 } });
    assert.ok(missing.isError);
    assert.match(missing.text, /not found/);
  } finally {
    await close();
  }
});

test("claude-requests is a job every staff member sees", async () => {
  const { jobModule } = await import("@/lib/modules");
  assert.equal(jobModule("claude-requests"), null);
});
