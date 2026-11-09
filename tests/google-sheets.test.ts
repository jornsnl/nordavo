import { test } from "node:test";
import assert from "node:assert/strict";
import { parseServiceAccount, valuesToRows } from "@/lib/integrations/google-sheets";

// Only the read path is left, for the fallback job s8-webpartners-import.

test("valuesToRows turns every cell into a string", () => {
  assert.deepEqual(valuesToRows([["Naam", 3, null], [true]]), [["Naam", "3", ""], ["true"]]);
  assert.deepEqual(valuesToRows(undefined), []);
});

test("parseServiceAccount reads the JSON and unescapes the key", () => {
  const raw = JSON.stringify({ type: "service_account", client_email: "bot@nordavo.iam.gserviceaccount.com", private_key: "-----BEGIN-----\\nabc\\n-----END-----" });
  const account = parseServiceAccount(raw);
  assert.equal(account.client_email, "bot@nordavo.iam.gserviceaccount.com");
  assert.equal(account.private_key, "-----BEGIN-----\nabc\n-----END-----");
});

test("parseServiceAccount fails with a clear message", () => {
  assert.throws(() => parseServiceAccount(undefined), /is missing/);
  assert.throws(() => parseServiceAccount("{not json"), /not valid JSON/);
  assert.throws(() => parseServiceAccount(JSON.stringify({ client_email: "x" })), /private_key/);
});
