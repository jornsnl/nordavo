import { test } from "node:test";
import assert from "node:assert/strict";
import { clickUpDate, importFromClickUp, mapPriority, mapStatus, rootParent } from "@/lib/work/clickup";
import { workErrorMessage, WORK_GENERIC_ERROR } from "@/lib/work/errors";
import { mentionToken, parseMentions, plainMentions } from "@/lib/work/mentions";
import { deliverNotifications } from "@/lib/work/notify";
import {
  dayIn,
  dueState,
  formatDue,
  isValidTimeZone,
  localInputToUtc,
  safeTimeZone,
  utcToLocalInput,
} from "@/lib/work/time";
import { authenticateWorkToken, generateInviteToken, generateWorkToken, inviteTokenHash, isWorkTokenFormat, sha256 } from "@/lib/work/tokens";

// ---------------------------------------------------------------------------
// Time zones: stored in UTC, shown in the viewer's zone
// ---------------------------------------------------------------------------

test("localInputToUtc reads wall clock time in the user's zone", () => {
  // Amsterdam is UTC+1 in winter and UTC+2 in summer; Bangalore is UTC+5:30.
  assert.equal(localInputToUtc("2026-11-03T17:00", "Europe/Amsterdam"), "2026-11-03T16:00:00.000Z");
  assert.equal(localInputToUtc("2026-07-03T17:00", "Europe/Amsterdam"), "2026-07-03T15:00:00.000Z");
  assert.equal(localInputToUtc("2026-11-03T17:00", "Asia/Kolkata"), "2026-11-03T11:30:00.000Z");
  assert.equal(localInputToUtc("2026-11-03", "UTC"), "2026-11-03T23:59:00.000Z");
  assert.equal(localInputToUtc("", "UTC"), null);
  assert.equal(localInputToUtc("tomorrow", "UTC"), null);
});

test("localInputToUtc handles the daylight saving switch", () => {
  // 29 March 2026 02:00 -> 03:00 in Amsterdam; 03:30 is already summer time.
  assert.equal(localInputToUtc("2026-03-29T03:30", "Europe/Amsterdam"), "2026-03-29T01:30:00.000Z");
  assert.equal(localInputToUtc("2026-10-25T12:00", "Europe/Amsterdam"), "2026-10-25T11:00:00.000Z");
});

test("utcToLocalInput round-trips", () => {
  for (const zone of ["Europe/Amsterdam", "Asia/Kolkata", "America/New_York"]) {
    const utc = localInputToUtc("2026-12-01T09:15", zone)!;
    assert.equal(utcToLocalInput(utc, zone), "2026-12-01T09:15");
  }
  assert.equal(utcToLocalInput(null, "UTC"), "");
});

test("the same deadline is a different day in Amsterdam and Bangalore", () => {
  const due = "2026-11-03T20:00:00.000Z"; // 21:00 Amsterdam, 01:30 next day Bangalore
  assert.equal(dayIn(due, "Europe/Amsterdam"), "2026-11-03");
  assert.equal(dayIn(due, "Asia/Kolkata"), "2026-11-04");
});

test("dueState and formatDue speak relative to the viewer's today", () => {
  const now = new Date("2026-11-03T08:00:00Z");
  assert.equal(dueState(null, "UTC", now), "none");
  assert.equal(dueState("2026-11-03T07:00:00Z", "UTC", now), "overdue");
  assert.equal(dueState("2026-11-03T18:00:00Z", "UTC", now), "today");
  assert.equal(dueState("2026-11-04T10:00:00Z", "UTC", now), "tomorrow");
  assert.equal(dueState("2026-11-09T10:00:00Z", "UTC", now), "later");
  assert.equal(formatDue("2026-11-03T16:00:00Z", "Europe/Amsterdam", now), "Today 17:00");
  assert.equal(formatDue("2026-11-04T16:00:00Z", "Europe/Amsterdam", now), "Tomorrow 17:00");
  assert.equal(formatDue("2026-11-09T16:00:00Z", "Europe/Amsterdam", now), "Mon 9 Nov 17:00");
  assert.equal(formatDue("2027-01-09T16:00:00Z", "Europe/Amsterdam", now), "9 Jan 2027 17:00");
});

test("time zones are validated", () => {
  assert.ok(isValidTimeZone("Asia/Kolkata"));
  assert.ok(!isValidTimeZone("Mars/Olympus"));
  assert.equal(safeTimeZone("Mars/Olympus"), "Europe/Amsterdam");
  assert.equal(safeTimeZone(null), "Europe/Amsterdam");
});

// ---------------------------------------------------------------------------
// Mentions
// ---------------------------------------------------------------------------

test("mentions are stored as @[Name](id) and parsed back", () => {
  const id = "0b9d3a52-3c3a-4c6e-9a77-1f2e3d4c5b6a";
  const other = "1b9d3a52-3c3a-4c6e-9a77-1f2e3d4c5b6a";
  const body = `${mentionToken("Floris", id)} can you check? cc ${mentionToken("Judith [KG]", other)} and ${mentionToken("Floris", id)}`;
  assert.deepEqual(parseMentions(body), [id, other]);
  assert.equal(plainMentions(body), "@Floris can you check? cc @Judith KG and @Floris");
  assert.deepEqual(parseMentions("mail me at a@b.nl or @[x](not-an-id)"), []);
});

// ---------------------------------------------------------------------------
// Tokens and errors
// ---------------------------------------------------------------------------

test("API tokens are wrk_ tokens with a sha256 hash", () => {
  const { token, hash, prefix } = generateWorkToken();
  assert.match(token, /^wrk_[A-Za-z0-9_-]{43}$/);
  assert.ok(isWorkTokenFormat(token));
  assert.ok(!isWorkTokenFormat(token.replace("wrk_", "nrd_")));
  assert.equal(hash, sha256(token));
  assert.equal(prefix, token.slice(0, 12));
});

test("invite tokens are only stored as a hash", () => {
  const { token, hash } = generateInviteToken();
  assert.equal(inviteTokenHash(token), hash);
  assert.notEqual(hash, sha256(token));
  assert.notEqual(generateInviteToken().token, token);
});

test("only the database's own rule messages reach the user", () => {
  assert.equal(workErrorMessage({ code: "P0001", message: "Add a comment that says what still needs to happen" }), "Add a comment that says what still needs to happen");
  assert.equal(workErrorMessage({ code: "42501", message: "Only the reviewer can mark this task as done" }), "Only the reviewer can mark this task as done");
  assert.equal(workErrorMessage({ code: "23505", message: 'duplicate key value violates unique constraint "x"' }), WORK_GENERIC_ERROR);
  assert.equal(workErrorMessage(null), WORK_GENERIC_ERROR);
});

type Row = Record<string, unknown>;

/** Just enough of the Supabase query builder for these tests. */
function fakeDb(tables: Record<string, Row[]>, rpc: (name: string, args: Row) => unknown = () => null) {
  const calls: { table: string; op: string; values?: unknown }[] = [];
  const from = (table: string) => {
    let rows = [...(tables[table] ?? [])];
    const builder = {
      select: () => builder,
      eq: (col: string, value: unknown) => ((rows = rows.filter((r) => r[col] === value)), builder),
      in: (col: string, values: unknown[]) => ((rows = rows.filter((r) => values.includes(r[col]))), builder),
      is: (col: string, value: unknown) => ((rows = rows.filter((r) => (r[col] ?? null) === value)), builder),
      update: (values: unknown) => (calls.push({ table, op: "update", values }), builder),
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      then: (resolve: (v: { data: Row[]; error: null }) => void) => resolve({ data: rows, error: null }),
    };
    return builder;
  };
  return {
    calls,
    db: { from, rpc: async (name: string, args: Row) => ({ data: rpc(name, args), error: null }) } as never,
  };
}

test("authenticateWorkToken accepts live tokens and rejects revoked or expired ones", async () => {
  const live = generateWorkToken();
  const revoked = generateWorkToken();
  const expired = generateWorkToken();
  const base = { access: "write", last_used_at: null, user_id: "u1" };
  const { db } = fakeDb({
    work_api_tokens: [
      { ...base, id: "t1", token_hash: live.hash, expires_at: null, revoked_at: null },
      { ...base, id: "t2", token_hash: revoked.hash, expires_at: null, revoked_at: "2026-01-01T00:00:00Z" },
      { ...base, id: "t3", token_hash: expired.hash, expires_at: "2026-01-01T00:00:00Z", revoked_at: null },
    ],
    profiles: [{ id: "u1", full_name: "Fred", email: "fred@freelance.dev" }],
  });
  const now = new Date("2026-11-01T00:00:00Z");
  const ok = await authenticateWorkToken(`Bearer ${live.token}`, db, now);
  assert.ok(ok.ok && ok.actor.userId === "u1" && ok.actor.access === "write" && ok.actor.name === "Fred");
  assert.deepEqual(await authenticateWorkToken(`Bearer ${revoked.token}`, db, now), { ok: false, reason: "revoked" });
  assert.deepEqual(await authenticateWorkToken(`Bearer ${expired.token}`, db, now), { ok: false, reason: "expired" });
  assert.deepEqual(await authenticateWorkToken("Bearer wrk_short", db, now), { ok: false, reason: "invalid" });
  assert.deepEqual(await authenticateWorkToken(null, db, now), { ok: false, reason: "missing" });
});

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

test("deliverNotifications mails each person once and never includes comment text", async () => {
  const sent: { to: string[]; subject: string; html: string }[] = [];
  const realFetch = globalThis.fetch;
  process.env.RESEND_API_KEY = "test";
  process.env.MAIL_FROM = "Work <work@example.com>";
  globalThis.fetch = (async (_url: string, init: { body: string }) => {
    sent.push(JSON.parse(init.body));
    return new Response("{}", { status: 200 });
  }) as never;

  const finished: { ids: number[]; sent: boolean }[] = [];
  let claimed = false;
  const notification = (id: number, user: string, kind: string) => ({
    id,
    user_id: user,
    kind,
    task_id: "t1",
    actor_id: "judith",
    data: { title: "Screen Magento candidates", comment: "SECRET candidate salary" },
    delivery: "instant",
  });
  const { db } = fakeDb(
    {
      profiles: [
        { id: "floris", full_name: "Floris", email: "floris@nordavo.nl", time_zone: "Europe/Amsterdam" },
        { id: "judith", full_name: "Judith", email: "judith@nordavo.nl", time_zone: "Asia/Kolkata" },
      ],
      work_tasks: [{ id: "t1", title: "Screen Magento candidates", due_at: null, project: { name: "Hiring" }, workspace: { name: "Nordavo" } }],
    },
    (name, args) => {
      if (name === "work_claim_notifications") {
        if (claimed) return [];
        claimed = true;
        return [notification(1, "floris", "review"), notification(2, "floris", "mention"), notification(3, "judith", "returned")];
      }
      if (name === "work_finish_notifications") finished.push({ ids: args.p_ids as number[], sent: args.p_sent as boolean });
      return null;
    },
  );

  try {
    const result = await deliverNotifications("instant", db);
    assert.deepEqual(result, { claimed: 3, mails: 2, failed: 0 });
    assert.equal(sent.length, 2);
    const toFloris = sent.find((m) => m.to.includes("floris@nordavo.nl"))!;
    assert.equal(toFloris.subject, "2 updates in Work");
    assert.match(toFloris.html, /sent &quot;Screen Magento candidates&quot; to review/);
    assert.match(toFloris.html, /Nordavo › Hiring/);
    assert.match(toFloris.html, /\/work\/tasks\/t1/);
    for (const mail of sent) assert.doesNotMatch(mail.html, /SECRET/);
    assert.deepEqual(finished, [{ ids: [1, 2, 3], sent: true }]);
  } finally {
    globalThis.fetch = realFetch;
  }
});

// ---------------------------------------------------------------------------
// ClickUp import
// ---------------------------------------------------------------------------

test("ClickUp statuses map onto Work, finished work is left out", () => {
  assert.equal(mapStatus({ status: "to do", type: "open" }), "todo");
  assert.equal(mapStatus({ status: "in progress", type: "custom" }), "in_progress");
  assert.equal(mapStatus({ status: "Review", type: "custom" }), "review");
  assert.equal(mapStatus({ status: "ter controle", type: "custom" }), "review");
  assert.equal(mapStatus({ status: "complete", type: "closed" }), null);
  assert.equal(mapStatus({ status: "done", type: "done" }), null);
  assert.equal(mapPriority({ priority: "urgent" }), "urgent");
  assert.equal(mapPriority(null), "normal");
  assert.equal(clickUpDate("1793750400000"), "2026-11-04T00:00:00.000Z");
  assert.equal(clickUpDate(null), null);
});

test("deeper ClickUp subtasks hang under their top task", () => {
  const parents = new Map<string, string | null>([
    ["a", null],
    ["b", "a"],
    ["c", "b"],
  ]);
  assert.equal(rootParent("a", parents), null);
  assert.equal(rootParent("b", parents), "a");
  assert.equal(rootParent("c", parents), "a");
});

test("a dry run reads ClickUp and counts without writing", async () => {
  const responses: Record<string, unknown> = {
    "/team": { teams: [{ id: "9", name: "Nordavo" }, { id: "8", name: "Unknown" }] },
    "/team/9/space?archived=false": { spaces: [{ id: "s1", name: "Ops" }] },
    "/space/s1/folder?archived=false": { folders: [{ name: "Recruitment", lists: [{ id: "l1", name: "Hiring" }] }] },
    "/space/s1/list?archived=false": { lists: [] },
    "/list/l1/task?archived=false&subtasks=true&include_closed=false&include_markdown_description=true&page=0": {
      tasks: [
        { id: "x1", name: "Open task", status: { status: "to do", type: "open" }, list: { id: "l1", name: "Hiring" } },
        { id: "x2", name: "Done task", status: { status: "done", type: "done" }, list: { id: "l1", name: "Hiring" } },
      ],
      last_page: true,
    },
  };
  const requested: string[] = [];
  const fetchImpl = (async (url: string) => {
    const path = url.replace("https://api.clickup.com/api/v2", "");
    requested.push(path);
    if (!(path in responses)) return new Response("missing", { status: 404 });
    return new Response(JSON.stringify(responses[path]), { status: 200 });
  }) as never;
  const { db, calls } = fakeDb({
    work_workspaces: [{ id: "w1", name: "Nordavo", slug: "nordavo" }],
    work_members: [],
  });
  const logs: string[] = [];
  const counts = await importFromClickUp({ token: "pk", db, dryRun: true, log: (m) => logs.push(m), fetchImpl });
  assert.deepEqual(counts, { projects: 1, tasks: 1, comments: 0, files: 0, skipped: 1 });
  assert.equal(calls.length, 0);
  assert.ok(logs.some((l) => l.includes('"Unknown"') && l.includes("overgeslagen")));
});
