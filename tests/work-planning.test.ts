import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  deadlineOn,
  diffDays,
  firstOfMonth,
  lastOfMonth,
  moveDeadline,
  startOfWeek,
  timelineSpan,
} from "../src/lib/work/days";
import { formatEstimate, parseEstimate, planningParams } from "../src/lib/work/labels";
import { matchesView } from "../src/lib/offline/overlay";
import type { TaskListItem } from "../src/lib/work/data";

const AMS = "Europe/Amsterdam";
const BLR = "Asia/Kolkata";

test("days: adding, counting, weeks and months without a time zone shift", () => {
  assert.equal(addDays("2026-10-31", 1), "2026-11-01");
  assert.equal(addDays("2026-03-29", 1), "2026-03-30", "the night the clocks change is still one day");
  assert.equal(diffDays("2026-11-02", "2026-11-09"), 7);
  assert.equal(diffDays("2026-11-09", "2026-11-02"), -7);
  assert.equal(startOfWeek("2026-11-10"), "2026-11-09", "Tuesday to Monday");
  assert.equal(startOfWeek("2026-11-15"), "2026-11-09", "Sunday belongs to the week before");
  assert.equal(firstOfMonth("2026-11-10"), "2026-11-01");
  assert.equal(firstOfMonth("2026-12-10", 1), "2027-01-01");
  assert.equal(lastOfMonth("2027-02-10"), "2027-02-28");
});

test("moving a deadline keeps its time of day in the viewer's zone", () => {
  // 17:00 in Amsterdam (winter) is 16:00 UTC.
  assert.equal(moveDeadline("2026-11-03T16:00:00.000Z", "2026-11-05", AMS), "2026-11-05T16:00:00.000Z");
  // Across the switch to summer time: still 17:00 local, now 15:00 UTC.
  assert.equal(moveDeadline("2027-03-26T16:00:00.000Z", "2027-03-29", AMS), "2027-03-29T15:00:00.000Z");
  // In Bangalore 17:00 is 11:30 UTC.
  assert.equal(moveDeadline("2026-11-03T11:30:00.000Z", "2026-11-04", BLR), "2026-11-04T11:30:00.000Z");
  assert.equal(deadlineOn("2026-11-12", AMS), "2026-11-12T16:00:00.000Z");
});

test("timeline span: both dates, one date with an estimate, or nothing", () => {
  const base = { startOn: null, dueAt: null, estimateMinutes: null };
  assert.equal(timelineSpan(base, AMS), null);
  // Deadline 17:00 Amsterdam on Thursday 12 November.
  const due = "2026-11-12T16:00:00.000Z";
  assert.deepEqual(timelineSpan({ ...base, startOn: "2026-11-09", dueAt: due }, AMS), { from: "2026-11-09", to: "2026-11-12", derived: null });
  assert.deepEqual(timelineSpan({ ...base, dueAt: due }, AMS), { from: "2026-11-12", to: "2026-11-12", derived: null });
  // 16 hours is two working days, ending on the deadline.
  assert.deepEqual(timelineSpan({ ...base, dueAt: due, estimateMinutes: 16 * 60 }, AMS), { from: "2026-11-11", to: "2026-11-12", derived: "start" });
  // Three days from a Friday skip the weekend.
  assert.deepEqual(timelineSpan({ ...base, startOn: "2026-11-13", estimateMinutes: 24 * 60 }, AMS), {
    from: "2026-11-13",
    to: "2026-11-17",
    derived: "due",
  });
  // A start after the deadline is clamped to one day.
  assert.deepEqual(timelineSpan({ ...base, startOn: "2026-11-20", dueAt: due }, AMS), { from: "2026-11-20", to: "2026-11-20", derived: null });
  // The deadline counts on the viewer's day: 23:30 UTC is already the next day in Bangalore.
  assert.equal(timelineSpan({ ...base, dueAt: "2026-11-12T23:30:00.000Z" }, BLR)?.to, "2026-11-13");
});

test("estimates: reading and writing", () => {
  assert.equal(parseEstimate(""), null);
  assert.equal(parseEstimate("2h"), 120);
  assert.equal(parseEstimate("1.5"), 90);
  assert.equal(parseEstimate("1,5"), 90);
  assert.equal(parseEstimate("45m"), 45);
  assert.equal(parseEstimate("45 min"), 45);
  assert.equal(parseEstimate("1h30"), 90);
  assert.equal(parseEstimate("1:30"), 90);
  assert.equal(parseEstimate("1h 30m"), 90);
  assert.ok(Number.isNaN(parseEstimate("soon")));
  assert.equal(formatEstimate(90), "1h 30m");
  assert.equal(formatEstimate(120), "2h");
  assert.equal(formatEstimate(45), "45m");
  assert.equal(formatEstimate(null), "");
});

test("type and label filters from the URL", () => {
  assert.deepEqual(planningParams("call", "sales"), { taskType: "call", label: "sales" });
  assert.deepEqual(planningParams("none", undefined), { taskType: "none", label: undefined });
  assert.deepEqual(planningParams("nonsense", "x".repeat(41)), { taskType: undefined, label: undefined });
});

const task = (extra: Partial<TaskListItem> = {}): TaskListItem => ({
  id: "t1",
  title: "Call Bright Fintech",
  status: "todo",
  priority: "normal",
  dueAt: null,
  parentId: null,
  parentTitle: null,
  isLog: false,
  reviewerId: "me",
  createdBy: "me",
  updatedAt: "2026-11-10T08:00:00.000Z",
  completedAt: null,
  taskType: null,
  labels: [],
  startOn: null,
  estimateMinutes: null,
  project: { id: "p1", name: "Sales" },
  workspace: { id: "w1", name: "Nordavo", slug: "nordavo" },
  assignees: [{ id: "me", name: "Me", email: null }],
  subtasks: { total: 0, done: 0 },
  record: null,
  ...extra,
});

test("lists filtered on type or label keep only matching tasks on this device", () => {
  assert.equal(matchesView(task({ taskType: "call" }), { taskType: "call" }), true);
  assert.equal(matchesView(task({ taskType: "email" }), { taskType: "call" }), false);
  assert.equal(matchesView(task(), { taskType: "none" }), true);
  assert.equal(matchesView(task({ labels: ["Sales"] }), { label: "sales" }), true, "labels match without case");
  assert.equal(matchesView(task({ labels: [] }), { label: "sales" }), false);
});
