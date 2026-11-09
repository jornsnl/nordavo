/*
 * A small stand-in for Supabase (Auth and PostgREST) for the browser tests.
 * It is not a database: it keeps a handful of tables in memory and answers
 * the queries and work_* functions the Work pages use, so a production build
 * can be signed in to, rendered on a phone and taken offline without a real
 * project. Unknown tables answer with no rows and unknown functions with null,
 * so the other pages render their empty states.
 *
 *   node tests/e2e/support/fake-supabase.mjs   (port FAKE_SUPABASE_PORT, default 54321)
 *
 * Point the app at it with NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321.
 * GET /__state returns the tables, so a test can check what reached "the server";
 * POST /__patch changes a row behind the app's back (someone else, elsewhere).
 */
import { createServer } from "node:http";
import { createHmac, randomUUID } from "node:crypto";

const PORT = Number(process.env.FAKE_SUPABASE_PORT ?? 54321);
const SECRET = "fake-supabase-jwt-secret";
export const E2E_EMAIL = "e2e@nordavo.test";
export const E2E_PASSWORD = "offline-first";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const now = () => new Date().toISOString();
const daysFromNow = (n) => new Date(Date.now() + n * 86_400_000).toISOString();

function seed() {
  const task = (id, title, status, priority, due) => ({
    id,
    title,
    description: null,
    status,
    priority,
    due_at: due,
    parent_id: null,
    is_log: false,
    reviewer_id: USER_ID,
    created_by: USER_ID,
    updated_at: now(),
    created_at: now(),
    completed_at: status === "done" ? now() : null,
    review_requested_at: null,
    archived_at: null,
    position: 1,
    project_id: PROJECT_ID,
    workspace_id: WORKSPACE_ID,
  });
  const tasks = [
    task("44444444-4444-4444-8444-000000000001", "Call back Bright Fintech about the backend role", "todo", "high", daysFromNow(0)),
    task("44444444-4444-4444-8444-000000000002", "Shortlist three React developers for Lumen", "in_progress", "urgent", daysFromNow(1)),
    task("44444444-4444-4444-8444-000000000003", "Prepare the check-in with Arjun after 30 days", "todo", "normal", daysFromNow(4)),
    task("44444444-4444-4444-8444-000000000004", "Update the hiring report for Q4", "review", "normal", daysFromNow(-1)),
    task("44444444-4444-4444-8444-000000000005", "Send the contract to Noord Logistics", "done", "low", null),
  ];
  return {
    profiles: [
      {
        id: USER_ID,
        full_name: "Eva de Tester",
        email: E2E_EMAIL,
        role: "admin",
        client_id: null,
        time_zone: "Europe/Amsterdam",
        modules: null,
      },
    ],
    work_workspaces: [{ id: WORKSPACE_ID, name: "Nordavo", slug: "nordavo", created_at: now() }],
    work_members: [{ workspace_id: WORKSPACE_ID, user_id: USER_ID, role: "admin", deactivated_at: null, created_at: now() }],
    work_projects: [
      {
        id: PROJECT_ID,
        workspace_id: WORKSPACE_ID,
        name: "Recruitment",
        description: null,
        visibility: "open",
        archived_at: null,
        created_at: now(),
        created_by: USER_ID,
      },
    ],
    work_project_members: [{ project_id: PROJECT_ID, user_id: USER_ID, access_expires_at: null, created_at: now() }],
    work_tasks: tasks,
    work_task_assignees: tasks.map((t) => ({ task_id: t.id, user_id: USER_ID, assigned_by: USER_ID, created_at: now() })),
    work_task_links: [],
    work_comments: [],
    work_attachments: [],
    work_task_activity: [],
  };
}

let db = seed();

// Foreign keys, so embeds like project:work_projects(id, name) resolve.
const relations = [
  { table: "work_tasks", column: "project_id", ref: "work_projects", name: "work_tasks_project_id_workspace_id_fkey" },
  { table: "work_tasks", column: "workspace_id", ref: "work_workspaces", name: "work_tasks_workspace_id_fkey" },
  { table: "work_tasks", column: "parent_id", ref: "work_tasks", name: "work_tasks_parent_id_fkey" },
  { table: "work_task_assignees", column: "task_id", ref: "work_tasks", name: "work_task_assignees_task_id_fkey" },
  { table: "work_task_assignees", column: "user_id", ref: "profiles", name: "work_task_assignees_user_id_fkey" },
  { table: "work_projects", column: "workspace_id", ref: "work_workspaces", name: "work_projects_workspace_id_fkey" },
  { table: "work_members", column: "workspace_id", ref: "work_workspaces", name: "work_members_workspace_id_fkey" },
  { table: "work_members", column: "user_id", ref: "profiles", name: "work_members_user_id_fkey" },
  { table: "work_project_members", column: "project_id", ref: "work_projects", name: "work_project_members_project_id_fkey" },
  { table: "work_comments", column: "task_id", ref: "work_tasks", name: "work_comments_task_id_fkey" },
];

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

const b64 = (value) => Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");

function jwt(sessionId) {
  const iat = Math.floor(Date.now() / 1000);
  const payload = {
    sub: USER_ID,
    email: E2E_EMAIL,
    role: "authenticated",
    aud: "authenticated",
    aal: "aal1",
    amr: [{ method: "password", timestamp: iat }],
    session_id: sessionId,
    app_metadata: { provider: "email", portal_role: "admin" },
    user_metadata: {},
    iat,
    exp: iat + 3600,
  };
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64(payload);
  const sig = createHmac("sha256", SECRET).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

function verify(token) {
  const [head, body, sig] = String(token ?? "").split(".");
  if (!head || !body || !sig) return null;
  const expected = createHmac("sha256", SECRET).update(`${head}.${body}`).digest("base64url");
  if (expected !== sig) return null;
  const payload = JSON.parse(Buffer.from(body, "base64url").toString());
  return payload.exp * 1000 > Date.now() ? payload : null;
}

const authUser = () => ({
  id: USER_ID,
  aud: "authenticated",
  role: "authenticated",
  email: E2E_EMAIL,
  email_confirmed_at: now(),
  app_metadata: { provider: "email", portal_role: "admin" },
  user_metadata: {},
  factors: [],
  identities: [],
  created_at: now(),
  updated_at: now(),
});

function session() {
  const id = randomUUID();
  return {
    access_token: jwt(id),
    refresh_token: `refresh-${id}`,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: authUser(),
  };
}

function handleAuth(req, url, body, send) {
  const path = url.pathname.replace(/^\/auth\/v1/, "");
  if (path === "/token") {
    const grant = url.searchParams.get("grant_type");
    if (grant === "password") {
      if (body?.email !== E2E_EMAIL || body?.password !== E2E_PASSWORD) {
        return send(400, { code: "invalid_credentials", error_code: "invalid_credentials", msg: "Invalid login credentials" });
      }
      return send(200, session());
    }
    if (grant === "refresh_token") return send(200, session());
  }
  if (path === "/user") {
    const token = (req.headers.authorization ?? "").replace(/^Bearer /i, "");
    if (!verify(token)) return send(401, { code: "bad_jwt", error_code: "bad_jwt", msg: "invalid JWT" });
    return send(200, authUser());
  }
  if (path === "/logout") return send(204, null);
  if (path === "/factors") return send(200, []);
  return send(404, { msg: `fake auth: ${path} is not implemented` });
}

// ---------------------------------------------------------------------------
// PostgREST
// ---------------------------------------------------------------------------

function splitTop(text, sep = ",") {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const ch of text) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === sep && depth === 0) {
      parts.push(current);
      current = "";
    } else current += ch;
  }
  if (current.trim()) parts.push(current);
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** select=a, b, alias:rel!hint!inner(c, d) into a tree. */
function parseSelect(text) {
  return splitTop(text.replace(/\s+/g, " ")).map((item) => {
    const open = item.indexOf("(");
    let head = open === -1 ? item : item.slice(0, open);
    const inner = open === -1 ? null : item.slice(open + 1, item.lastIndexOf(")"));
    head = head.split("::")[0].trim();
    let alias = null;
    if (head.includes(":")) [alias, head] = head.split(":").map((s) => s.trim());
    const [name, ...hints] = head.split("!");
    const isInner = hints.includes("inner");
    const hint = hints.find((h) => h !== "inner" && h !== "left") ?? null;
    return inner === null
      ? { kind: "column", name, alias: alias ?? name }
      : { kind: "embed", name, hint, alias: alias ?? name, inner: isInner, children: parseSelect(inner) };
  });
}

function resolveRelation(table, name, hint) {
  const asColumn = relations.find((r) => r.table === table && r.column === name);
  if (asColumn) return { many: false, ref: asColumn.ref, local: asColumn.column, remote: "id" };
  const candidates = relations.filter(
    (r) =>
      ((r.table === table && r.ref === name) || (r.table === name && r.ref === table)) &&
      (!hint || r.name === hint || r.column === hint),
  );
  // A self reference with a column hint (work_tasks!parent_id) means the children.
  const rel = candidates.find((r) => r.table === name && r.ref === table && (name !== table || hint)) ?? candidates[0];
  if (!rel) return null;
  if (rel.table === table && rel.ref === name && name !== table) return { many: false, ref: name, local: rel.column, remote: "id" };
  return { many: true, ref: name, local: "id", remote: rel.column };
}

function parseValue(raw) {
  if (raw === "null") return null;
  if (raw === "true") return true;
  if (raw === "false") return false;
  return raw.replace(/^"(.*)"$/, "$1");
}

function matchOp(value, op, raw) {
  switch (op) {
    case "eq":
      return String(value) === String(parseValue(raw));
    case "neq":
      return String(value) !== String(parseValue(raw));
    case "is":
      return parseValue(raw) === null ? value === null || value === undefined : value === parseValue(raw);
    case "in": {
      const list = splitTop(raw.replace(/^\(|\)$/g, "")).map(parseValue);
      return list.map(String).includes(String(value));
    }
    case "gt":
      return value !== null && String(value) > raw;
    case "gte":
      return value !== null && String(value) >= raw;
    case "lt":
      return value !== null && String(value) < raw;
    case "lte":
      return value !== null && String(value) <= raw;
    case "ilike":
    case "like": {
      const pattern = new RegExp(`^${raw.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/[*%]/g, ".*")}$`, op === "ilike" ? "i" : "");
      return pattern.test(String(value ?? ""));
    }
    case "cs":
      return Array.isArray(value) && splitTop(raw.replace(/^\{|\}$/g, "")).every((v) => value.includes(parseValue(v)));
    default:
      return true;
  }
}

function test(row, expr) {
  // expr: "op.value" or "not.op.value"
  let negate = false;
  let rest = expr;
  if (rest.startsWith("not.")) {
    negate = true;
    rest = rest.slice(4);
  }
  const dot = rest.indexOf(".");
  const op = rest.slice(0, dot);
  const raw = rest.slice(dot + 1);
  return negate !== matchOp(row, op, raw);
}

function orMatch(row, text) {
  return splitTop(text.replace(/^\(|\)$/g, "")).some((part) => {
    const [col, ...rest] = part.split(".");
    return test(row[col], rest.join("."));
  });
}

const RESERVED = new Set(["select", "order", "limit", "offset", "on_conflict", "columns"]);

function filtersFrom(params) {
  const top = [];
  const nested = {};
  for (const [key, value] of params) {
    if (RESERVED.has(key)) continue;
    if (key === "or") {
      top.push({ or: value });
      continue;
    }
    if (key.includes(".")) {
      const [path, col] = [key.slice(0, key.lastIndexOf(".")), key.slice(key.lastIndexOf(".") + 1)];
      (nested[path] ??= []).push({ col, expr: value });
    } else top.push({ col: key, expr: value });
  }
  return { top, nested };
}

function applyFilters(rows, filters) {
  return rows.filter((row) => filters.every((f) => (f.or ? orMatch(row, f.or) : test(row[f.col], f.expr))));
}

function shape(table, row, nodes, nested, path = "") {
  const out = {};
  for (const node of nodes) {
    if (node.kind === "column") {
      if (node.name === "*") Object.assign(out, row);
      else out[node.alias] = row[node.name] ?? null;
      continue;
    }
    const rel = resolveRelation(table, node.name, node.hint);
    const key = path ? `${path}.${node.alias}` : node.alias;
    if (!rel) {
      out[node.alias] = null;
      continue;
    }
    let related = (db[rel.ref] ?? []).filter((r) => String(r[rel.remote]) === String(row[rel.local]));
    related = applyFilters(related, (nested[key] ?? []).map((f) => ({ col: f.col, expr: f.expr })));
    const shaped = related.map((r) => shape(rel.ref, r, node.children, nested, key));
    out[node.alias] = rel.many ? shaped : (shaped[0] ?? null);
    if (node.inner && (rel.many ? shaped.length === 0 : !shaped[0])) return null;
  }
  return out;
}

function sortRows(rows, order) {
  if (!order) return rows;
  const keys = order.split(",").map((part) => {
    const [col, dir = "asc", nulls] = part.split(".");
    return { col, desc: dir === "desc", nullsFirst: nulls === "nullsfirst" };
  });
  return [...rows].sort((a, b) => {
    for (const { col, desc, nullsFirst } of keys) {
      const x = a[col];
      const y = b[col];
      if (x === y) continue;
      if (x === null || x === undefined) return nullsFirst ? -1 : 1;
      if (y === null || y === undefined) return nullsFirst ? 1 : -1;
      const cmp = typeof x === "number" ? x - y : String(x).localeCompare(String(y));
      if (cmp !== 0) return desc ? -cmp : cmp;
    }
    return 0;
  });
}

function select(table, params) {
  const { top, nested } = filtersFrom(params);
  let rows = applyFilters(db[table] ?? [], top);
  rows = sortRows(rows, params.get("order"));
  const nodes = parseSelect(params.get("select") ?? "*");
  let shaped = rows.map((r) => shape(table, r, nodes, nested)).filter(Boolean);
  const total = shaped.length;
  const offset = Number(params.get("offset") ?? 0);
  const limit = params.get("limit") ? Number(params.get("limit")) : undefined;
  shaped = shaped.slice(offset, limit === undefined ? undefined : offset + limit);
  return { rows: shaped, total };
}

// ---------------------------------------------------------------------------
// The work_* functions the pages call, with the rules that matter offline.
// ---------------------------------------------------------------------------

class DbError extends Error {
  constructor(message, code = "P0001") {
    super(message);
    this.code = code;
  }
}

function findTask(id) {
  const task = db.work_tasks.find((t) => t.id === id && !t.archived_at);
  if (!task) throw new DbError("Task not found", "P0002");
  return task;
}

const rpcs = {
  work_create_task(args) {
    const project = db.work_projects.find((p) => p.id === args.p_project);
    if (!project) throw new DbError("Project not found", "P0002");
    const title = String(args.p_title ?? "").trim();
    if (!title) throw new DbError("A task needs a title");
    // Idempotent with an id chosen by the device.
    if (args.p_id) {
      const existing = db.work_tasks.find((t) => t.id === args.p_id);
      if (existing) return existing.id;
    }
    const id = args.p_id ?? randomUUID();
    const status = args.p_status ?? "todo";
    db.work_tasks.push({
      id,
      title,
      description: args.p_description ?? null,
      status,
      priority: args.p_priority ?? "normal",
      due_at: args.p_due_at ?? null,
      parent_id: args.p_parent ?? null,
      is_log: Boolean(args.p_is_log),
      reviewer_id: args.p_reviewer ?? USER_ID,
      created_by: USER_ID,
      created_at: now(),
      updated_at: now(),
      completed_at: status === "done" ? now() : null,
      review_requested_at: null,
      archived_at: null,
      position: Date.now() / 1000,
      project_id: project.id,
      workspace_id: project.workspace_id,
    });
    for (const user of args.p_assignees ?? []) {
      db.work_task_assignees.push({ task_id: id, user_id: user, assigned_by: USER_ID, created_at: now() });
    }
    return id;
  },
  work_update_task(args) {
    const task = findTask(args.p_task);
    const fields = args.p_fields ?? {};
    if ("title" in fields && !String(fields.title ?? "").trim()) throw new DbError("A task needs a title");
    for (const key of ["title", "description", "priority", "due_at", "reviewer_id"]) {
      if (key in fields) task[key] = fields[key] === "" ? null : fields[key];
    }
    task.updated_at = now();
    return null;
  },
  work_set_status(args) {
    const task = findTask(args.p_task);
    if (!["todo", "in_progress", "review", "done", "cancelled"].includes(args.p_status)) throw new DbError("Unknown status");
    if (task.status === args.p_status) return null;
    const goingBack = ["review", "done"].includes(task.status) && ["todo", "in_progress"].includes(args.p_status);
    if (goingBack && !String(args.p_comment ?? "").trim()) {
      throw new DbError("Add a comment that says what still needs to happen");
    }
    task.status = args.p_status;
    task.completed_at = args.p_status === "done" ? (args.p_at ?? now()) : null;
    task.updated_at = now();
    return null;
  },
  work_set_assignees(args) {
    findTask(args.p_task);
    db.work_task_assignees = db.work_task_assignees.filter((a) => a.task_id !== args.p_task);
    for (const user of args.p_users ?? []) db.work_task_assignees.push({ task_id: args.p_task, user_id: user, created_at: now() });
    return null;
  },
  work_search(args) {
    const q = String(args.p_query ?? "").toLowerCase();
    return db.work_tasks.filter((t) => t.title.toLowerCase().includes(q)).map((t) => ({ id: t.id }));
  },
};

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : null);
      } catch {
        resolve(null);
      }
    });
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const body = await readBody(req);
  const send = (status, payload, headers = {}) => {
    res.writeHead(status, {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "*",
      "access-control-expose-headers": "content-range",
      ...headers,
    });
    res.end(payload === null || status === 204 ? "" : JSON.stringify(payload));
  };

  if (req.method === "OPTIONS") return send(204, null);
  if (url.pathname === "/__state") return send(200, db);
  // A change "someone else" made on the server, e.g. { table, id, fields: { archived_at } }.
  if (url.pathname === "/__patch" && body?.table && body?.id) {
    const row = (db[body.table] ?? []).find((r) => r.id === body.id);
    if (row) Object.assign(row, body.fields ?? {});
    return send(row ? 200 : 404, row ?? { message: "not found" });
  }
  if (url.pathname === "/__reset") {
    db = seed();
    return send(200, { ok: true });
  }
  if (url.pathname.startsWith("/auth/v1")) return handleAuth(req, url, body, send);
  if (url.pathname.startsWith("/storage/v1")) return send(200, []);

  if (url.pathname.startsWith("/rest/v1/rpc/")) {
    const name = url.pathname.slice("/rest/v1/rpc/".length);
    const args = body ?? Object.fromEntries(url.searchParams);
    const fn = rpcs[name];
    if (!fn) return send(200, null);
    try {
      return send(200, fn(args) ?? null);
    } catch (error) {
      return send(400, { code: error.code ?? "P0001", message: error.message, details: null, hint: null });
    }
  }

  if (url.pathname.startsWith("/rest/v1/")) {
    const table = url.pathname.slice("/rest/v1/".length);
    const wantsObject = (req.headers.accept ?? "").includes("vnd.pgrst.object");
    const prefer = String(req.headers.prefer ?? "");
    if (req.method === "GET" || req.method === "HEAD") {
      const { rows, total } = select(table, url.searchParams);
      const range = `${rows.length ? `0-${rows.length - 1}` : "*"}/${prefer.includes("count=") ? total : "*"}`;
      if (req.method === "HEAD") return send(200, null, { "content-range": range });
      if (wantsObject) {
        if (rows.length !== 1) {
          return send(406, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned", details: `The result contains ${rows.length} rows`, hint: null });
        }
        return send(200, rows[0], { "content-range": range });
      }
      return send(200, rows, { "content-range": range });
    }
    // Writes the pages make outside the work_* functions: kept, never checked.
    const list = (db[table] ??= []);
    if (req.method === "POST") {
      const items = (Array.isArray(body) ? body : [body]).map((b) => ({ id: randomUUID(), created_at: now(), ...b }));
      list.push(...items);
      return send(201, wantsObject ? items[0] : items);
    }
    if (req.method === "PATCH" || req.method === "DELETE") {
      const { top } = filtersFrom(url.searchParams);
      const hit = applyFilters(list, top);
      if (req.method === "PATCH") for (const row of hit) Object.assign(row, body);
      else db[table] = list.filter((row) => !hit.includes(row));
      return send(200, wantsObject ? (hit[0] ?? null) : hit);
    }
  }

  return send(404, { message: `fake supabase: ${req.method} ${url.pathname}` });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`fake supabase on http://127.0.0.1:${PORT}`);
});
