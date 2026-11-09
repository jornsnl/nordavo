import { test } from "node:test";
import assert from "node:assert/strict";
import { BULK_LIMIT, isAcademyRole, isClientRole, nameFromEmail, parseBulkPeople } from "@/lib/academy/people";

test("pasted lines: name and e-mail, e-mail only, angle brackets", () => {
  const result = parseBulkPeople(
    ["Asha Rao, asha@example.in", "ravi.kumar@example.in", "Priya Nair <PRIYA@example.in>", "", "Dev One;dev1@example.in;2026-12-01"].join("\n"),
  );
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.people, [
    { name: "Asha Rao", email: "asha@example.in", startDate: null },
    { name: "Ravi Kumar", email: "ravi.kumar@example.in", startDate: null },
    { name: "Priya Nair", email: "priya@example.in", startDate: null },
    { name: "Dev One", email: "dev1@example.in", startDate: "2026-12-01" },
  ]);
});

test("a CSV with a header row", () => {
  const csv = "Naam,E-mail,Startdatum\nSabine de Vries,sabine@kg.nl,2026-11-16\nJan,jan@kg.nl,\n";
  const result = parseBulkPeople(csv);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.people, [
    { name: "Sabine de Vries", email: "sabine@kg.nl", startDate: "2026-11-16" },
    { name: "Jan", email: "jan@kg.nl", startDate: null },
  ]);
});

test("bad lines and duplicates are reported", () => {
  const result = parseBulkPeople("no address here\nasha@example.in\nAsha <asha@example.in>\nx@y.nl,2026-13\n");
  assert.equal(result.people.length, 1);
  assert.deepEqual(result.errors.map((e) => e.line), [1, 3, 4]);
  assert.deepEqual(parseBulkPeople("   "), { people: [], errors: [] });
});

test("at most the bulk limit", () => {
  const lines = Array.from({ length: BULK_LIMIT + 5 }, (_, i) => `p${i}@example.in`).join("\n");
  const result = parseBulkPeople(lines);
  assert.equal(result.people.length, BULK_LIMIT);
  assert.equal(result.errors.length, 1);
});

test("roles", () => {
  assert.ok(isAcademyRole("client_reader"));
  assert.ok(!isAcademyRole("admin"));
  assert.ok(isClientRole("client_member"));
  assert.ok(!isClientRole("developer"));
  assert.equal(nameFromEmail("asha.rao@example.in"), "Asha Rao");
});
