import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createNordavoMcpServer } from "@/lib/mcp/server";
import type { McpDb } from "@/lib/mcp/shared";
import { amsterdamDate, searchPattern } from "@/lib/mcp/shared";
import {
  authenticateMcpToken,
  generateMcpToken,
  hashMcpToken,
  hashesEqual,
  isMcpTokenFormat,
  mcpTokenDisplayPrefix,
  parseBearerToken,
  shouldTouchLastUsed,
  type McpTokenContext,
} from "@/lib/mcp/tokens";

test("generateMcpToken makes nrd_ tokens with a sha256 hash and a 12 character prefix", () => {
  const a = generateMcpToken();
  const b = generateMcpToken();
  assert.match(a.token, /^nrd_[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a.token, b.token);
  assert.equal(a.hash, createHash("sha256").update(a.token).digest("hex"));
  assert.equal(a.hash, hashMcpToken(a.token));
  assert.match(a.hash, /^[0-9a-f]{64}$/);
  assert.equal(a.prefix, a.token.slice(0, 12));
  assert.equal(mcpTokenDisplayPrefix(a.token), a.prefix);
  assert.ok(isMcpTokenFormat(a.token));
  assert.ok(!isMcpTokenFormat(`${a.token}x`));
  assert.ok(!isMcpTokenFormat("nrd_kort"));
  assert.ok(!isMcpTokenFormat(a.token.replace("nrd_", "abc_")));
});

test("parseBearerToken reads the Authorization header", () => {
  assert.equal(parseBearerToken("Bearer nrd_abc"), "nrd_abc");
  assert.equal(parseBearerToken("bearer   nrd_abc "), "nrd_abc");
  assert.equal(parseBearerToken("Basic dXNlcjpwYXNz"), null);
  assert.equal(parseBearerToken("Bearer"), null);
  assert.equal(parseBearerToken("Bearer a b"), null);
  assert.equal(parseBearerToken(""), null);
  assert.equal(parseBearerToken(null), null);
  assert.equal(parseBearerToken(undefined), null);
});

test("hashesEqual compares digests and rejects other lengths", () => {
  const h = hashMcpToken("nrd_x");
  assert.ok(hashesEqual(h, h));
  assert.ok(!hashesEqual(h, hashMcpToken("nrd_y")));
  assert.ok(!hashesEqual(h, h.slice(0, 32)));
  assert.ok(!hashesEqual("", ""));
});

test("shouldTouchLastUsed writes at most once per five minutes", () => {
  const now = new Date("2026-10-24T12:00:00Z");
  assert.ok(shouldTouchLastUsed(null, now));
  assert.ok(!shouldTouchLastUsed("2026-10-24T11:58:00Z", now));
  assert.ok(shouldTouchLastUsed("2026-10-24T11:55:00Z", now));
});

test("searchPattern escapes wildcards and drops PostgREST syntax", () => {
  assert.equal(searchPattern("a"), null);
  assert.equal(searchPattern(undefined), null);
  assert.equal(searchPattern("50%_off"), "%50\\%\\_off%");
  assert.equal(searchPattern("acme,(id.eq.1)"), "%acme id.eq.1%");
});

test("amsterdamDate uses the Amsterdam calendar day", () => {
  assert.equal(amsterdamDate(0, new Date("2026-10-24T22:30:00Z")), "2026-10-25");
  assert.equal(amsterdamDate(7, new Date("2026-10-24T10:00:00Z")), "2026-10-31");
});

// ---------------------------------------------------------------------------
// authenticateMcpToken against a tiny fake of the admin client
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

function fakeDb(tables: Record<string, Row[]>) {
  const updates: { table: string; values: Row; id: unknown }[] = [];
  const db = {
    from(table: string) {
      const filters: [string, unknown][] = [];
      let pendingUpdate: Row | null = null;
      const builder = {
        select: () => builder,
        update: (values: Row) => {
          pendingUpdate = values;
          return builder;
        },
        eq: (column: string, value: unknown) => {
          filters.push([column, value]);
          if (pendingUpdate) {
            updates.push({ table, values: pendingUpdate, id: value });
            return Promise.resolve({ error: null });
          }
          return builder;
        },
        maybeSingle: async () => ({
          data: (tables[table] ?? []).find((row) => filters.every(([c, v]) => row[c] === v)) ?? null,
          error: null,
        }),
      };
      return builder;
    },
  };
  return { db: db as unknown as McpDb, updates };
}

function tokenRow(token: string, extra: Row = {}): Row {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    user_id: "00000000-0000-4000-8000-0000000000aa",
    name: "Laptop",
    token_hash: hashMcpToken(token),
    access: "read",
    expires_at: null,
    last_used_at: null,
    revoked_at: null,
    ...extra,
  };
}

const staffProfile = { id: "00000000-0000-4000-8000-0000000000aa", full_name: "Julius", email: "julius@nordavo.nl", role: "member" };

test("authenticateMcpToken accepts a valid token and touches last_used_at", async () => {
  const { token } = generateMcpToken();
  const { db, updates } = fakeDb({ mcp_tokens: [tokenRow(token, { access: "write" })], profiles: [staffProfile] });
  const result = await authenticateMcpToken(`Bearer ${token}`, db);
  assert.ok(result.ok);
  assert.equal(result.context.userId, staffProfile.id);
  assert.equal(result.context.access, "write");
  assert.equal(result.context.name, "Julius");
  assert.equal(updates.length, 1);
  assert.equal(updates[0].table, "mcp_tokens");
});

test("authenticateMcpToken rejects missing, unknown, revoked, expired and client tokens", async () => {
  const { token } = generateMcpToken();
  const now = new Date("2026-10-24T12:00:00Z");
  const check = async (rows: Row[], profiles: Row[], header: string | null) => {
    const { db } = fakeDb({ mcp_tokens: rows, profiles });
    const result = await authenticateMcpToken(header, db, now);
    return result.ok ? "ok" : result.reason;
  };

  assert.equal(await check([], [staffProfile], null), "missing");
  assert.equal(await check([], [staffProfile], "Bearer geen-token"), "malformed");
  assert.equal(await check([], [staffProfile], `Bearer ${token}`), "invalid");
  assert.equal(
    await check([tokenRow(token, { revoked_at: "2026-10-01T00:00:00Z" })], [staffProfile], `Bearer ${token}`),
    "revoked",
  );
  assert.equal(
    await check([tokenRow(token, { expires_at: "2026-10-24T11:59:59Z" })], [staffProfile], `Bearer ${token}`),
    "expired",
  );
  assert.equal(
    await check([tokenRow(token)], [{ ...staffProfile, role: "client" }], `Bearer ${token}`),
    "forbidden",
  );
  assert.equal(await check([tokenRow(token)], [], `Bearer ${token}`), "forbidden");
  assert.equal(
    await check([tokenRow(token, { last_used_at: "2026-10-24T11:59:00Z" })], [staffProfile], `Bearer ${token}`),
    "ok",
  );
});

// ---------------------------------------------------------------------------
// tools/list for read and write tokens, in process
// ---------------------------------------------------------------------------

async function listToolNames(access: "read" | "write") {
  const ctx: McpTokenContext = {
    tokenId: "00000000-0000-4000-8000-000000000001",
    tokenName: "Test",
    userId: staffProfile.id,
    access,
    name: "Julius",
    email: "julius@nordavo.nl",
    role: "member",
  };
  const server = createNordavoMcpServer(ctx, {} as McpDb, "https://portaal.nordavo.nl");
  const client = new Client({ name: "test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const { tools } = await client.listTools();
    const whoami = await client.callTool({ name: "whoami", arguments: {} });
    return { names: tools.map((t) => t.name).sort(), tools, whoami, instructions: client.getInstructions() };
  } finally {
    await client.close();
    await server.close();
  }
}

const READ_TOOLS = [
  "get_activity",
  "get_candidate",
  "get_client",
  "get_company",
  "get_vacancy",
  "list_candidates",
  "list_clients",
  "list_placements",
  "list_tasks",
  "list_vacancies",
  "search",
  "whoami",
];
const WRITE_TOOLS = ["add_note", "create_task", "update_task_status"];

test("a read token only gets read tools", async () => {
  const { names, tools, whoami, instructions } = await listToolNames("read");
  assert.deepEqual(names, READ_TOOLS);
  assert.ok(tools.every((t) => t.annotations?.readOnlyHint === true));
  const listClients = tools.find((t) => t.name === "list_clients");
  const limit = (listClients?.inputSchema.properties as Record<string, { maximum?: number; default?: number }>).limit;
  assert.equal(limit.maximum, 100);
  assert.equal(limit.default, 25);
  const text = (whoami.content as { type: string; text: string }[])[0].text;
  assert.equal(JSON.parse(text).access, "read");
  assert.ok(instructions?.includes("read only"));
});

test("a write token also gets the write tools", async () => {
  const { names } = await listToolNames("write");
  assert.deepEqual(names, [...READ_TOOLS, ...WRITE_TOOLS].sort());
});
