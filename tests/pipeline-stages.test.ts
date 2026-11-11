import { test } from "node:test";
import assert from "node:assert/strict";
import { companyFieldsSchema } from "@/lib/mcp/sales-tools";
import { isOpenStage, pipelineExits, pipelineFlow, pipelineStages } from "@/lib/sales/labels";
import { daysOpen, pipelineColumns, vacancySummary } from "@/lib/sales/rows";

test("the pipeline has 9 stages in order, with Lost and Parked apart", () => {
  assert.deepEqual(
    pipelineFlow.map((s) => s.value),
    ["contact", "interested", "meeting_planned", "meeting_held", "vacancy_drafted", "agreed_paid", "profiles_sent", "candidate_interviews", "won"],
  );
  assert.deepEqual(pipelineExits.map((s) => s.value), ["lost", "parked"]);
  assert.equal(pipelineStages.length, 11);
});

test("isOpenStage leaves out won, lost, parked and no stage", () => {
  assert.equal(isOpenStage("contact"), true);
  assert.equal(isOpenStage("agreed_paid"), true);
  for (const s of ["won", "lost", "parked", null] as const) assert.equal(isOpenStage(s), false);
});

test("vacancySummary lists the roles with the days they are open", () => {
  const now = Date.parse("2026-11-11T12:00:00Z");
  assert.equal(vacancySummary([], now), null);
  assert.equal(
    vacancySummary([
      { id: "a", title: "Java developer", openedAt: "2026-10-30" },
      { id: "b", title: "Data engineer", openedAt: "2026-11-11" },
    ], now),
    "Java developer (12d), Data engineer (0d)",
  );
  assert.equal(daysOpen(null, now), null);
});

test("the pipeline table shows vacancies, the profiles date and the parked date", () => {
  const keys = pipelineColumns.map((c) => c.key);
  for (const k of ["open_vacancies_count", "open_vacancies", "profiles_due_on", "parked_until", "lost_reason"]) {
    assert.ok(keys.includes(k), k);
  }
  const parked = pipelineColumns.find((c) => c.key === "parked_until")!;
  assert.deepEqual(parked.parse?.("01-03-2030"), { value: "2030-03-01" });
});

test("Claude parks a company only with a date", () => {
  assert.equal(companyFieldsSchema.safeParse({ pipeline_stage: "parked" }).success, false);
  assert.equal(companyFieldsSchema.safeParse({ pipeline_stage: "parked", parked_until: "2030-03-01" }).success, true);
  assert.equal(companyFieldsSchema.safeParse({ pipeline_stage: "contact" }).success, true);
  assert.equal(companyFieldsSchema.safeParse({ pipeline_stage: "intake_done" }).success, false);
});
