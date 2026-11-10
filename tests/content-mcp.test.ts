import { test } from "node:test";
import assert from "node:assert/strict";
import { locateOriginal, occurrences } from "../src/lib/content/text-match";
import { missingFor } from "../src/lib/content/notify";
import { contentSearchPattern } from "../src/lib/content/search";

test("text match: Claude names the text, the offset is counted in characters", () => {
  const body = "We hire in India. We hire fast.";
  assert.deepEqual(occurrences(body, "We hire"), [0, 18]);
  const twice = locateOriginal(body, "We hire");
  assert.equal(twice.ok, false);
  assert.match(!twice.ok ? twice.error : "", /occurs 2 times/);
  assert.deepEqual(locateOriginal(body, "We hire", 2), { ok: true, start: 18, utf16Start: 18 });
  assert.equal(locateOriginal(body, "We hire", 3).ok, false);
  assert.equal(locateOriginal(body, "nowhere").ok, false);
  assert.deepEqual(locateOriginal(body, "fast"), { ok: true, start: 26, utf16Start: 26 });
  // Emoji count as one character in the database.
  assert.deepEqual(locateOriginal("🚀 Launch day", "Launch"), { ok: true, start: 2, utf16Start: 3 });
  // Adding text goes at the end.
  assert.deepEqual(locateOriginal("🚀 ab", ""), { ok: true, start: 4, utf16Start: 5 });
});

test("monday summary: what is still missing", () => {
  const post = { title: "x", status: "draft", plannedDate: "2026-11-10", timeSlot: null, formatNeedsMedia: true, mediaCount: 0 };
  assert.deepEqual(missingFor(post), ["not approved", "no time slot", "no media"]);
  assert.deepEqual(missingFor({ ...post, status: "scheduled", timeSlot: "t0830", mediaCount: 1 }), []);
});

test("search: a safe pattern for PostgREST filters", () => {
  assert.equal(contentSearchPattern("a"), null);
  assert.equal(contentSearchPattern("100% (india), hire_fast"), "%100\\% india hire\\_fast%");
});
