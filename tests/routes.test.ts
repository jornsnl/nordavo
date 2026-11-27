import { test } from "node:test";
import assert from "node:assert/strict";
import { newRouteSchema, routePatchSchema, sortRoutes, visibleRoutes } from "@/lib/sales/routes";

// Running routes (deel B): standard order, the done filter and the fields.

const r = (name: string, status: string | null, ends_on: string | null) =>
  ({ name, status, ends_on }) as { name: string; status: "planned" | "running" | "paused" | "done" | null; ends_on: string | null };

test("running first, then planned, paused, no status, done; then the end date, empty last", () => {
  const rows = [
    r("Klaar", "done", "2026-01-01"),
    r("Gepland", "planned", null),
    r("Loopt later", "running", "2026-12-31"),
    r("Leeg", null, null),
    r("Loopt open", "running", null),
    r("Loopt eerst", "running", "2026-12-01"),
    r("Pauze", "paused", "2026-12-05"),
  ];
  assert.deepEqual(
    sortRoutes(rows).map((x) => x.name),
    ["Loopt eerst", "Loopt later", "Loopt open", "Gepland", "Pauze", "Leeg", "Klaar"],
  );
});

test("done routes hide by default and show with show done", () => {
  const rows = [r("A", "done", null), r("B", "running", null)];
  assert.deepEqual(visibleRoutes(rows, false).map((x) => x.name), ["B"]);
  assert.deepEqual(visibleRoutes(rows, true).map((x) => x.name), ["B", "A"]);
});

test("a route with only a name is valid; the other fields stay empty", () => {
  const parsed = newRouteSchema.parse({ name: "  Bellijst Noord50  " });
  assert.deepEqual(parsed, { name: "Bellijst Noord50" });
  assert.equal(newRouteSchema.safeParse({ name: "  " }).success, false);
});

test("an end date can be set and cleared again", () => {
  assert.deepEqual(routePatchSchema.parse({ ends_on: "2026-12-31" }), { ends_on: "2026-12-31" });
  assert.deepEqual(routePatchSchema.parse({ ends_on: null }), { ends_on: null });
  assert.equal(routePatchSchema.safeParse({ ends_on: "31-12-2026" }).success, false);
  assert.deepEqual(routePatchSchema.parse({ note: "  " }), { note: null });
  assert.equal(routePatchSchema.safeParse({ status: "bezig" }).success, false);
  assert.equal(routePatchSchema.safeParse({ company_count: -1 }).success, false);
});
