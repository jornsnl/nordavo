import { test } from "node:test";
import assert from "node:assert/strict";
import type { CustomFieldDefinition } from "@/lib/custom-fields";
import {
  addBlock,
  applyFieldLayout,
  blockLabel,
  blocksForTab,
  coreField,
  fieldBlocks,
  findBlock,
  layoutBlocks,
  moveBlock,
  moveCoreField,
  removeBlock,
  resolveLayout,
  sanitizeLayout,
  toStored,
  updateBlock,
  updateCoreField,
} from "@/lib/custom-fields/layout";

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

test("the default layout is the registry order", () => {
  const layout = resolveLayout("client", {});
  assert.deepEqual(
    layout.blocks.map((b) => b.key),
    layoutBlocks.client.map((b) => b.key),
  );
  assert.equal(blockLabel(layout, "details"), "Details");
  assert.equal(layout.tabs.length, 0);
  assert.ok(layout.blocks.every((b) => b.tab === null));
});

test("stored choices win, unknown blocks and tabs are dropped", () => {
  const stored = sanitizeLayout("candidate", {
    blocks: [
      { key: "documents", label: "  Files  ", column: "main", tab: "contract" },
      { key: "nonsense" },
      { key: "profile", hidden: true, tab: "nope" },
      { key: "b_contract", custom: true, label: "Contract details" },
      { key: "BAD KEY", custom: true },
      { key: "documents", label: "dupe" },
    ],
    fields: { email: { label: "Mail" }, unknown: { label: "x" }, phone: { hidden: true } },
  });
  assert.deepEqual(stored.blocks?.map((b) => b.key), ["documents", "profile", "b_contract"]);
  assert.equal(stored.blocks?.[0].label, "Files");
  assert.equal(stored.blocks?.[1].tab, undefined);
  assert.deepEqual(stored.fields, { email: { label: "Mail" }, phone: { hidden: true } });

  const layout = resolveLayout("candidate", stored);
  assert.equal(layout.blocks[0].key, "documents");
  assert.equal(layout.blocks[0].column, "main");
  assert.equal(layout.blocks[0].tab, "contract");
  assert.equal(findBlock(layout, "profile")?.hidden, true);
  assert.equal(findBlock(layout, "b_contract")?.added, true);
  // Blocks not in the stored order still show, after their default predecessor.
  assert.equal(layout.blocks.length, layoutBlocks.candidate.length + 1);
  const keys = layout.blocks.map((b) => b.key);
  assert.ok(keys.indexOf("custom") === keys.indexOf("profile") + 1);
});

test("broken stored data falls back to the default", () => {
  assert.deepEqual(sanitizeLayout("vacancy", null), {});
  assert.deepEqual(sanitizeLayout("vacancy", "x"), {});
  assert.deepEqual(sanitizeLayout("vacancy", { blocks: "x", fields: [] }), {});
});

test("custom fields go to their block, unknown blocks fall back to Custom fields", () => {
  const stored = { blocks: [{ key: "b_terms", custom: true, label: "Terms" }] };
  const layout = resolveLayout("vacancy", stored, [
    def("notice", { blockKey: "b_terms", position: 2 }),
    def("linkedin", { position: 1 }),
    def("gone", { blockKey: "b_removed", position: 3 }),
    def("old", { archivedAt: "2026-01-01" }),
  ]);
  assert.deepEqual(findBlock(layout, "b_terms")?.customFields.map((d) => d.key), ["notice"]);
  assert.deepEqual(findBlock(layout, "custom")?.customFields.map((d) => d.key), ["linkedin", "gone"]);
  assert.deepEqual(fieldBlocks(layout).map((b) => b.key), ["custom", "b_terms"]);
});

test("tabs: blocks per tab and column", () => {
  const layout = resolveLayout("candidate", { blocks: [{ key: "compensation", tab: "overview" }] });
  const overview = blocksForTab(layout, "overview").map((b) => b.key);
  assert.ok(overview.includes("profile"));
  assert.ok(overview.includes("compensation"));
  assert.ok(!overview.includes("vacancies"));
  assert.deepEqual(
    blocksForTab(layout, "overview", "side").map((b) => b.key),
    ["documents", "compensation"].filter((k) => overview.includes(k)).sort((a, b) => overview.indexOf(a) - overview.indexOf(b)),
  );
  const hidden = updateBlock(layout, "profile", { hidden: true });
  assert.ok(!blocksForTab(hidden, "overview").some((b) => b.key === "profile"));
  // Pages without tabs ignore the tab.
  assert.equal(blocksForTab(resolveLayout("client", {}), "overview").length, layoutBlocks.client.length);
});

test("fixed fields: rename, hide and order apply to the page items", () => {
  let layout = resolveLayout("client", {});
  layout = updateCoreField(layout, "details", "industry", { label: "Sector" });
  layout = updateCoreField(layout, "details", "owner", { hidden: true });
  layout = moveCoreField(layout, "details", "location", "up");
  const items = applyFieldLayout(findBlock(layout, "details"), [
    { key: "website", label: "Website", value: 1 },
    { key: "industry", label: "Industry", value: 2 },
    { key: "location", label: "Location", value: 3 },
    { key: "owner", label: "Owner", value: 4 },
    { key: "extra", label: "Extra", value: 5 },
  ]);
  assert.deepEqual(
    items.map((i) => [i.key, i.label]),
    [
      ["website", "Website"],
      ["location", "Location"],
      ["industry", "Sector"],
      ["extra", "Extra"],
    ],
  );
  // The page's own label stays unless the team renamed the field.
  const vacancy = resolveLayout("vacancy", {});
  const [client] = applyFieldLayout(findBlock(vacancy, "details"), [{ key: "client", label: "Prospect", value: "x" }]);
  assert.equal(client.label, "Prospect");
  assert.deepEqual(coreField(findBlock(layout, "details"), "notes", "Notes"), { label: "Notes", hidden: false });
});

test("toStored keeps only what differs and survives a round trip", () => {
  const base = resolveLayout("placement", {});
  assert.deepEqual(toStored(base).fields, undefined);
  assert.ok(toStored(base).blocks?.every((b) => Object.keys(b).length === 1));

  let layout = moveBlock(base, "checkins", "up");
  layout = updateBlock(layout, "guarantee", { label: "Garantie", column: "main" });
  layout = updateBlock(layout, "academy", { label: "Not renamable" });
  layout = updateCoreField(layout, "details", "monthly_rate", { label: "Rate" });
  const added = addBlock(layout, "Contract", { after: "details" });
  layout = added.layout;
  assert.equal(added.key, "b_contract");
  assert.equal(layout.blocks[1].key, "b_contract");

  const stored = toStored(layout);
  const again = resolveLayout("placement", JSON.parse(JSON.stringify(stored)));
  assert.deepEqual(
    again.blocks.map((b) => [b.key, b.label, b.column]),
    layout.blocks.map((b) => [b.key, b.label, b.column]),
  );
  assert.equal(findBlock(again, "academy")?.label, "Academy");
  assert.equal(coreField(findBlock(again, "details"), "monthly_rate", "Monthly rate").label, "Rate");

  const removed = removeBlock(again, "b_contract");
  assert.equal(findBlock(removed, "b_contract"), undefined);
  // Fixed blocks cannot be removed, only hidden.
  assert.ok(findBlock(removeBlock(again, "details"), "details"));
});

test("an empty name means the original name", () => {
  const layout = updateBlock(resolveLayout("client", {}), "details", { label: "   " });
  assert.equal(blockLabel(layout, "details"), "Details");
  const field = updateCoreField(layout, "details", "website", { label: "" });
  assert.equal(findBlock(field, "details")?.coreFields[0].label, "Website");
});
