import { test } from "node:test";
import assert from "node:assert/strict";
import { editDistance, fuzzyFilter, fuzzyScore, normalizeSearch } from "../src/lib/search/fuzzy";
import { pageEntries, searchPages, type MenuSection } from "../src/lib/search/pages";

// The portal menu as in components/dashboard/nav-items (without icons).
const sections: MenuSection[] = [
  { items: [{ label: "Overview", href: "/dashboard" }, { label: "Work (tasks)", href: "/work" }] },
  { label: "Sales", items: [{ label: "Leads", href: "/dashboard/leads" }, { label: "Pipeline", href: "/dashboard/pipeline" }, { label: "Calls", href: "/dashboard/calls" }] },
  { label: "Recruitment", items: [{ label: "Clients", href: "/dashboard/clients" }, { label: "Vacancies", href: "/dashboard/vacancies" }] },
];
import { goTargetFor, isTypingTarget, moveCursor, projectFromPath, shortcutGroups } from "../src/lib/shortcuts";
import { reviewRuleText, statusMoves } from "../src/lib/work/status-moves";
import { bulkDoneText } from "../src/lib/work/bulk";

// ---------------------------------------------------------------------------
// Fuzzy search
// ---------------------------------------------------------------------------

test("fuzzy: normalizes case, accents and punctuation", () => {
  assert.equal(normalizeSearch("  Café-Société B.V. "), "cafe societe b v");
});

test("fuzzy: edit distance counts a swap as one edit", () => {
  assert.equal(editDistance("bright", "brigth"), 1);
  assert.equal(editDistance("kitten", "sitting"), 3);
  assert.equal(editDistance("", "abc"), 3);
});

test("fuzzy: exact, prefix and contains rank above typos", () => {
  const exact = fuzzyScore("Bright Fintech", "Bright Fintech");
  const prefix = fuzzyScore("brig", "Bright Fintech");
  const word = fuzzyScore("fin", "Bright Fintech");
  const typo = fuzzyScore("brigth fintec", "Bright Fintech");
  assert.equal(exact, 1);
  assert.ok(prefix > word);
  assert.ok(word > typo);
  assert.ok(typo > 0.35, `typo should still match, got ${typo}`);
});

test("fuzzy: short words need to be right, long ones may have typos", () => {
  assert.equal(fuzzyScore("xyz", "Bright Fintech"), 0);
  assert.ok(fuzzyScore("vacncies", "Vacancies") > 0.35);
  assert.ok(fuzzyScore("kandidaten", "Candidates") > 0);
  assert.equal(fuzzyScore("zzzzzzz", "Vacancies"), 0);
});

test("fuzzy: filter keeps the best first", () => {
  const items = ["Leads", "Clients", "Call lists", "Calls"];
  assert.deepEqual(fuzzyFilter("cal", items, (s) => s), ["Calls", "Call lists"]);
});

// ---------------------------------------------------------------------------
// Pages in the global search
// ---------------------------------------------------------------------------

test("pages: team members find menu pages, also by Dutch words and with typos", () => {
  const entries = pageEntries({ staff: true, modules: null, sections });
  assert.equal(searchPages("vacatures", entries)[0]?.href, "/dashboard/vacancies");
  assert.equal(searchPages("vacncies", entries)[0]?.href, "/dashboard/vacancies");
  assert.equal(searchPages("pipeline", entries)[0]?.href, "/dashboard/pipeline");
  assert.ok(searchPages("review", entries).some((p) => p.href === "/work?tab=review"));
});

test("pages: modules and Work guests", () => {
  const sales = pageEntries({ staff: true, modules: ["sales"], sections });
  assert.ok(sales.some((p) => p.href === "/dashboard/leads"));
  assert.ok(!sales.some((p) => p.href === "/dashboard/vacancies"));
  const guest = pageEntries({ staff: false, modules: [], sections });
  assert.ok(guest.every((p) => p.href.startsWith("/work")));
  assert.ok(guest.some((p) => p.href === "/work/add"));
});

// ---------------------------------------------------------------------------
// Keyboard shortcuts
// ---------------------------------------------------------------------------

test("shortcuts: g targets, portal ones for the team only", () => {
  assert.equal(goTargetFor("t", false)?.href, "/work");
  assert.equal(goTargetFor("T", true)?.href, "/work");
  assert.equal(goTargetFor("v", true)?.href, "/dashboard/vacancies");
  assert.equal(goTargetFor("v", false), null);
  assert.equal(goTargetFor("z", true), null);
  const keys = shortcutGroups(true, false).find((g) => g.title === "Go to")!.items.map((i) => i.keys[1]);
  assert.equal(new Set(keys).size, keys.length, "every g letter is used once");
});

test("shortcuts: no single letter shortcut while typing", () => {
  assert.equal(isTypingTarget({ tagName: "INPUT", type: "text" }), true);
  assert.equal(isTypingTarget({ tagName: "INPUT", type: "search" }), true);
  assert.equal(isTypingTarget({ tagName: "INPUT", type: "checkbox" }), false);
  assert.equal(isTypingTarget({ tagName: "TEXTAREA" }), true);
  assert.equal(isTypingTarget({ tagName: "SELECT" }), true);
  assert.equal(isTypingTarget({ tagName: "DIV", isContentEditable: true }), true);
  assert.equal(isTypingTarget({ tagName: "BUTTON", closest: () => null }), false);
  assert.equal(isTypingTarget(null), false);
});

test("shortcuts: j/k move within the list", () => {
  assert.equal(moveCursor(-1, 1, 3), 0);
  assert.equal(moveCursor(-1, -1, 3), 2);
  assert.equal(moveCursor(2, 1, 3), 2);
  assert.equal(moveCursor(0, -1, 3), 0);
  assert.equal(moveCursor(0, 1, 0), -1);
});

test("shortcuts: quick add picks the project of the page", () => {
  const id = "0f8fad5b-d9cb-469f-a165-70867728950e";
  assert.equal(projectFromPath(`/work/projects/${id}`), id);
  assert.equal(projectFromPath(`/work/projects/${id.toUpperCase()}/settings`), id);
  assert.equal(projectFromPath("/work"), null);
  assert.equal(projectFromPath(null), null);
});

// ---------------------------------------------------------------------------
// Completing tasks: owners choose between done and review
// ---------------------------------------------------------------------------

const labels = (status: Parameters<typeof statusMoves>[0], can: Parameters<typeof statusMoves>[1]) =>
  statusMoves(status, can).map((m) => `${m.label}>${m.to}`);

test("status: an owner gets Mark as done next to Send to review", () => {
  const owner = { approve: false, complete: true, cancel: false };
  assert.deepEqual(labels("todo", owner), ["Mark as done>done", "Send to review>review", "Start>in_progress"]);
  assert.deepEqual(labels("in_progress", owner), ["Mark as done>done", "Send to review>review", "Back to To do>todo"]);
  // In review the reviewer decides.
  assert.deepEqual(labels("review", owner), ["Pull back from review>in_progress"]);
  assert.deepEqual(labels("done", owner), ["Reopen>in_progress"]);
});

test("status: someone who is not owner or reviewer only sends to review", () => {
  const other = { approve: false, complete: false, cancel: false };
  assert.deepEqual(labels("todo", other), ["Start>in_progress", "Send to review>review"]);
  assert.deepEqual(labels("done", other), []);
  const reviewer = { approve: true, cancel: true };
  assert.deepEqual(labels("review", reviewer), ["Approve>done", "Send back>in_progress", "Cancel task>cancelled"]);
});

test("status: the rule line says what you may do", () => {
  assert.match(reviewRuleText({ approve: false, complete: true, cancel: false }, "Floris"), /mark it as done yourself/);
  assert.match(reviewRuleText({ approve: false, complete: false, cancel: false }, null), /^Reviewer: nobody yet\./);
});

test("bulk: one message for a selection", () => {
  assert.equal(bulkDoneText({ done: 3, review: 0, failed: 0 }), "3 tasks done.");
  assert.equal(bulkDoneText({ done: 1, review: 2, failed: 0 }), "1 task done and 2 sent to review.");
  assert.equal(bulkDoneText({ done: 2, review: 1, failed: 1 }), "2 tasks done, 1 sent to review and 1 could not be changed.");
  assert.equal(bulkDoneText({ done: 0, review: 1, failed: 0 }), "1 task sent to review.");
  assert.equal(bulkDoneText({ done: 0, review: 0, failed: 0 }), "Nothing changed.");
});
