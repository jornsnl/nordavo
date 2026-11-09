import { test } from "node:test";
import assert from "node:assert/strict";
import { applyView, matchesFilter, parseTsv, parseViewConfig, positionBetween, toTsv } from "@/lib/sales/grid";
import { accessorsFor, companyColumns, contactColumns } from "@/lib/sales/rows";

type Row = { id: string; name: string; prio: number | null; city: string | null; pinned_at: string | null; manual_position: number | null; tags: string[] };
const rows: Row[] = [
  { id: "a", name: "Acme", prio: 2, city: "Utrecht", pinned_at: null, manual_position: 3, tags: ["saas"] },
  { id: "b", name: "Bolt", prio: 1, city: "Amsterdam", pinned_at: null, manual_position: 1, tags: [] },
  { id: "c", name: "Cobalt", prio: 2, city: "Amsterdam", pinned_at: "2026-11-01T00:00:00Z", manual_position: 2, tags: ["agency"] },
  { id: "d", name: "Delta", prio: null, city: null, pinned_at: null, manual_position: null, tags: [] },
];
const accessors = {
  name: (r: Row) => r.name,
  prio: (r: Row) => r.prio,
  city: (r: Row) => r.city,
  tags: (r: Row) => r.tags,
};
const ids = (list: Row[]) => list.map((r) => r.id).join("");

test("sorting on several columns, empty cells last, pinned rows on top", () => {
  const out = applyView(rows, { filters: [], sort: [{ column: "prio", dir: "asc" }, { column: "name", dir: "desc" }] }, { accessors, pinnedAt: (r) => r.pinned_at });
  assert.equal(ids(out), "cbad");
  const desc = applyView(rows, { filters: [], sort: [{ column: "prio", dir: "desc" }] }, { accessors });
  assert.equal(desc.at(-1)?.id, "d", "empty sorts last in both directions");
});

test("filters on every column", () => {
  const f = (filters: Parameters<typeof applyView<Row>>[1]["filters"]) => ids(applyView(rows, { filters, sort: [] }, { accessors }));
  assert.equal(f([{ column: "city", op: "equals", value: "amsterdam" }]), "bc");
  assert.equal(f([{ column: "city", op: "empty" }]), "d");
  assert.equal(f([{ column: "prio", op: "lte", value: 1 }]), "b");
  assert.equal(f([{ column: "prio", op: "in", value: ["2", ""] }]), "acd");
  assert.equal(f([{ column: "tags", op: "equals", value: "agency" }]), "c");
  assert.equal(f([{ column: "name", op: "not_contains", value: "o" }]), "ad");
  assert.equal(ids(applyView(rows, { filters: [], sort: [], search: "utr" }, { accessors })), "a");
  assert.equal(matchesFilter("2026-11-05", { column: "x", op: "gt", value: "2026-11-01" }), true);
});

test("manual order follows the dragged positions when no sort is set", () => {
  const out = applyView(rows, { filters: [], sort: [], manualOrder: true }, { accessors, manualPosition: (r) => r.manual_position, defaultSort: [{ column: "name", dir: "desc" }] });
  assert.equal(ids(out), "bcad");
  assert.equal(positionBetween(1024, 2048), 1536);
  assert.equal(positionBetween(null, 1024), 0);
  assert.equal(positionBetween(1024, null), 2048);
});

test("copy and paste with Excel", () => {
  const text = toTsv([["Acme", 'Says "hi"'], ["Line\nbreak", null]]);
  assert.deepEqual(parseTsv(text), [["Acme", 'Says "hi"'], ["Line\nbreak", ""]]);
  assert.deepEqual(parseTsv("a\tb\r\nc\td\r\n"), [["a", "b"], ["c", "d"]]);
});

test("stored views are read defensively", () => {
  const config = parseViewConfig({ filters: [{ column: "x", op: "nope" }, { column: "prio", op: "in", value: ["1"] }], sort: [{ column: "name", dir: "up" }], widths: { name: 5000, prio: 90 }, manualOrder: true, extra: 1 });
  assert.deepEqual(config.filters, [{ column: "prio", op: "in", value: ["1"] }]);
  assert.deepEqual(config.sort, []);
  assert.deepEqual(config.widths, { prio: 90 });
  assert.equal(config.manualOrder, true);
  assert.deepEqual(parseViewConfig(null), { filters: [], sort: [] });
});

test("column parsers validate what is typed or pasted", () => {
  const prio = companyColumns.find((c) => c.key === "prio")!;
  assert.deepEqual(prio.parse!("P2"), { value: 2 });
  assert.ok("error" in prio.parse!("9"));
  const status = companyColumns.find((c) => c.key === "lead_status")!;
  assert.deepEqual(status.parse!("In sequence"), { value: "in_sequence" });
  assert.ok("error" in status.parse!(""));
  const callback = contactColumns.find((c) => c.key === "callback_at")!;
  assert.deepEqual(callback.parse!("30-11-2026"), { value: "2026-11-30" });
  const tier = contactColumns.find((c) => c.key === "tier")!;
  assert.deepEqual(tier.parse!("Tier 2"), { value: 2 });
  assert.equal(Object.keys(accessorsFor(contactColumns)).length, contactColumns.length);
});
