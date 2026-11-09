import { test } from "node:test";
import assert from "node:assert/strict";
import { matchesView, overlay, type OverlayEntry } from "../src/lib/offline/overlay";

type T = {
  id: string;
  title: string;
  status: "todo" | "in_progress" | "review" | "done" | "cancelled";
  priority: "low" | "normal" | "high" | "urgent";
  dueAt: string | null;
  reviewerId: string | null;
  isLog: boolean;
  project: { id: string };
  workspace: { id: string };
  assignees: { id: string }[];
};

const task = (id: string, extra: Partial<T> = {}): T => ({
  id,
  title: id,
  status: "todo",
  priority: "normal",
  dueAt: null,
  reviewerId: "me",
  isLog: false,
  project: { id: "p1" },
  workspace: { id: "w1" },
  assignees: [{ id: "me" }],
  ...extra,
});
const ids = (list: { id: string }[]) => list.map((t) => t.id);

test("overlay: changed records replace the server's, deleted ones go", () => {
  const server = [task("a"), task("b"), task("c")];
  const dirty: OverlayEntry<T>[] = [
    { id: "b", data: task("b", { title: "B changed here" }), created: false },
    { id: "c", data: null, created: false },
  ];
  const result = overlay(server, dirty);
  assert.deepEqual(ids(result), ["a", "b"]);
  assert.equal(result[1].title, "B changed here");
});

test("overlay: records made on this device show up once, also after the server has them", () => {
  const made = { id: "new", data: task("new"), created: true };
  assert.deepEqual(ids(overlay([task("a")], [made])), ["a", "new"]);
  assert.deepEqual(ids(overlay([task("a"), task("new")], [made])), ["a", "new"]);
});

test("overlay: no dirty records, the server's list as it is", () => {
  const server = [task("a")];
  assert.equal(overlay(server, []), server);
});

test("overlay: a record that no longer fits the view leaves the list", () => {
  const open = (t: T) => matchesView(t, { statuses: ["todo", "in_progress", "review"] });
  const dirty = [{ id: "a", data: task("a", { status: "done" }), created: false }];
  assert.deepEqual(ids(overlay([task("a"), task("b")], dirty, open)), ["b"]);
});

test("views: owner, reviewer, project, status, priority, log and due date", () => {
  const t = task("a", { priority: "high", dueAt: "2026-11-09T10:00:00Z" });
  assert.equal(matchesView(t, { assignee: "me" }), true);
  assert.equal(matchesView(t, { assignee: "you" }), false);
  assert.equal(matchesView(t, { reviewer: "you" }), false);
  assert.equal(matchesView(t, { projectId: "p2" }), false);
  assert.equal(matchesView(t, { statuses: ["review"] }), false);
  assert.equal(matchesView(t, { priority: "high" }), true);
  assert.equal(matchesView(t, { isLog: true }), false);
  assert.equal(matchesView(t, { dueBefore: "2026-11-09T22:59:00Z" }), true);
  assert.equal(matchesView(t, { dueBefore: "2026-11-09T09:00:00Z" }), false);
  assert.equal(matchesView(task("b"), { dueBefore: "2026-11-09T22:59:00Z" }), false);
});
