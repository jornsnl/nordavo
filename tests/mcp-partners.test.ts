import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createNordavoMcpServer } from "@/lib/mcp/server";
import { toolAllowed, WRITE_TOOLS as GATED_TOOLS } from "@/lib/mcp/module-access";
import { PARTNER_READ_TOOLS, PARTNER_WRITE_TOOLS } from "@/lib/mcp/partner-tools";
import type { McpDb } from "@/lib/mcp/shared";
import type { McpTokenContext } from "@/lib/mcp/tokens";
import type { PortalModule } from "@/lib/database.types";
import { classifyLeadsForDelete } from "@/lib/sales/delete-leads";
import { bestPartnerMatch, cleanPartnerInput, partnerFillPatch, partnerMatchReason, partnerNameKey } from "@/lib/sales/partner-match";

const OWNER = "00000000-0000-4000-8000-0000000000aa";
const PARTNER = "00000000-0000-4000-8000-0000000000a1";
const TASK = "00000000-0000-4000-8000-0000000000b1";
const COMPANY = "00000000-0000-4000-8000-0000000000c1";

type Row = Record<string, unknown>;
type Write = { table: string; op: "insert" | "delete" | "update"; values?: unknown };

/** A fake secret key client: from() answers with fixed rows, writes and rpc() are recorded. */
function fakeDb(tables: Record<string, Row[]>, rpcResults: Record<string, { data: unknown; error: unknown }> = {}) {
  const rpcCalls: { fn: string; args: Row }[] = [];
  const writes: Write[] = [];
  const db = {
    from(table: string) {
      const rows = tables[table] ?? [];
      const result = { data: rows, error: null };
      const builder: Record<string, unknown> = {};
      for (const op of ["select", "eq", "in", "neq", "is", "not", "order", "limit", "or", "ilike", "range", "gte", "lte"]) builder[op] = () => builder;
      for (const op of ["insert", "delete", "update"] as const) {
        builder[op] = (values?: unknown) => {
          writes.push({ table, op, values });
          return builder;
        };
      }
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
  return { db: db as unknown as McpDb, rpcCalls, writes };
}

async function call(db: McpDb, name: string, args: Row, options: { access?: "read" | "write"; modules?: PortalModule[]; role?: "admin" | "member" } = {}) {
  const ctx: McpTokenContext = {
    tokenId: "00000000-0000-4000-8000-000000000001",
    tokenName: "Test",
    userId: OWNER,
    access: options.access ?? "write",
    name: "Julius",
    email: "julius@nordavo.nl",
    role: options.role ?? "admin",
    modules: options.modules,
  };
  const server = createNordavoMcpServer(ctx, db, "https://portal.nordavo.nl");
  const client = new Client({ name: "test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const result = await client.callTool({ name, arguments: args });
    const text = (result.content as { type: string; text: string }[])[0].text;
    return { isError: Boolean(result.isError), text, json: () => JSON.parse(text) };
  } catch (error) {
    return { isError: true, text: String(error), json: () => ({}) };
  } finally {
    await client.close();
    await server.close();
  }
}

const john = {
  id: PARTNER,
  name: "John Sportel",
  company_name: "Barry",
  email: "john@barry.nl",
  phone: null,
  linkedin_url: null,
  notes: null,
  status: "active",
  owner_id: OWNER,
  last_contact_at: null,
  next_action: null,
  next_action_date: null,
  created_at: "2026-11-01T10:00:00Z",
};

// ---------------------------------------------------------------------------
// Matching and filling in (pure)
// ---------------------------------------------------------------------------

test("partner names match ignoring case, accents and spacing; e-mail and LinkedIn win over the name", () => {
  assert.equal(partnerNameKey("  Jöhn   SPORTEL "), "john sportel");
  assert.equal(partnerMatchReason(john, { name: "john  sportel" }), "name");
  assert.equal(partnerMatchReason(john, { name: "Someone", email: " John@Barry.nl " }), "email");
  assert.equal(partnerMatchReason({ ...john, linkedin_url: "https://www.linkedin.com/in/jsportel" }, { name: "x", linkedin_url: "nl.linkedin.com/in/JSportel/?trk=1" }), "linkedin");
  assert.equal(partnerMatchReason(john, { name: "Johnny Sportel" }), null);
  const other = { ...john, id: "x", name: "Other", email: null };
  assert.equal(bestPartnerMatch([other, john], { name: "other", email: "john@barry.nl" })?.partner.id, PARTNER);
});

test("a second add fills only empty fields and never overwrites", () => {
  const { patch, skipped } = partnerFillPatch(john, { name: "John Sportel", company: "Other BV", email: "john@barry.nl", phone: "06 12345678", notes: "Tip van Mark" }, "2026-11-17");
  assert.deepEqual(Object.keys(patch).sort(), ["notes", "phone"]);
  assert.equal(patch.phone, cleanPartnerInput({ name: "x", phone: "06 12345678" }).phone);
  assert.deepEqual(skipped, ["company_name"]);
  const again = partnerFillPatch({ ...john, notes: "Tip van Mark" }, { name: "John Sportel", notes: "Tip van Mark" }, "2026-11-17");
  assert.deepEqual(again.patch, {});
  const appended = partnerFillPatch({ ...john, notes: "Eerste" }, { name: "John Sportel", notes: "Tweede" }, "2026-11-17");
  assert.equal(appended.patch.notes, "Eerste\n\n2026-11-17: Tweede");
});

// ---------------------------------------------------------------------------
// Partner tools
// ---------------------------------------------------------------------------

test("every partner tool is gated by the sales module", () => {
  for (const tool of PARTNER_WRITE_TOOLS) assert.equal(GATED_TOOLS[tool]?.module, "sales", tool);
  for (const tool of PARTNER_WRITE_TOOLS) assert.equal(toolAllowed(tool, { sales: "read" }), false, tool);
  for (const tool of PARTNER_WRITE_TOOLS) assert.equal(toolAllowed(tool, { sales: "write" }), true, tool);
  assert.equal(GATED_TOOLS.delete_task?.module, "work");
});

test("partner tools are not offered without the sales module or on a read token", async () => {
  for (const options of [{ role: "member" as const, modules: ["recruitment" as PortalModule] }]) {
    const { db } = fakeDb({});
    const result = await call(db, "list_partners", {}, options);
    assert.equal(result.isError, true);
  }
  const { db } = fakeDb({ partners: [john] });
  const readOnly = await call(db, "add_partner", { name: "X" }, { access: "read" });
  assert.equal(readOnly.isError, true);
  const list = await call(db, "list_partners", {}, { access: "read" });
  assert.equal(list.isError, false, list.text);
  assert.ok(PARTNER_READ_TOOLS.includes("get_partner"));
});

test("add_partner creates a partner through sales_partner_save as the token owner with source claude", async () => {
  const { db, rpcCalls } = fakeDb({ partners: [] }, { sales_partner_save: { data: PARTNER, error: null } });
  const result = await call(db, "add_partner", { name: " Jane Doe ", company: "Acme", email: "Jane@Acme.NL", linkedin_url: "linkedin.com/in/jane" });
  assert.equal(result.isError, false, result.text);
  const saved = rpcCalls.find((c) => c.fn === "sales_partner_save");
  assert.ok(saved);
  assert.equal(saved.args.p_id, null);
  assert.equal(saved.args.p_source, "claude");
  assert.equal(saved.args.p_actor, OWNER);
  assert.deepEqual(saved.args.p_fields, { name: "Jane Doe", status: "active", company_name: "Acme", email: "jane@acme.nl", linkedin_url: "https://www.linkedin.com/in/jane" });
  const body = result.json();
  assert.equal(body.created, true);
  assert.equal(body.url, `https://portal.nordavo.nl/dashboard/partners/${PARTNER}`);
});

test("add_partner twice with the same data does not make a second partner", async () => {
  const { db, rpcCalls } = fakeDb({ partners: [john] });
  const result = await call(db, "add_partner", { name: "john sportel", company: "Barry", email: "john@barry.nl" });
  assert.equal(result.isError, false, result.text);
  const body = result.json();
  assert.equal(body.created, false);
  assert.equal(body.duplicate_of.id, PARTNER);
  assert.equal(body.duplicate_of.matched_on, "email");
  assert.deepEqual(body.filled, []);
  assert.equal(rpcCalls.length, 0, "nothing is written when there is nothing new");
});

test("add_partner fills a known partner in without touching name, status or owner", async () => {
  const { db, rpcCalls } = fakeDb({ partners: [john] }, { sales_partner_save: { data: PARTNER, error: null } });
  const result = await call(db, "add_partner", { name: "John Sportel", phone: "0612345678", company: "Barry BV", status: "inactive" });
  assert.equal(result.isError, false, result.text);
  const saved = rpcCalls.filter((c) => c.fn === "sales_partner_save");
  assert.equal(saved.length, 1);
  assert.equal(saved[0].args.p_id, PARTNER);
  assert.deepEqual(Object.keys(saved[0].args.p_fields as object), ["phone"]);
  const body = result.json();
  assert.equal(body.created, false);
  assert.deepEqual(body.not_overwritten, ["company_name"]);
});

test("list_partners and get_partner give the counts, contact moments and leads", async () => {
  const tables = {
    partners: [john],
    companies: [
      { id: COMPANY, name: "Acme", domain: "acme.nl", partner_id: PARTNER, pipeline_stage: "interested", lead_status: "ready" },
      { id: "c2", name: "Beta", domain: "beta.nl", partner_id: PARTNER, pipeline_stage: "won", lead_status: "ready" },
      { id: "c3", name: "Gamma", domain: "gamma.nl", partner_id: PARTNER, pipeline_stage: null, lead_status: "new" },
    ],
    profiles: [{ id: OWNER, full_name: "Julius", email: "julius@nordavo.nl" }],
    activities: [{ id: "a1", date: "2026-11-10T10:00:00Z", channel: "bellen", type: "contact", direction: "outbound", outcome: null, notes: "Gebeld", source: "claude" }],
    work_task_links: [{ task_id: TASK, task: { id: TASK, title: "Bel John", external_source: null, external_id: null } }],
  };
  const { db } = fakeDb(tables);
  const list = await call(db, "list_partners", { status: "active", owner_id: "me" });
  assert.equal(list.isError, false, list.text);
  const [row] = list.json().partners;
  assert.equal(row.leads, 3);
  assert.equal(row.in_pipeline, 1);
  assert.equal(row.won, 1);
  assert.equal(row.owner.name, "Julius");

  const get = await call(db, "get_partner", { id: PARTNER });
  assert.equal(get.isError, false, get.text);
  const body = get.json();
  assert.equal(body.name, "John Sportel");
  assert.equal(body.leads.length, 3);
  assert.equal(body.contact_moments[0].notes, "Gebeld");
  assert.equal(body.tasks[0].title, "Bel John");
});

test("search finds partners by name, company and e-mail", async () => {
  const { db } = fakeDb({ partners: [john] });
  const result = await call(db, "search", { query: "sportel", types: ["partner"] });
  assert.equal(result.isError, false, result.text);
  assert.equal(result.json().partner[0].name, "John Sportel");
  assert.equal(result.json().partner[0].url, `https://portal.nordavo.nl/dashboard/partners/${PARTNER}`);
});

test("update_partner changes the fields through sales_partner_save and says what changed", async () => {
  const { db, rpcCalls } = fakeDb({ partners: [{ ...john, status: "inactive" }], profiles: [{ id: OWNER, role: "admin" }] }, { sales_partner_save: { data: PARTNER, error: null } });
  const result = await call(db, "update_partner", { id: PARTNER, status: "inactive", company: null, email: " Jan@X.nl " });
  assert.equal(result.isError, false, result.text);
  const saved = rpcCalls.find((c) => c.fn === "sales_partner_save");
  assert.deepEqual(saved?.args.p_fields, { company_name: null, email: "jan@x.nl", status: "inactive" });
  assert.equal(saved?.args.p_source, "claude");
  assert.deepEqual(result.json().changed, ["company_name", "email", "status"]);

  const empty = await call(db, "update_partner", { id: PARTNER });
  assert.equal(empty.isError, true);
});

test("log_partner_contact logs through sales_log_activity with the partner and source claude", async () => {
  const { db, rpcCalls } = fakeDb({ partners: [john] }, { sales_log_activity: { data: "act1", error: null } });
  const result = await call(db, "log_partner_contact", { partner_id: PARTNER, channel: "bellen", notes: "Gebeld over de lead", direction: "outbound" });
  assert.equal(result.isError, false, result.text);
  const logged = rpcCalls.find((c) => c.fn === "sales_log_activity");
  assert.equal(logged?.args.p_partner, PARTNER);
  assert.equal(logged?.args.p_company, null);
  assert.equal(logged?.args.p_source, "claude");
  assert.equal(logged?.args.p_actor, OWNER);
  assert.equal(logged?.args.p_type, "contact");

  const future = await call(db, "log_partner_contact", { partner_id: PARTNER, channel: "mail", notes: "x", date: "2999-01-01" });
  assert.equal(future.isError, true);
  const missing = await call(fakeDb({ partners: [] }).db, "log_partner_contact", { partner_id: PARTNER, channel: "mail", notes: "x" });
  assert.match(missing.text, /not found/);
});

// ---------------------------------------------------------------------------
// Tasks on partners
// ---------------------------------------------------------------------------

const taskRow = {
  id: TASK,
  title: "Bel John van Barry",
  description: null,
  status: "todo",
  priority: "normal",
  due_at: null,
  project_id: "00000000-0000-4000-8000-0000000000b2",
  workspace_id: "00000000-0000-4000-8000-0000000000b3",
  reviewer_id: OWNER,
  completed_at: null,
};

test("create_task links to a partner: one task, no lead or company", async () => {
  const { db, rpcCalls, writes } = fakeDb(
    {
      partners: [john],
      work_tasks: [taskRow],
      work_task_links: [{ task_id: TASK, entity_type: "partner", entity_id: PARTNER }],
      work_task_assignees: [{ task_id: TASK, user_id: OWNER }],
      profiles: [{ id: OWNER, full_name: "Julius", email: "julius@nordavo.nl" }],
      work_projects: [{ id: taskRow.project_id, name: "Portal records" }],
    },
    { work_create_record_task: { data: TASK, error: null } },
  );
  const result = await call(db, "create_task", { title: "Bel John van Barry", entity_type: "partner", entity_id: PARTNER });
  assert.equal(result.isError, false, result.text);
  const created = rpcCalls.filter((c) => c.fn === "work_create_record_task");
  assert.equal(created.length, 1);
  assert.equal(created[0].args.p_entity_type, "partner");
  assert.equal(created[0].args.p_entity_id, PARTNER);
  assert.equal(created[0].args.p_actor, OWNER);
  assert.equal(rpcCalls.some((c) => c.fn.startsWith("sales_")), false, "no lead or company is made");
  assert.equal(writes.filter((w) => w.table === "companies" || w.table === "contacts").length, 0);
  const body = result.json();
  assert.equal(body.created.linked.type, "partner");
  assert.equal(body.created.linked.label, "John Sportel (Barry)");
  assert.equal(body.created.linked.url, `https://portal.nordavo.nl/dashboard/partners/${PARTNER}`);

  const unknown = await call(fakeDb({ partners: [] }).db, "create_task", { title: "x", entity_type: "partner", entity_id: PARTNER });
  assert.equal(unknown.isError, true);
  assert.match(unknown.text, /does not exist/);
});

test("update_task links, changes and removes the linked record through work_set_task_link", async () => {
  const rpc = { work_api_can_view_task: { data: true, error: null }, work_set_task_link: { data: null, error: null } };
  const { db, rpcCalls } = fakeDb({ partners: [john], work_tasks: [taskRow] }, rpc);
  const linked = await call(db, "update_task", { id: TASK, entity_type: "partner", entity_id: PARTNER });
  assert.equal(linked.isError, false, linked.text);
  assert.deepEqual(rpcCalls.find((c) => c.fn === "work_set_task_link")?.args, { p_task: TASK, p_entity_type: "partner", p_entity_id: PARTNER, p_actor: OWNER });

  const removed = fakeDb({ work_tasks: [taskRow] }, rpc);
  const unlink = await call(removed.db, "update_task", { id: TASK, entity_type: null, entity_id: null });
  assert.equal(unlink.isError, false, unlink.text);
  assert.deepEqual(removed.rpcCalls.find((c) => c.fn === "work_set_task_link")?.args, { p_task: TASK, p_entity_type: null, p_entity_id: null, p_actor: OWNER });

  const half = await call(fakeDb({ work_tasks: [taskRow] }, rpc).db, "update_task", { id: TASK, entity_type: "partner" });
  assert.equal(half.isError, true);
  assert.match(half.text, /together/);

  const noModule = fakeDb({ partners: [john], work_tasks: [taskRow] }, { ...rpc, work_set_task_link: { data: null, error: { message: "You cannot link tasks to this kind of record" } } });
  const refused = await call(noModule.db, "update_task", { id: TASK, entity_type: "partner", entity_id: PARTNER });
  assert.equal(refused.isError, true);
  assert.match(refused.text, /cannot link/);
});

test("list_tasks filters on a partner", async () => {
  const { db, rpcCalls } = fakeDb({}, { work_api_record_tasks: { data: [], error: null } });
  const result = await call(db, "list_tasks", { entity_type: "partner", entity_id: PARTNER, status: "all" });
  assert.equal(result.isError, false, result.text);
  const filtered = rpcCalls.find((c) => c.fn === "work_api_record_tasks");
  assert.equal(filtered?.args.p_entity_type, "partner");
  assert.equal(filtered?.args.p_entity_id, PARTNER);
});

test("a task of a module the owner lacks cannot be linked from the MCP", async () => {
  // Recruitment-only member: partners belong to Sales, so the scoped db refuses the record check.
  const { db } = fakeDb({ partners: [john] });
  const result = await call(db, "create_task", { title: "x", entity_type: "partner", entity_id: PARTNER }, { role: "member", modules: ["recruitment"] });
  assert.equal(result.isError, true);
});

// ---------------------------------------------------------------------------
// Repairing mistakes
// ---------------------------------------------------------------------------

test("a task can be cancelled through update_task_status", async () => {
  const { db, rpcCalls } = fakeDb({ work_tasks: [{ ...taskRow, status: "cancelled" }] }, { work_api_can_view_task: { data: true, error: null } });
  const result = await call(db, "update_task_status", { id: TASK, status: "cancelled" });
  assert.equal(result.isError, false, result.text);
  assert.deepEqual(rpcCalls.find((c) => c.fn === "work_set_status")?.args, { p_task: TASK, p_status: "cancelled", p_comment: null, p_actor: OWNER });
});

test("delete_task moves the task to the trash as the token owner", async () => {
  const { db, rpcCalls } = fakeDb({ work_tasks: [taskRow] }, { work_api_can_view_task: { data: true, error: null } });
  const result = await call(db, "delete_task", { id: TASK });
  assert.equal(result.isError, false, result.text);
  assert.deepEqual(rpcCalls.find((c) => c.fn === "work_archive_task")?.args, { p_task: TASK, p_actor: OWNER });
  assert.equal(result.json().in_trash, true);

  const refused = fakeDb({}, { work_api_can_view_task: { data: true, error: null }, work_archive_task: { data: null, error: { message: "Only admins, or the member who made it, can archive this task" } } });
  const denied = await call(refused.db, "delete_task", { id: TASK });
  assert.equal(denied.isError, true);
  assert.match(denied.text, /Only admins/);
  const hidden = await call(fakeDb({}, { work_api_can_view_task: { data: false, error: null } }).db, "delete_task", { id: TASK });
  assert.match(hidden.text, /not found/);
  const readOnly = await call(fakeDb({}).db, "delete_task", { id: TASK }, { access: "read" });
  assert.equal(readOnly.isError, true);
});

test("delete_company deletes a lead made by mistake and logs it with source claude", async () => {
  const { db, writes } = fakeDb({ companies: [{ id: COMPANY, name: "Testlead", pipeline_stage: null, client_id: null }], activities: [], meetings: [] });
  const result = await call(db, "delete_company", { id: COMPANY, reason: "testlead" });
  assert.equal(result.isError, false, result.text);
  assert.ok(writes.some((w) => w.table === "companies" && w.op === "delete"));
  const log = writes.find((w) => w.table === "activity_log")?.values as Row;
  assert.equal(log.entity_type, "company");
  assert.equal(log.action, "deleted");
  assert.equal(log.actor_id, OWNER);
  assert.deepEqual(log.changes, { source: "claude", name: "Testlead", reason: "testlead" });
});

test("delete_company keeps a lead that is in the pipeline, approached or linked to a client", async () => {
  for (const [row, extra, reason] of [
    [{ pipeline_stage: "interested", client_id: null }, {}, /In the pipeline/],
    [{ pipeline_stage: null, client_id: "cl1" }, {}, /Linked to a client/],
    [{ pipeline_stage: null, client_id: null }, { activities: [{ company_id: COMPANY }] }, /Already approached/],
    [{ pipeline_stage: null, client_id: null }, { meetings: [{ company_id: COMPANY }] }, /Already approached/],
  ] as [Row, Record<string, Row[]>, RegExp][]) {
    const { db, writes } = fakeDb({ companies: [{ id: COMPANY, name: "Acme", ...row }], activities: [], meetings: [], ...extra });
    const result = await call(db, "delete_company", { id: COMPANY });
    assert.equal(result.isError, true);
    assert.match(result.text, reason);
    assert.match(result.text, /archive_company/);
    assert.equal(writes.length, 0);
  }
  const missing = await call(fakeDb({ companies: [] }).db, "delete_company", { id: COMPANY });
  assert.match(missing.text, /not found/);
});

test("archive_company sets No go through sales_update with source claude", async () => {
  const { db, rpcCalls } = fakeDb({ companies: [{ id: COMPANY, name: "Acme", pipeline_stage: null, lead_status: "new" }] }, { sales_update: { data: 1, error: null } });
  const result = await call(db, "archive_company", { id: COMPANY });
  assert.equal(result.isError, false, result.text);
  assert.deepEqual(rpcCalls.find((c) => c.fn === "sales_update")?.args, { p_entity: "company", p_ids: [COMPANY], p_fields: { lead_status: "no_go" }, p_source: "claude", p_actor: OWNER });

  const inPipeline = await call(fakeDb({ companies: [{ id: COMPANY, name: "Acme", pipeline_stage: "interested", lead_status: "ready" }] }).db, "archive_company", { id: COMPANY });
  assert.equal(inPipeline.isError, true);
  assert.match(inPipeline.text, /lost/);
});

test("the portal and the MCP share one set of safety checks for deleting leads", async () => {
  const { db } = fakeDb({
    companies: [
      { id: "a", name: "Fine", pipeline_stage: null, client_id: null },
      { id: "b", name: "Piped", pipeline_stage: "contact", client_id: null },
    ],
    activities: [],
    meetings: [],
  });
  const result = await classifyLeadsForDelete(db as never, ["a", "b", "c"]);
  assert.ok(result.ok);
  if (result.ok) {
    assert.deepEqual(result.deletable.map((d) => d.id), ["a"]);
    assert.deepEqual(result.kept.map((k) => k.id), ["b"]);
    assert.deepEqual(result.missing, ["c"]);
  }
});

// ---------------------------------------------------------------------------
// The migration
// ---------------------------------------------------------------------------

test("the partner migration is idempotent and keeps contact data out of the log", () => {
  const sql = readFileSync("supabase/migrations/20261125200000_mcp_partners.sql", "utf8");
  assert.match(sql, /create or replace function public\.sales_partner_save/);
  assert.doesNotMatch(sql, /drop table|drop column|truncate|delete from/i);
  assert.match(sql, /v_quiet text\[\] := array\['email', 'phone', 'linkedin_url', 'notes'\]/);
  assert.match(sql, /public\.sales_actor\(p_actor, p_source\)/);
});
