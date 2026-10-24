import { test } from "node:test";
import assert from "node:assert/strict";
import { missingFields } from "@/lib/gtm/upsert";

test("missingFields fills gaps and never overwrites", () => {
  const existing = { name: "Acme", sector: null, employees: 0, city: "" };
  const incoming = { name: "ACME BV", sector: "SaaS", employees: 40, city: "Utrecht" };
  assert.deepEqual(missingFields(existing, incoming), { sector: "SaaS", city: "Utrecht" });
});

test("missingFields ignores empty incoming values", () => {
  assert.deepEqual(missingFields({ sector: null }, { sector: "" }), {});
  assert.deepEqual(missingFields({ sector: null }, { sector: undefined }), {});
});
