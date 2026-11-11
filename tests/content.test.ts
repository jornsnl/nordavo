import { test } from "node:test";
import assert from "node:assert/strict";
import { applyChange, changesBetween, diffWords, fromCodePointOffset, toCodePointOffset } from "../src/lib/content/diff";
import {
  addDays,
  averagesBy,
  bufferState,
  characterCount,
  cleanCustomFields,
  dueMeasurements,
  isDay,
  isSuccess,
  linkedInText,
  monthGrid,
  optionValue,
  parseImageBrief,
  parseModules,
  parseTags,
  reuseWarning,
  seeMoreCut,
  statusMoves,
  unapprovedTomorrow,
  weekRhythm,
  weekStart,
  type PostForRules,
  type StatusDef,
} from "../src/lib/content/rules";

const statuses: StatusDef[] = [
  { key: "draft", label: "Draft", position: 10, isCore: true, allowedRoles: ["author"] },
  { key: "in_review", label: "In review", position: 20, isCore: true, allowedRoles: ["author", "reviewer"] },
  { key: "changes_requested", label: "Changes requested", position: 30, isCore: true, allowedRoles: ["author", "reviewer"] },
  { key: "approved", label: "Approved", position: 40, isCore: true, allowedRoles: ["author", "reviewer"] },
  { key: "scheduled", label: "Scheduled", position: 50, isCore: true, allowedRoles: ["author", "reviewer"] },
  { key: "published", label: "Published", position: 60, isCore: true, allowedRoles: ["author", "reviewer"] },
  { key: "measured", label: "Measured", position: 70, isCore: true, allowedRoles: ["author", "reviewer"] },
  { key: "parked", label: "Parked", position: 80, isCore: true, allowedRoles: ["author"] },
  { key: "rejected", label: "Rejected", position: 90, isCore: true, allowedRoles: ["author"] },
];
const transitions = [
  ["draft", "in_review"],
  ["in_review", "changes_requested"],
  ["in_review", "approved"],
  ["changes_requested", "in_review"],
  ["approved", "scheduled"],
  ["scheduled", "published"],
  ["published", "measured"],
].map(([from, to]) => ({ from, to }));

const basePost: PostForRules = {
  status: "in_review",
  authorId: "julius",
  approvedAt: null,
  publishedAt: null,
  plannedDate: null,
  timeSlot: null,
  linkedinUrl: null,
  formatNeedsMedia: false,
  mediaCount: 0,
  has7dResults: false,
};

function moves(post: Partial<PostForRules>, role: "admin" | "author" | "reviewer" | "viewer", userId = "julius", adminApprovalRequired = false) {
  return statusMoves({ post: { ...basePost, ...post }, role, userId, statuses, transitions, adminApprovalRequired });
}

test("status moves: the reviewer and the author approve, unless an admin has to", () => {
  const reviewer = moves({}, "reviewer", "sabine");
  assert.ok(reviewer.some((m) => m.to.key === "approved" && m.allowed), "reviewer approves (feedback Julius)");
  assert.equal(moves({}, "reviewer", "sabine", true).find((m) => m.to.key === "approved")?.reason, "Needs approval from an admin");
  assert.ok(reviewer.some((m) => m.to.key === "changes_requested" && m.allowed));
  assert.ok(!reviewer.some((m) => m.to.key === "parked" && m.allowed), "parking is for the author");

  const author = moves({}, "author");
  assert.ok(author.some((m) => m.to.key === "approved" && m.allowed));
  assert.ok(!author.some((m) => m.to.key === "published"), "not a next step from review");

  const otherAuthor = moves({}, "author", "floris");
  assert.equal(otherAuthor.find((m) => m.to.key === "approved")?.reason, "Only the author can approve");

  const newEmployee = moves({}, "author", "julius", true);
  assert.equal(newEmployee.find((m) => m.to.key === "approved")?.reason, "Needs approval from an admin");
  assert.ok(moves({}, "admin", "jorn", true).some((m) => m.to.key === "approved" && m.allowed));
  assert.deepEqual(moves({}, "viewer"), []);
});

test("status moves: scheduling, publishing and measuring need their conditions", () => {
  const approved = { status: "approved", approvedAt: "2026-11-10T08:00:00Z" };
  assert.equal(moves(approved, "reviewer", "sabine").find((m) => m.to.key === "scheduled")?.reason, "Pick a date and a time slot first");
  const dated = { ...approved, plannedDate: "2026-11-12", timeSlot: "t0830" };
  assert.ok(moves(dated, "reviewer", "sabine").find((m) => m.to.key === "scheduled")?.allowed);
  assert.equal(
    moves({ ...dated, formatNeedsMedia: true }, "reviewer", "sabine").find((m) => m.to.key === "scheduled")?.reason,
    "Choose media first",
  );
  const scheduled = { ...dated, status: "scheduled" };
  assert.equal(moves(scheduled, "reviewer", "sabine").find((m) => m.to.key === "published")?.reason, "Paste the LinkedIn URL first");
  assert.ok(moves({ ...scheduled, linkedinUrl: "https://linkedin.com/x" }, "reviewer", "sabine").find((m) => m.to.key === "published")?.allowed);
  const published = { ...scheduled, status: "published", publishedAt: "2026-11-12T08:30:00Z", linkedinUrl: "https://x" };
  assert.equal(moves(published, "reviewer", "sabine").find((m) => m.to.key === "measured")?.reason, "Fill in the 7 day results first");
  // An admin skipping the flow still needs approval to go live.
  assert.equal(moves({ status: "draft", linkedinUrl: "https://x" }, "admin", "jorn").find((m) => m.to.key === "published")?.reason, "Needs approval first");
});

test("diff: words, a reviewer's edit as separate suggestions", () => {
  assert.deepEqual(diffWords("a b c", "a x c"), [
    { type: "equal", text: "a " },
    { type: "delete", text: "b" },
    { type: "insert", text: "x" },
    { type: "equal", text: " c" },
  ]);
  const original = "Most Dutch companies never try. Here is why.";
  const edited = "Most Dutch scale-ups never try. Here is the reason.";
  const changes = changesBetween(original, edited);
  assert.equal(changes.length, 2);
  assert.deepEqual(changes[0], { start: 11, original: "companies", replacement: "scale-ups" });
  assert.deepEqual(changes[1], { start: 40, original: "why", replacement: "the reason" });
  // Applying them back to front gives the edit.
  let text = original;
  for (const change of [...changes].reverse()) text = applyChange(text, change)!;
  assert.equal(text, edited);
  assert.equal(applyChange("changed text", changes[0]), null, "stale suggestion");
  assert.deepEqual(changesBetween("same", "same"), []);
  assert.deepEqual(changesBetween("", "New text"), [{ start: 0, original: "", replacement: "New text" }]);
  // Neighbouring word changes become one suggestion.
  assert.equal(changesBetween("one two three four", "one 2 3 four").length, 1);
});

test("diff: offsets for the database count characters, not UTF-16 units", () => {
  const text = "🚀 Launch day";
  const jsOffset = text.indexOf("Launch");
  assert.equal(jsOffset, 3);
  assert.equal(toCodePointOffset(text, jsOffset), 2);
  assert.equal(fromCodePointOffset(text, 2), 3);
});

test("linkedin: text, character count and the see more cut", () => {
  assert.equal(linkedInText({ hook: "Hook.", body: "Line one\nLine two\n", closingQuestion: "" }), "Hook.\n\nLine one\nLine two");
  assert.equal(characterCount("🚀ab"), 3);
  const short = seeMoreCut("Short hook", "mobile");
  assert.equal(short.cut, false);
  const long = "Word ".repeat(60);
  const mobile = seeMoreCut(long, "mobile");
  assert.ok(mobile.cut && mobile.visible.length <= 140 && !mobile.visible.endsWith(" "));
  assert.ok(seeMoreCut(long, "desktop").visible.length > mobile.visible.length);
  const lines = seeMoreCut("one\ntwo\nthree\nfour", "desktop");
  assert.deepEqual(lines, { visible: "one\ntwo\nthree", cut: true });
});

test("dates: weeks from Monday, month grid, rhythm and tomorrow's signal", () => {
  assert.equal(weekStart("2026-11-10"), "2026-11-09");
  assert.equal(weekStart("2026-11-15"), "2026-11-09");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(isDay("2026-02-30"), false);
  assert.equal(isDay("2026-02-28"), true);
  const grid = monthGrid("2026-11-10");
  assert.equal(grid[0], "2026-10-26");
  assert.equal(grid.length % 7, 0);
  assert.ok(grid.includes("2026-11-30"));
  const posts = [
    { plannedDate: "2026-11-10", status: "scheduled" },
    { plannedDate: "2026-11-12", status: "parked" },
    { plannedDate: "2026-11-11", status: "draft" },
  ];
  assert.deepEqual(weekRhythm(posts, "2026-11-09", 2), { weekStart: "2026-11-09", planned: 2, goal: 2, onTrack: true });
  assert.equal(weekRhythm(posts, "2026-11-16", 2).onTrack, false);
  assert.deepEqual(unapprovedTomorrow(posts, "2026-11-10"), [posts[2]]);
  assert.equal(bufferState(3, 5, 10), "low");
  assert.equal(bufferState(7, 5, 10), "ok");
  assert.equal(bufferState(11, 5, 10), "full");
});

test("results: due measurements, success and averages", () => {
  const published = "2026-11-01T08:00:00Z";
  assert.deepEqual(dueMeasurements(published, [], new Date("2026-11-02T08:00:00Z")), []);
  assert.deepEqual(dueMeasurements(published, [], new Date("2026-11-03T09:00:00Z")), ["48h"]);
  assert.deepEqual(dueMeasurements(published, ["48h"], new Date("2026-11-09T09:00:00Z")), ["7d"]);
  assert.equal(isSuccess({ likes: 15, comments: 5 }, 20), true);
  assert.equal(isSuccess({ likes: 15, comments: 4 }, 20), false);
  assert.equal(isSuccess(null, 20), null);
  const rows = [
    { angle: "story", result7d: { impressions: 1000, likes: 20, comments: 5 } },
    { angle: "story", result7d: { impressions: null, likes: 10, comments: 0 } },
    { angle: "data", result7d: { impressions: 500, likes: 4, comments: 1 } },
    { angle: "data", result7d: null },
  ];
  const averages = averagesBy(rows, (r) => r.angle, 20);
  assert.deepEqual(averages[0], { key: "story", posts: 2, avgImpressions: 1000, avgEngagement: 17.5, successRate: 50 });
  assert.equal(averages[1].posts, 1);
});

test("settings: modules, options, tags, briefs, extra fields and reuse", () => {
  assert.equal(parseModules({ ideas: false }).ideas, false);
  assert.equal(parseModules(null).results, true);
  assert.equal(optionValue("Reddit / X screenshot"), "reddit_x_screenshot");
  assert.equal(optionValue("Café"), "cafe");
  assert.deepEqual(parseTags("India, hiring  #Story, india"), ["india", "hiring", "story"]);
  assert.deepEqual(parseImageBrief({ what: " Julius ", evil: "x", mood: "" }), { what: "Julius" });
  assert.equal(parseImageBrief("nope"), null);
  const defs = [
    { key: "budget", label: "Budget", type: "number" as const, choices: [], target: null },
    { key: "tone", label: "Tone", type: "single_choice" as const, choices: ["warm", "sharp"], target: null },
    { key: "tags2", label: "Tags", type: "multiple_choice" as const, choices: ["a", "b"], target: null },
    { key: "site", label: "Site", type: "link" as const, choices: [], target: null },
  ];
  const ok = cleanCustomFields(defs, { budget: "12,5", tone: "warm", tags2: ["a", "b", "a"], site: "", other: "x" });
  assert.deepEqual(ok, { values: { budget: 12.5, tone: "warm", tags2: ["a", "b"], site: null }, errors: {} });
  const wrong = cleanCustomFields(defs, { budget: "lots", tone: "loud", site: "example.com" });
  assert.deepEqual(Object.keys(wrong.errors).sort(), ["budget", "site", "tone"]);
  assert.equal(reuseWarning(["2026-08-01"], "2026-11-10", 6), "Used on 2026-08-01, within the last 6 months");
  assert.equal(reuseWarning(["2025-01-01"], "2026-11-10", 6), null);
  assert.equal(reuseWarning(["2026-08-01"], "2026-11-10", 0), null);
});

test("activity log lines name what changed", async () => {
  const { activityText } = await import("@/lib/content/rules");
  assert.equal(activityText("post_edited", { fields: ["hook", "first_comment"] }), "Changed the hook, first comment");
  assert.equal(activityText("status_changed", { from: "in_review", to: "approved" }, (k) => k.toUpperCase()), "IN_REVIEW → APPROVED");
  assert.equal(activityText("results_entered", { likes: 12, comments: 3, reposts: 0, slot: "7d" }), "Results after 7 days: 12 likes, 3 comments, 0 reposts");
  assert.equal(activityText("something_new", {}), "Something new");
});
