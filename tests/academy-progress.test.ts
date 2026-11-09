import { test } from "node:test";
import assert from "node:assert/strict";
import type { AcademyOutlineRow } from "@/lib/academy/database";
import { BLOCK_TYPES, blockTypes, normalizeCompletion, notesScope } from "@/lib/academy/blocks/types";
import { academyMessages, t } from "@/lib/academy/i18n";
import {
  buildOutline,
  continueTarget,
  courseProgress,
  lessonRequirements,
  moduleOfLesson,
  moduleStateLabel,
  neighbours,
} from "@/lib/academy/progress";

function row(partial: Partial<AcademyOutlineRow> & Pick<AcademyOutlineRow, "module_id" | "module_state">): AcademyOutlineRow {
  return {
    module_title: partial.module_id.toUpperCase(),
    module_description: null,
    module_position: 0,
    module_status: "published",
    release_date: null,
    is_core: false,
    required_before_start: false,
    workbook_document_id: null,
    lesson_id: null,
    lesson_title: null,
    lesson_summary: null,
    lesson_status: "published",
    lesson_position: null,
    duration_minutes: null,
    started_at: null,
    last_viewed_at: null,
    percent: null,
    completed_at: null,
    ...partial,
  };
}

const rows: AcademyOutlineRow[] = [
  row({ module_id: "m1", module_state: "completed", lesson_id: "l1", lesson_title: "One", completed_at: "2026-11-01T10:00:00Z", last_viewed_at: "2026-11-01T10:00:00Z" }),
  row({ module_id: "m1", module_state: "completed", lesson_id: "l2", lesson_title: "Two", completed_at: "2026-11-02T10:00:00Z" }),
  row({ module_id: "m2", module_state: "open", lesson_id: "l3", lesson_title: "Three", percent: 50, last_viewed_at: "2026-11-03T10:00:00Z" }),
  row({ module_id: "m2", module_state: "open", lesson_id: "l4", lesson_title: "Four" }),
  row({ module_id: "m3", module_state: "locked_order", lesson_id: "l5", lesson_title: "Five" }),
  // The same lesson again in a later module.
  row({ module_id: "m4", module_state: "open", lesson_id: "l3", lesson_title: "Three", percent: 50 }),
  row({ module_id: "m5", module_state: "locked_scope", lesson_id: "l6", lesson_title: "Six" }),
  row({ module_id: "m6", module_state: "locked_release", release_date: "2026-12-02" }),
];

test("the outline groups lessons under their modules", () => {
  const modules = buildOutline(rows);
  assert.deepEqual(modules.map((m) => m.id), ["m1", "m2", "m3", "m4", "m5", "m6"]);
  assert.deepEqual(modules[1].lessons.map((l) => l.id), ["l3", "l4"]);
  assert.equal(modules[0].lessons[0].percent, 100);
  assert.equal(modules[5].lessons.length, 0);
});

test("course progress counts each lesson once and skips modules outside scope", () => {
  const progress = courseProgress(buildOutline(rows));
  // l1..l5 in scope (l3 counted once), l6 is outside scope.
  assert.deepEqual(progress, { done: 2, total: 5, percent: 40 });
  assert.deepEqual(courseProgress([]), { done: 0, total: 0, percent: 0 });
});

test("continue where you left off: the last viewed open lesson that is not done", () => {
  const modules = buildOutline(rows);
  assert.equal(continueTarget(modules)?.lessonId, "l3");
  // Nothing viewed yet: the first open lesson that is not done.
  const fresh = buildOutline(rows.map((r) => ({ ...r, last_viewed_at: null })));
  assert.equal(continueTarget(fresh)?.lessonId, "l3");
  const allDone = buildOutline(rows.filter((r) => r.module_id === "m1"));
  assert.equal(continueTarget(allDone), null);
});

test("previous and next skip locked modules", () => {
  const modules = buildOutline(rows);
  const atFour = neighbours(modules, "l4", "m2");
  assert.equal(atFour.previous?.lessonId, "l3");
  // l5 is locked; next open is l3 in m4.
  assert.equal(atFour.next?.lessonId, "l3");
  assert.equal(atFour.next?.moduleId, "m4");
  const atFirst = neighbours(modules, "l1", "m1");
  assert.equal(atFirst.previous, null);
  const inM4 = neighbours(modules, "l3", "m4");
  assert.equal(inM4.previous?.lessonId, "l4");
  assert.equal(inM4.next, null);
  assert.deepEqual(neighbours(modules, "nope"), { previous: null, next: null });
  assert.equal(moduleOfLesson(modules, "l3", "m4")?.id, "m4");
  assert.equal(moduleOfLesson(modules, "l3", "m1")?.id, "m2");
});

test("why a module is closed, in the user's language", () => {
  assert.equal(moduleStateLabel({ state: "locked_release", releaseDate: "2026-12-02" }, "nl", "Europe/Amsterdam"), "Gaat open op 2 december 2026");
  assert.equal(moduleStateLabel({ state: "locked_release", releaseDate: null }, "en", "Asia/Kolkata"), "Opens a while after your start date");
  assert.equal(moduleStateLabel({ state: "locked_order", releaseDate: null }, "en", "Asia/Kolkata"), "Opens after the previous module");
  assert.equal(moduleStateLabel({ state: "completed", releaseDate: null }, "nl", "Asia/Kolkata"), "Afgerond");
});

test("lesson requirements come from the block registry", () => {
  const list = lessonRequirements(
    [
      { id: "b1", type: "video", required: true, completion: { min_percent: 80 } },
      { id: "b2", type: "explanation", required: false, completion: {} },
      { id: "b3", type: "assignment", required: true, completion: { require: "approved" } },
      { id: "b4", type: "knowledge_check", required: true, completion: {} },
    ],
    { b1: true },
    "en",
  );
  assert.deepEqual(
    list.map((r) => [r.text, r.done]),
    [
      ["Watch at least 80% of the video", true],
      ["Have the assignment approved by Nordavo", false],
      ["Do the knowledge check", false],
    ],
  );
  assert.equal(lessonRequirements([{ id: "b1", type: "video", required: true, completion: {} }], new Map(), "nl")[0].text, "Bekijk minstens 90% van de video");
});

test("completion rules are limited to the fields of the type", () => {
  assert.deepEqual(normalizeCompletion("video", { min_percent: 150, evil: true }), { min_percent: 100 });
  assert.deepEqual(normalizeCompletion("video", { min_percent: "75" }), { min_percent: 75 });
  assert.deepEqual(normalizeCompletion("assignment", { require: "approved" }), { require: "approved" });
  assert.deepEqual(normalizeCompletion("assignment", { require: "whatever" }), {});
  assert.deepEqual(normalizeCompletion("explanation", { min_percent: 50 }), {});
  assert.deepEqual(normalizeCompletion("knowledge_check", null), {});
  assert.equal(notesScope({ scope: "module" }), "module");
  assert.equal(notesScope({}), "lesson");
});

test("every block type has labels and requirement texts in both languages", () => {
  assert.equal(BLOCK_TYPES.length, 9);
  for (const type of BLOCK_TYPES) {
    assert.equal(blockTypes[type].type, type);
    for (const locale of ["nl", "en"] as const) {
      assert.ok(t(locale, `block.${type}`).length > 0);
      assert.ok(blockTypes[type].requirement({}, locale).length > 0);
    }
  }
  assert.ok(blockTypes.questionnaire.reserved);
});

test("the dictionaries have the same keys and placeholders", () => {
  const en = academyMessages.en;
  const nl = academyMessages.nl;
  assert.deepEqual(Object.keys(nl).sort(), Object.keys(en).sort());
  for (const key of Object.keys(en) as (keyof typeof en)[]) {
    const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    assert.deepEqual(placeholders(nl[key]), placeholders(en[key]), key);
  }
  assert.equal(t("nl", "home.welcome", { name: "Sabine" }), "Welkom, Sabine");
  assert.equal(t("en", "home.lessonsDone", { done: 2, total: 5 }), "2 of 5 lessons done");
});
