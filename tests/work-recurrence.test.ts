import assert from "node:assert/strict";
import { test } from "node:test";
import { isRecurrence, parseRecurrence, recurrenceLabel } from "../src/lib/work/recurrence";

test("recurrence labels are readable", () => {
  assert.equal(recurrenceLabel(null), "Does not repeat");
  assert.equal(recurrenceLabel("daily"), "Every day");
  assert.equal(recurrenceLabel("weekdays", 3), "Every workday");
  assert.equal(recurrenceLabel("weekly", 2), "Every 2 weeks");
  assert.equal(recurrenceLabel("monthly"), "Every month");
});

test("the form value becomes a rule and an interval", () => {
  assert.deepEqual(parseRecurrence("", ""), { recurrence: null, every: 1 });
  assert.deepEqual(parseRecurrence(undefined, undefined), { recurrence: null, every: 1 });
  assert.deepEqual(parseRecurrence("weekly", "2"), { recurrence: "weekly", every: 2 });
  assert.deepEqual(parseRecurrence("weekdays", "5"), { recurrence: "weekdays", every: 1 });
  assert.ok("error" in parseRecurrence("weekly", "0"));
  assert.ok("error" in parseRecurrence("weekly", "99"));
  assert.ok("error" in parseRecurrence("yearly", "1"));
  assert.equal(isRecurrence("monthly"), true);
  assert.equal(isRecurrence("yearly"), false);
});
