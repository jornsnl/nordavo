import { test } from "node:test";
import assert from "node:assert/strict";
import { t } from "@/lib/academy/i18n";
import {
  assignmentFormats,
  cleanRubric,
  isHttpUrl,
  rubricTotal,
  safeFileName,
  sanitizeAssignmentContent,
  submissionPath,
} from "@/lib/academy/learn/assignment";
import { checkCountWarning, cleanCheckQuestion, parseCheckResult } from "@/lib/academy/learn/check";
import {
  cleanAnswers,
  dimensionKey,
  missingRequired,
  parseQuestionnaire,
  parseQuestionnaireResult,
  questionnaireContent,
  scoreQuestionnaire,
} from "@/lib/academy/learn/questionnaire";
import { cleanTaskInput, countOverdue, openTasks, sortTasks, taskDeadlineText, taskDueState } from "@/lib/academy/learn/tasks";
import { deadlineFromOffset } from "@/lib/academy/time";

// ---------------------------------------------------------------------------
// Assignment
// ---------------------------------------------------------------------------

test("assignment formats: all three by default, known ones only", () => {
  assert.deepEqual(assignmentFormats({}), ["text", "file", "link"]);
  assert.deepEqual(assignmentFormats({ formats: ["link", "bogus", "text"] }), ["text", "link"]);
  assert.deepEqual(assignmentFormats({ formats: [] }), ["text", "file", "link"]);
  assert.deepEqual(sanitizeAssignmentContent({ prompt: "x".repeat(20_000), formats: ["file"], extra: 1 }), {
    prompt: "x".repeat(10_000),
    formats: ["file"],
  });
});

test("rubric: four criteria, whole numbers 1 to 5, total as a share of the maximum", () => {
  assert.deepEqual(cleanRubric({ clarity: 4, proactivity: "3", says_no: 9, english: 2.5, bogus: 5 }), { clarity: 4, proactivity: 3 });
  assert.equal(rubricTotal({}), null);
  assert.equal(rubricTotal({ clarity: 5, proactivity: 5, says_no: 5, english: 5 }), 100);
  assert.equal(rubricTotal({ clarity: 3, proactivity: 2, says_no: 3, english: 4 }), 60);
  // Only scored criteria count.
  assert.equal(rubricTotal({ clarity: 4 }), 80);
});

test("submission files: safe names in the own folder", () => {
  assert.equal(safeFileName("Mijn opdracht (v2).pdf"), "Mijn-opdracht-v2-.pdf");
  assert.equal(safeFileName("../../etc/passwd"), "etc-passwd");
  assert.equal(safeFileName("???"), "file");
  assert.equal(submissionPath("p1", "b1", "a b.docx", "abcd1234"), "academy/submission/p1/b1/abcd1234-a-b.docx");
  assert.ok(isHttpUrl("https://docs.example.com/x"));
  assert.ok(!isHttpUrl("javascript:alert(1)"));
  assert.ok(!isHttpUrl("ftp://x"));
});

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

test("task due state: done, overdue, soon, open, none", () => {
  const now = new Date("2026-11-16T12:00:00Z");
  assert.equal(taskDueState("2026-11-15T00:00:00Z", "2026-11-14T00:00:00Z", now), "done");
  assert.equal(taskDueState("2026-11-15T00:00:00Z", null, now), "overdue");
  assert.equal(taskDueState("2026-11-17T12:00:00Z", null, now), "soon");
  assert.equal(taskDueState("2026-11-30T00:00:00Z", null, now), "open");
  assert.equal(taskDueState(null, null, now), "none");
});

test("tasks sort open first by deadline, without a deadline last, done at the end", () => {
  const rows = [
    { title: "done", due_at: "2026-11-01T00:00:00Z", done_at: "2026-11-01T00:00:00Z" },
    { title: "no deadline", due_at: null, done_at: null },
    { title: "later", due_at: "2026-12-01T00:00:00Z", done_at: null },
    { title: "first", due_at: "2026-11-10T00:00:00Z", done_at: null },
  ];
  assert.deepEqual(sortTasks(rows).map((r) => r.title), ["first", "later", "no deadline", "done"]);
  assert.deepEqual(openTasks(rows).map((r) => r.title), ["first", "later", "no deadline"]);
  assert.equal(countOverdue(rows, new Date("2026-11-20T00:00:00Z")), 1);
});

test("task input: title required, offset clamped, shared means placement only", () => {
  assert.throws(() => cleanTaskInput({ title: "  " }));
  assert.deepEqual(cleanTaskInput({ title: " Calendar ", deadline_offset_days: "7", required: true }), {
    title: "Calendar",
    description: null,
    deadline_offset_days: 7,
    shared: false,
    placement_only: false,
    required: true,
  });
  assert.equal(cleanTaskInput({ title: "x", deadline_offset_days: 99_999 }).deadline_offset_days, 3650);
  assert.equal(cleanTaskInput({ title: "x", deadline_offset_days: "" }).deadline_offset_days, null);
  const shared = cleanTaskInput({ title: "Repo access", shared: true, placement_only: false });
  assert.ok(shared.shared && shared.placement_only);
  assert.equal(cleanTaskInput({ title: "x", required: false }).required, false);
});

test("task deadlines: relative label and the real date in the user's zone (as academy_deadline in SQL)", () => {
  assert.equal(taskDeadlineText(0, "en"), "by day 1");
  assert.equal(taskDeadlineText(13, "nl"), "in week 2");
  assert.equal(taskDeadlineText(null, "en"), null);
  // The SQL test checks the same instants for academy_deadline().
  assert.equal(deadlineFromOffset("2026-11-16", 0, "Asia/Kolkata"), "2026-11-16T18:29:59.000Z");
  assert.equal(deadlineFromOffset("2026-11-16", 7, "Europe/Amsterdam"), "2026-11-23T22:59:59.000Z");
});

// ---------------------------------------------------------------------------
// Knowledge check
// ---------------------------------------------------------------------------

test("check question: options trimmed, the correct one follows, explanation optional", () => {
  assert.throws(() => cleanCheckQuestion({ question: "", options: ["a", "b"], correct_index: 0 }));
  assert.throws(() => cleanCheckQuestion({ question: "Q", options: ["a", ""], correct_index: 0 }), /at least 2/);
  assert.throws(() => cleanCheckQuestion({ question: "Q", options: ["a", "b", ""], correct_index: 2 }), /correct answer/);
  assert.deepEqual(cleanCheckQuestion({ question: " Who decides? ", options: ["", "you", " the team "], correct_index: 2, explanation: " " }), {
    question: "Who decides?",
    options: ["you", "the team"],
    correct_index: 1,
    explanation: null,
  });
  assert.match(checkCountWarning(0) ?? "", /Add three/);
  assert.match(checkCountWarning(2) ?? "", /2 questions/);
  assert.equal(checkCountWarning(3), null);
});

test("check result from the database", () => {
  assert.equal(parseCheckResult(null), null);
  const r = parseCheckResult({
    score: 2,
    max_score: 3,
    percent: 67,
    attempts: 2,
    best_percent: 67,
    saved: true,
    results: [{ question_id: "q1", chosen: 0, correct_index: 1, correct: false, explanation: "Team." }, { bogus: true }],
  });
  assert.ok(r);
  assert.equal(r.percent, 67);
  assert.equal(r.results.length, 1);
  assert.deepEqual(r.results[0], { questionId: "q1", chosen: 0, correctIndex: 1, correct: false, explanation: "Team." });
});

// ---------------------------------------------------------------------------
// Questionnaire
// ---------------------------------------------------------------------------

// The same definition as in supabase/tests/academy_learn.test.sql.
const content = {
  consent_text: "I agree",
  dimensions: [
    { key: "structure", label: "Structure" },
    { key: "social", label: "Social" },
  ],
  questions: [
    { id: "q1", kind: "scale", text: "I plan my week", dimension: "structure" },
    { id: "q2", kind: "scale", text: "I improvise", dimension: "structure", reverse: true },
    { id: "q3", kind: "choice", text: "In a meeting I", options: ["listen", "talk"], option_scores: [2, 5], dimension: "social" },
    { id: "q4", kind: "open", text: "Anything else?", required: false },
  ],
};

test("questionnaire definition: cleaned, unknown dimensions dropped, round trip", () => {
  const def = parseQuestionnaire({
    ...content,
    questions: [
      ...content.questions,
      { id: "q5", kind: "choice", text: "Only one option", options: ["a"] },
      { id: "q1", kind: "weird", text: "Duplicate id", dimension: "nope" },
      { kind: "scale", text: "" },
    ],
  });
  assert.equal(def.questions.length, 5);
  const dup = def.questions[4];
  assert.equal(dup.kind, "scale");
  assert.notEqual(dup.id, "q1");
  assert.equal(dup.dimension, null);
  assert.equal(def.questions[3].required, false);
  assert.equal(def.consentText, "I agree");
  assert.equal(def.showResult, false);
  assert.deepEqual(parseQuestionnaire(questionnaireContent(def)), def);
  assert.equal(dimensionKey("Durft nee te zeggen!"), "durft_nee_te_zeggen");
  assert.match(parseQuestionnaire({}).consentText, /withdraw/);
});

test("questionnaire scoring per dimension (same as academy_questionnaire_score)", () => {
  const def = parseQuestionnaire(content);
  const answers = cleanAnswers(def, { q1: 4, q2: 2, q3: 1, q4: "Nothing", bogus: 3 });
  assert.deepEqual(answers, { q1: 4, q2: 2, q3: 1, q4: "Nothing" });
  assert.deepEqual(scoreQuestionnaire(def, answers), [
    { key: "structure", label: "Structure", score: 4, answered: 2 },
    { key: "social", label: "Social", score: 5, answered: 1 },
  ]);
  assert.deepEqual(scoreQuestionnaire(def, { q1: 3, q2: 3 })[0].score, 3);
  assert.equal(scoreQuestionnaire(def, {})[1].score, null);
  assert.deepEqual(missingRequired(def, { q1: 4 }), ["q2", "q3"]);
  assert.deepEqual(missingRequired(def, { q1: 4, q2: 6, q3: 1 }), ["q2"]);
  assert.deepEqual(cleanAnswers(def, { q1: 0, q3: 2 }), {});
  assert.deepEqual(parseQuestionnaireResult({ dimensions: [{ key: "structure", label: "Structure", score: "3.50", answered: 2 }] }), [
    { key: "structure", label: "Structure", score: 3.5, answered: 2 },
  ]);
  assert.deepEqual(parseQuestionnaireResult({}), []);
});

test("learn texts are in both dictionaries", () => {
  assert.equal(t("en", "check.result", { score: 2, max: 3, percent: 67 }), "You scored 2 of 3 (67%)");
  assert.equal(t("nl", "tasks.due", { date: "16 november 2026" }), "Uiterlijk 16 november 2026");
  assert.equal(t("nl", "assignment.status.approved"), "Goedgekeurd");
});
