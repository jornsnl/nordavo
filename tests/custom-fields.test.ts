import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyListFilters,
  compareValues,
  customFieldErrorMessage,
  filtersFromParams,
  formatValue,
  keyFromLabel,
  matchesFilter,
  parseFormValue,
  parseOptions,
  sortFromParams,
  validateDefinition,
  validateValue,
  type CustomFieldDefinition,
  type CustomFieldType,
  type CustomFieldValues,
} from "@/lib/custom-fields";

function def(fieldType: CustomFieldType, extra: Partial<CustomFieldDefinition> = {}): CustomFieldDefinition {
  return {
    id: `id-${fieldType}`,
    entity: "candidate",
    key: extra.key ?? fieldType,
    label: extra.label ?? fieldType,
    fieldType,
    options: extra.options ?? [],
    helpText: null,
    position: 0,
    showInList: true,
    archivedAt: null,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Values, the same rules as public.validate_custom_fields
// ---------------------------------------------------------------------------

test("empty values clear the field", () => {
  for (const type of ["text", "number", "multi_choice", "boolean"] as const) {
    for (const empty of [null, undefined, "", []]) {
      assert.deepEqual(validateValue(def(type), empty), { ok: true, value: null });
    }
  }
});

test("text and long text have a maximum length", () => {
  assert.equal(validateValue(def("text"), "30 days").ok, true);
  assert.equal(validateValue(def("text"), "x".repeat(501)).ok, false);
  assert.equal(validateValue(def("long_text"), "x".repeat(10_000)).ok, true);
  assert.equal(validateValue(def("long_text"), "x".repeat(10_001)).ok, false);
  assert.equal(validateValue(def("text"), 12).ok, false);
});

test("numbers must be finite json numbers", () => {
  assert.deepEqual(validateValue(def("number"), 24.5), { ok: true, value: 24.5 });
  assert.equal(validateValue(def("number"), "24").ok, false);
  assert.equal(validateValue(def("number"), Number.NaN).ok, false);
  assert.equal(validateValue(def("number"), Infinity).ok, false);
});

test("dates must be real calendar days in YYYY-MM-DD", () => {
  assert.equal(validateValue(def("date"), "2027-01-15").ok, true);
  assert.equal(validateValue(def("date"), "2028-02-29").ok, true);
  assert.equal(validateValue(def("date"), "2026-02-30").ok, false);
  assert.equal(validateValue(def("date"), "15-01-2027").ok, false);
  assert.equal(validateValue(def("date"), "2027-1-5").ok, false);
});

test("yes/no takes booleans only", () => {
  assert.deepEqual(validateValue(def("boolean"), false), { ok: true, value: false });
  assert.equal(validateValue(def("boolean"), "yes").ok, false);
});

test("choices must be options, multiple choice each once", () => {
  const tier = def("single_choice", { options: ["A", "B"] });
  assert.equal(validateValue(tier, "A").ok, true);
  assert.equal(validateValue(tier, "a").ok, false);
  assert.equal(validateValue(tier, ["A"]).ok, false);
  const tools = def("multi_choice", { options: ["dbt", "Spark"] });
  assert.deepEqual(validateValue(tools, ["dbt", "Spark"]), { ok: true, value: ["dbt", "Spark"] });
  assert.equal(validateValue(tools, ["dbt", "dbt"]).ok, false);
  assert.equal(validateValue(tools, ["Airflow"]).ok, false);
  assert.equal(validateValue(tools, "dbt").ok, false);
});

test("links must be http or https", () => {
  assert.equal(validateValue(def("url"), "https://github.com/asha").ok, true);
  assert.equal(validateValue(def("url"), "http://example.com/a?b=c").ok, true);
  assert.equal(validateValue(def("url"), "ftp://example.com").ok, false);
  assert.equal(validateValue(def("url"), "javascript:alert(1)").ok, false);
  assert.equal(validateValue(def("url"), "https://exa mple.com").ok, false);
  assert.equal(validateValue(def("url"), `https://example.com/${"x".repeat(2000)}`).ok, false);
});

// ---------------------------------------------------------------------------
// Form values
// ---------------------------------------------------------------------------

test("parseFormValue reads what the form controls send", () => {
  assert.deepEqual(parseFormValue(def("number"), ["24,5"]), { ok: true, value: 24.5 });
  assert.deepEqual(parseFormValue(def("number"), [" 1 200 "]), { ok: true, value: 1200 });
  assert.equal(parseFormValue(def("number"), ["lots"]).ok, false);
  assert.deepEqual(parseFormValue(def("number"), [""]), { ok: true, value: null });
  assert.deepEqual(parseFormValue(def("boolean"), ["yes"]), { ok: true, value: true });
  assert.deepEqual(parseFormValue(def("boolean"), ["no"]), { ok: true, value: false });
  assert.deepEqual(parseFormValue(def("boolean"), [""]), { ok: true, value: null });
  assert.deepEqual(parseFormValue(def("url"), ["github.com/asha"]), { ok: true, value: "https://github.com/asha" });
  assert.equal(parseFormValue(def("url"), ["ftp://x.org"]).ok, false);
  assert.deepEqual(parseFormValue(def("multi_choice", { options: ["a", "b"] }), ["b", "a"]), { ok: true, value: ["b", "a"] });
  assert.deepEqual(parseFormValue(def("multi_choice", { options: ["a"] }), []), { ok: true, value: null });
  assert.deepEqual(parseFormValue(def("text"), ["  30 days  "]), { ok: true, value: "30 days" });
  assert.deepEqual(parseFormValue(def("long_text"), ["line 1\r\nline 2\n"]), { ok: true, value: "line 1\nline 2" });
});

test("formatValue shows values and marks removed options", () => {
  assert.equal(formatValue(def("boolean"), true), "Yes");
  assert.equal(formatValue(def("boolean"), false), "No");
  assert.equal(formatValue(def("date"), "2027-01-15"), "15 Jan 2027");
  assert.equal(formatValue(def("number"), 1200.5), "1,200.5");
  assert.equal(formatValue(def("single_choice", { options: ["A"] }), "B"), "B (removed option)");
  assert.equal(formatValue(def("multi_choice", { options: ["dbt"] }), ["dbt", "Hive"]), "dbt, Hive (removed option)");
  assert.equal(formatValue(def("text"), undefined), "");
});

// ---------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------

test("keyFromLabel makes a unique database key", () => {
  assert.equal(keyFromLabel("Expected salary (LPA)"), "expected_salary_lpa");
  assert.equal(keyFromLabel("Één keer"), "een_keer");
  assert.equal(keyFromLabel("2nd interview"), "f_2nd_interview");
  assert.equal(keyFromLabel("!!!"), "field");
  assert.equal(keyFromLabel("Tier", ["tier", "tier_2"]), "tier_3");
  assert.match(keyFromLabel("x".repeat(100)), /^[a-z][a-z0-9_]{0,39}$/);
});

test("parseOptions: one per line or comma separated, no duplicates", () => {
  assert.deepEqual(parseOptions(" A \nB\n\nC "), { options: ["A", "B", "C"] });
  assert.deepEqual(parseOptions("dbt, Airflow"), { options: ["dbt", "Airflow"] });
  assert.ok(parseOptions("A\nA").error);
  assert.ok(parseOptions("x".repeat(81)).error);
});

test("validateDefinition checks name, type and options", () => {
  const ok = validateDefinition({ entity: "candidate", label: " Tier ", field_type: "single_choice", options: "A\nB", show_in_list: "on" });
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.value.label, "Tier");
    assert.deepEqual(ok.value.options, ["A", "B"]);
    assert.equal(ok.value.showInList, true);
  }
  const noOptions = validateDefinition({ entity: "candidate", label: "Tier", field_type: "multi_choice", options: "" });
  assert.equal(noOptions.ok, false);
  if (!noOptions.ok) assert.ok(noOptions.errors.options);
  const bad = validateDefinition({ entity: "placement", label: "", field_type: "rating" });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.deepEqual(Object.keys(bad.errors).sort(), ["entity", "field_type", "label"]);
  const text = validateDefinition({ entity: "vacancy", label: "Budget", field_type: "number", options: "ignored" });
  assert.equal(text.ok && text.value.options.length, 0);
});

test("customFieldErrorMessage keeps database checks readable", () => {
  assert.equal(customFieldErrorMessage({ code: "22023", message: '"Tier" takes one of its options' }), '"Tier" takes one of its options');
  assert.equal(customFieldErrorMessage({ code: "42501", message: "Only an admin can archive or restore a field" }), "Only an admin can archive or restore a field.");
  assert.equal(customFieldErrorMessage({ code: "23505", message: "duplicate key" }), "A field with this name already exists. Choose another name.");
  assert.equal(customFieldErrorMessage({ code: "XX000", message: "internal detail" }), "Saving did not work. Try again.");
});

// ---------------------------------------------------------------------------
// List filter and sort
// ---------------------------------------------------------------------------

const salary = def("number", { key: "salary", label: "Salary" });
const tier = def("single_choice", { key: "tier", label: "Tier", options: ["A", "B", "C"] });
const relocate = def("boolean", { key: "relocate", label: "Relocate" });
const notice = def("text", { key: "notice", label: "Notice" });
const start = def("date", { key: "start", label: "Start" });

test("matchesFilter per type", () => {
  assert.ok(matchesFilter(salary, 25, ">=20"));
  assert.ok(!matchesFilter(salary, 15, ">=20"));
  assert.ok(matchesFilter(salary, 20, "20"));
  assert.ok(matchesFilter(salary, 19.5, "<19,9"));
  assert.ok(!matchesFilter(salary, 20, "twenty"));
  assert.ok(matchesFilter(tier, "B", "B"));
  assert.ok(!matchesFilter(tier, "A", "B"));
  assert.ok(matchesFilter(relocate, false, "no"));
  assert.ok(!matchesFilter(relocate, undefined, "no"));
  assert.ok(matchesFilter(notice, "30 Days", "days"));
  assert.ok(matchesFilter(start, "2027-02-01", ">=2027-01-01"));
  assert.ok(matchesFilter(start, "2027-02-01", "2027-02"));
  assert.ok(matchesFilter(def("multi_choice", { options: ["dbt"] }), ["dbt"], "dbt"));
  assert.ok(matchesFilter(notice, undefined, "none"));
  assert.ok(!matchesFilter(notice, "x", "none"));
  assert.ok(matchesFilter(notice, "x", "any"));
});

test("compareValues: numbers numeric, choices in option order, empty last", () => {
  assert.ok(compareValues(salary, 9, 10) < 0);
  assert.ok(compareValues(tier, "C", "A") > 0);
  assert.ok(compareValues(notice, undefined, "a") > 0);
  assert.ok(compareValues(notice, "item 2", "item 10") < 0);
});

test("applyListFilters filters and sorts rows, empty values stay last", () => {
  const rows = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
  const values = new Map<string, CustomFieldValues>([
    ["a", { salary: 30, tier: "B" }],
    ["b", { salary: 10, tier: "A" }],
    ["c", { tier: "A" }],
    ["d", { salary: 20, tier: "C" }],
  ]);
  const params = { cf_tier: "A", sort: "cf_salary", dir: "desc" };
  const filters = filtersFromParams([salary, tier], params);
  assert.equal(filters.length, 1);
  assert.deepEqual(applyListFilters(rows, values, filters, sortFromParams([salary, tier], params)).map((r) => r.id), ["b", "c"]);

  const asc = sortFromParams([salary], { sort: "cf_salary" });
  assert.deepEqual(applyListFilters(rows, values, [], asc).map((r) => r.id), ["b", "d", "a", "c"]);
  const desc = sortFromParams([salary], { sort: "cf_salary", dir: "desc" });
  assert.deepEqual(applyListFilters(rows, values, [], desc).map((r) => r.id), ["a", "d", "b", "c"]);
  assert.equal(sortFromParams([salary], { sort: "cf_unknown" }), null);
  assert.deepEqual(applyListFilters(rows, values, [], null).map((r) => r.id), ["a", "b", "c", "d"]);
});

test("filtersFromParams ignores empty values and unknown fields", () => {
  assert.deepEqual(filtersFromParams([salary], { cf_salary: "  ", cf_other: "x" }), []);
  assert.equal(filtersFromParams([salary], { cf_salary: ["<5", ">9"] })[0].value, "<5");
});
