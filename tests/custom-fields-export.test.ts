import { test } from "node:test";
import assert from "node:assert/strict";
import type { CustomFieldDefinition } from "@/lib/custom-fields";
import { csvCell, customFieldColumns, exportFileName, toCsv } from "@/lib/custom-fields/export";
import { checkCustomFieldInput, shapeCustomFields } from "@/lib/mcp/custom-field-tools";

function def(key: string, extra: Partial<CustomFieldDefinition> = {}): CustomFieldDefinition {
  return {
    id: `id-${key}`,
    entity: "vacancy",
    key,
    label: key,
    fieldType: "text",
    options: [],
    helpText: null,
    position: 0,
    showInList: false,
    archivedAt: null,
    blockKey: "custom",
    ...extra,
  };
}

// The vacancy from the feedback: New_Test_Role with TEST, Notice period and LinkedIn Profile.
const defs = [
  def("test", { label: "TEST", position: 1 }),
  def("notice_period", { label: "Notice period", fieldType: "single_choice", options: ["1 month", "2 months"], position: 2 }),
  def("linkedin_profile", { label: "LinkedIn Profile", fieldType: "url", position: 3 }),
  def("remote", { label: "Remote", fieldType: "boolean", position: 4 }),
  def("tags", { label: "Tags", fieldType: "multi_choice", options: ["A", "B"], position: 5 }),
  def("old", { label: "Old", archivedAt: "2026-01-01" }),
];
const row = {
  title: "New_Test_Role",
  custom_fields: { test: "=1+1", notice_period: "1 month", linkedin_profile: "https://linkedin.com/in/x", remote: false, tags: ["A", "B"], old: "kept" },
};

test("export: every active custom field is a column, archived ones are not", () => {
  const columns = [{ header: "Title", value: (r: typeof row) => r.title }, ...customFieldColumns<typeof row>(defs, (r) => r.custom_fields, ["Title"])];
  const csv = toCsv(columns, [row]);
  const [header, line] = csv.split("\r\n");
  assert.equal(header, "Title,TEST,Notice period,LinkedIn Profile,Remote,Tags");
  assert.equal(line, `New_Test_Role,'=1+1,1 month,https://linkedin.com/in/x,No,"A; B"`);
});

test("export: clashing headers get a suffix, cells are safe for Excel", () => {
  const columns = customFieldColumns<typeof row>([def("status", { label: "Status" })], (r) => r.custom_fields, ["Status"]);
  assert.equal(columns[0].header, "Status (custom)");
  assert.equal(csvCell(-5), "-5");
  assert.equal(csvCell("-5"), "'-5");
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell(null), "");
  assert.equal(csvCell(true), "Yes");
  assert.equal(exportFileName("Candidates", "2026-11-12"), "nordavo-candidates-2026-11-12.csv");
});

test("MCP: get tools list every active field, lists only the filled ones", () => {
  const full = shapeCustomFields(defs, { test: "x" }, "full");
  assert.deepEqual(
    full.map((f) => [f.label, f.value]),
    [
      ["TEST", "x"],
      ["Notice period", null],
      ["LinkedIn Profile", null],
      ["Remote", null],
      ["Tags", null],
    ],
  );
  assert.deepEqual(shapeCustomFields(defs, row.custom_fields, "compact"), {
    test: "=1+1",
    notice_period: "1 month",
    linkedin_profile: "https://linkedin.com/in/x",
    remote: false,
    tags: ["A", "B"],
  });
  assert.deepEqual(shapeCustomFields(defs, null, "compact"), {});
});

test("MCP: set_custom_fields checks values against the definitions", () => {
  const ok = checkCustomFieldInput(defs, { "Notice period": "2 months", test: null, remote: true });
  assert.deepEqual(ok.errors, {});
  assert.deepEqual(ok.changes, [
    { key: "notice_period", value: "2 months" },
    { key: "test", value: null },
    { key: "remote", value: true },
  ]);
  const bad = checkCustomFieldInput(defs, { notice_period: "3 months", nope: "x", old: "y", linkedin_profile: "not a link" });
  assert.deepEqual(Object.keys(bad.errors).sort(), ["linkedin_profile", "nope", "notice_period", "old"]);
});
