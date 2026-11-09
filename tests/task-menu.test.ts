import { test } from "node:test";
import assert from "node:assert/strict";
import { applyChange, changeMessage, taskMenuEntries, undoFor, type TaskMenuTask } from "../src/lib/work/task-menu";

const task: TaskMenuTask = { id: "t1", title: "Call back", status: "todo", priority: "normal", reviewerId: "u1" };
const keys = (t: TaskMenuTask) => taskMenuEntries(t).map((e) => e.key);

test("menu: only status moves that need no comment", () => {
  assert.deepEqual(keys(task).filter((k) => k.startsWith("status")), ["status-in_progress", "status-review", "status-done"]);
  assert.deepEqual(keys({ ...task, status: "in_progress" }).filter((k) => k.startsWith("status")), ["status-todo", "status-review", "status-done"]);
  assert.deepEqual(keys({ ...task, status: "review" }).filter((k) => k.startsWith("status")), ["status-done"]);
  assert.deepEqual(keys({ ...task, status: "done" }).filter((k) => k.startsWith("status")), []);
  assert.ok(!keys({ ...task, reviewerId: null }).includes("status-review"));
});

test("menu: the current priority is checked, open comes first", () => {
  const entries = taskMenuEntries({ ...task, priority: "high" });
  assert.equal(entries[0].key, "open");
  assert.deepEqual(entries.filter((e) => e.checked).map((e) => e.key), ["priority-high"]);
});

test("undo: back to where it was, except where the rules ask for a comment", () => {
  assert.deepEqual(undoFor(task, { kind: "status", status: "in_progress" }), { kind: "status", status: "todo" });
  assert.equal(undoFor(task, { kind: "status", status: "done" }), null);
  assert.equal(undoFor(task, { kind: "status", status: "review" }), null);
  assert.deepEqual(undoFor({ ...task, status: "review" }, { kind: "status", status: "done" }), { kind: "status", status: "review" });
  assert.deepEqual(undoFor(task, { kind: "priority", priority: "urgent" }), { kind: "priority", priority: "normal" });
  assert.equal(undoFor(task, { kind: "priority", priority: "normal" }), null);
});

test("messages and applying a change", () => {
  assert.equal(changeMessage({ kind: "status", status: "in_progress" }), "Moved to In progress.");
  assert.equal(changeMessage({ kind: "status", status: "done" }), "Marked as done.");
  assert.equal(applyChange(task, { kind: "priority", priority: "low" }).priority, "low");
});
