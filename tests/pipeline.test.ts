import { test } from "node:test";
import assert from "node:assert/strict";
import type { McpDb } from "@/lib/mcp/shared";
import { markToppers, moveCandidates } from "@/lib/mcp/write-tools";
import {
  applyBoardFilter,
  bulkMoveSchema,
  defaultBoardFilter,
  formStatus,
  formatScreeningTools,
  isFiltered,
  moveArgs,
  parseScreeningTools,
  selectRange,
  toggleColumn,
  type FilterableCard,
} from "@/lib/recruitment/pipeline";

// ---------------------------------------------------------------------------
// Screening tools
// ---------------------------------------------------------------------------

test("parseScreeningTools reads the JSON from the form, drops empty rows and rounds to halves", () => {
  const result = parseScreeningTools(
    JSON.stringify([
      { tool: " Clay ", years: 2 },
      { tool: "n8n", years: "2" },
      { tool: "Python", years: 4.3 },
      { tool: "", years: 9 },
    ]),
  );
  assert.ok(result.ok);
  assert.deepEqual(result.tools, [
    { tool: "Clay", years: 2 },
    { tool: "n8n", years: 2 },
    { tool: "Python", years: 4.5 },
  ]);
  assert.equal(formatScreeningTools(result.tools), "Clay 2, n8n 2, Python 4.5");
});

test("parseScreeningTools dedupes tools case-insensitively, last one wins", () => {
  const result = parseScreeningTools([
    { tool: "Clay", years: 1 },
    { tool: "clay", years: 3 },
  ]);
  assert.ok(result.ok);
  assert.deepEqual(result.tools, [{ tool: "clay", years: 3 }]);
});

test("parseScreeningTools refuses bad input", () => {
  assert.equal(parseScreeningTools("not json").ok, false);
  assert.equal(parseScreeningTools('{"tool":"Clay"}').ok, false);
  assert.equal(parseScreeningTools([{ tool: "Clay", years: 51 }]).ok, false);
  assert.equal(parseScreeningTools([{ tool: "Clay", years: -1 }]).ok, false);
  assert.equal(parseScreeningTools([{ tool: "Clay", years: "" }]).ok, false);
  assert.equal(parseScreeningTools([{ tool: "x".repeat(61), years: 1 }]).ok, false);
  const many = Array.from({ length: 31 }, (_, i) => ({ tool: `T${i}`, years: 1 }));
  assert.equal(parseScreeningTools(many).ok, false);
  assert.deepEqual(parseScreeningTools(""), { ok: true, tools: [] });
});

// ---------------------------------------------------------------------------
// Board filter and sort
// ---------------------------------------------------------------------------

function card(id: string, extra: Partial<FilterableCard> & { topper?: boolean; name?: string } = {}) {
  const { topper = false, name = id, ...rest } = extra;
  return {
    id,
    position: 0,
    origin: "applied" as const,
    source: null,
    cv_score: null,
    video_score: null,
    shortlisted_at: null,
    daysInPipeline: 0,
    testScore: null,
    candidate: { full_name: name, is_topper: topper, skills: ["Python"], current_title: "GTM engineer" },
    ...rest,
  };
}

test("applyBoardFilter sorts by score, highest first, empty scores last", () => {
  const cards = [
    card("a", { position: 1, cv_score: 60 }),
    card("b", { position: 2, cv_score: null }),
    card("c", { position: 3, cv_score: 90 }),
    card("d", { position: 4, cv_score: 60 }),
  ];
  const sorted = applyBoardFilter(cards, { ...defaultBoardFilter, sort: "cv_score" });
  assert.deepEqual(sorted.map((c) => c.id), ["c", "a", "d", "b"]);
  // The input order is untouched.
  assert.deepEqual(cards.map((c) => c.id), ["a", "b", "c", "d"]);
  // Board order keeps the order given (the board may be mid-drag).
  const board = applyBoardFilter([cards[2], cards[0]], defaultBoardFilter);
  assert.deepEqual(board.map((c) => c.id), ["c", "a"]);
});

test("applyBoardFilter filters on origin, source, shortlist, toppers and search", () => {
  const cards = [
    card("a", { origin: "headhunted", source: "linkedin" }),
    card("b", { source: "naukri", shortlisted_at: "2026-11-08T10:00:00Z" }),
    card("c", { topper: true, name: "Meera" }),
  ];
  const ids = (f: Partial<typeof defaultBoardFilter>) =>
    applyBoardFilter(cards, { ...defaultBoardFilter, ...f }).map((c) => c.id);
  assert.deepEqual(ids({ origin: "headhunted" }), ["a"]);
  assert.deepEqual(ids({ source: "naukri" }), ["b"]);
  assert.deepEqual(ids({ shortlistedOnly: true }), ["b"]);
  assert.deepEqual(ids({ toppersOnly: true }), ["c"]);
  assert.deepEqual(ids({ query: "mee" }), ["c"]);
  assert.deepEqual(ids({ query: "python" }), ["a", "b", "c"]);
  assert.equal(isFiltered(defaultBoardFilter), false);
  assert.equal(isFiltered({ ...defaultBoardFilter, sort: "video_score" }), true);
});

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

test("selectRange selects everything between the anchor and the target", () => {
  const order = ["a", "b", "c", "d", "e"];
  assert.deepEqual([...selectRange(order, new Set(), "b", "d")].sort(), ["b", "c", "d"]);
  assert.deepEqual([...selectRange(order, new Set(["a"]), "e", "c")].sort(), ["a", "c", "d", "e"]);
  // No anchor: toggles the one card.
  assert.deepEqual([...selectRange(order, new Set(["a"]), null, "a")], []);
  assert.deepEqual([...selectRange(order, new Set(), "gone", "b")], ["b"]);
});

test("toggleColumn selects a whole column, or clears it when all are selected", () => {
  assert.deepEqual([...toggleColumn(new Set(["x"]), ["a", "b"])].sort(), ["a", "b", "x"]);
  assert.deepEqual([...toggleColumn(new Set(["a", "b", "x"]), ["a", "b"])], ["x"]);
  assert.deepEqual([...toggleColumn(new Set(), [])], []);
});

test("formStatus reads sent and completed", () => {
  assert.equal(formStatus({ form_sent_at: null, form_completed_at: null }), "not_sent");
  assert.equal(formStatus({ form_sent_at: "2026-11-08", form_completed_at: null }), "sent");
  assert.equal(formStatus({ form_sent_at: "2026-11-08", form_completed_at: "2026-11-09" }), "completed");
});

// ---------------------------------------------------------------------------
// Bulk move request
// ---------------------------------------------------------------------------

const A1 = "00000000-0000-4000-8000-0000000000a1";
const A2 = "00000000-0000-4000-8000-0000000000a2";

test("moveArgs keeps reason and date only where they belong", () => {
  const park = bulkMoveSchema.parse({ applicationIds: [A1, A1, A2], stage: "parked", reason: " later ", parkUntil: "2027-01-01" });
  assert.deepEqual(moveArgs(park), {
    p_application_ids: [A1, A2],
    p_stage: "parked",
    p_reason: "later",
    p_park_until: "2027-01-01",
  });
  const move = bulkMoveSchema.parse({ applicationIds: [A1], stage: "interview", reason: "x", parkUntil: "2027-01-01" });
  assert.deepEqual(moveArgs(move), { p_application_ids: [A1], p_stage: "interview", p_reason: null, p_park_until: null });
  assert.equal(bulkMoveSchema.safeParse({ applicationIds: [], stage: "interview" }).success, false);
  assert.equal(bulkMoveSchema.safeParse({ applicationIds: [A1], stage: "presented" }).success, false);
  assert.equal(bulkMoveSchema.safeParse({ applicationIds: ["nope"], stage: "resume" }).success, false);
});

// ---------------------------------------------------------------------------
// MCP: move_candidates and mark_topper against a fake admin client
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

function fakeDb(rows: Row[]) {
  const calls: { rpc?: { name: string; args: Row }; update?: Row; filters: [string, string, unknown][] }[] = [];
  const db = {
    from() {
      const call: (typeof calls)[number] = { filters: [] };
      calls.push(call);
      const result = () => {
        const data = rows.filter((r) =>
          call.filters.every(([op, col, val]) =>
            op === "eq" ? r[col] === val : (val as unknown[]).includes(r[col]),
          ),
        );
        return { data: call.update ? data.map((r) => ({ ...r, ...call.update })) : data, error: null };
      };
      const builder = {
        select: () => builder,
        update: (values: Row) => {
          call.update = values;
          return builder;
        },
        eq: (col: string, val: unknown) => {
          call.filters.push(["eq", col, val]);
          return builder;
        },
        in: (col: string, val: unknown[]) => {
          call.filters.push(["in", col, val]);
          return builder;
        },
        then: (resolve: (v: unknown) => void) => resolve(result()),
      };
      return builder;
    },
    rpc: async (name: string, args: Row) => {
      calls.push({ rpc: { name, args }, filters: [] });
      return { data: (args.p_application_ids as string[]).length, error: null };
    },
  };
  return { db: db as unknown as McpDb, calls };
}

const V1 = "00000000-0000-4000-8000-0000000000e1";
const C1 = "00000000-0000-4000-8000-0000000000c1";
const C2 = "00000000-0000-4000-8000-0000000000c2";
const C3 = "00000000-0000-4000-8000-0000000000c3";
const ACTOR = "00000000-0000-4000-8000-0000000000aa";

const applications = [
  { id: A1, candidate_id: C1, vacancy_id: V1, stage: "video_review" },
  { id: A2, candidate_id: C2, vacancy_id: V1, stage: "video_review" },
];

test("moveCandidates resolves candidate ids on the vacancy and moves as the token owner", async () => {
  const { db, calls } = fakeDb(applications);
  const result = await moveCandidates(db, ACTOR, {
    vacancy_id: V1,
    candidate_ids: [C1, C2, C3],
    stage: "parked",
    reason: "Notice period 90 days",
    park_until: "2027-02-01",
  });
  assert.deepEqual(result, { moved: 2, unchanged: 0, not_found: [C3] });
  const rpc = calls.find((c) => c.rpc)?.rpc;
  assert.equal(rpc?.name, "move_applications_as");
  assert.deepEqual(rpc?.args, {
    p_actor: ACTOR,
    p_application_ids: [A1, A2],
    p_stage: "parked",
    p_reason: "Notice period 90 days",
    p_park_until: "2027-02-01",
  });
});

test("moveCandidates needs exactly one kind of id and keeps the date to parking", async () => {
  const { db } = fakeDb(applications);
  assert.ok("error" in (await moveCandidates(db, ACTOR, { vacancy_id: V1, stage: "interview" })));
  assert.ok(
    "error" in (await moveCandidates(db, ACTOR, { vacancy_id: V1, application_ids: [A1], candidate_ids: [C1], stage: "interview" })),
  );
  assert.ok(
    "error" in (await moveCandidates(db, ACTOR, { vacancy_id: V1, application_ids: [A1], stage: "rejected", park_until: "2027-01-01" })),
  );
  const none = await moveCandidates(db, ACTOR, { vacancy_id: V1, application_ids: [C3], stage: "interview" });
  assert.ok("error" in none);
});

test("moveCandidates drops the reason for a plain stage move", async () => {
  const { db, calls } = fakeDb(applications);
  await moveCandidates(db, ACTOR, { vacancy_id: V1, application_ids: [A1], stage: "technical_test", reason: "top 10" });
  assert.equal(calls.find((c) => c.rpc)?.rpc?.args.p_reason, null);
});

test("markToppers needs a reason to mark and records the token owner", async () => {
  const { db, calls } = fakeDb([{ id: C1, full_name: "Asha" }]);
  assert.ok("error" in (await markToppers(db, ACTOR, { candidate_ids: [C1], is_topper: true })));
  const result = await markToppers(db, ACTOR, { candidate_ids: [C1, C2], is_topper: true, reason: "Strong test" });
  assert.ok(!("error" in result));
  assert.deepEqual(result.not_found, [C2]);
  assert.deepEqual(calls.at(-1)?.update, { is_topper: true, topper_reason: "Strong test", topper_by: ACTOR });
  await markToppers(db, ACTOR, { candidate_ids: [C1], is_topper: false });
  assert.equal(calls.at(-1)?.update?.is_topper, false);
});
