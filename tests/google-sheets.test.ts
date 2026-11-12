import { test } from "node:test";
import assert from "node:assert/strict";
import { parseServiceAccount, serviceAccountStatus, valuesToRows } from "@/lib/integrations/google-sheets";

// Only the read path is left, for the fallback job s8-webpartners-import.

test("valuesToRows turns every cell into a string", () => {
  assert.deepEqual(valuesToRows([["Naam", 3, null], [true]]), [["Naam", "3", ""], ["true"]]);
  assert.deepEqual(valuesToRows(undefined), []);
});

test("parseServiceAccount reads the JSON and unescapes the key", () => {
  const raw = JSON.stringify({ type: "service_account", client_email: "bot@nordavo.iam.gserviceaccount.com", private_key: "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----" });
  const account = parseServiceAccount(raw);
  assert.equal(account.client_email, "bot@nordavo.iam.gserviceaccount.com");
  assert.equal(account.private_key, "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----");
  assert.equal(account.format, "json");
});

// The key file as Google gives it: real JSON escapes ("\n" in the file).
const keyFile = JSON.stringify(
  {
    type: "service_account",
    project_id: "nordavo-portal",
    private_key: "-----BEGIN PRIVATE KEY-----\nMIIEabc\n-----END PRIVATE KEY-----\n",
    client_email: "drive-sync@nordavo-portal.iam.gserviceaccount.com",
  },
  null,
  2,
);

test("parseServiceAccount reads every form the key ends up in", () => {
  const expectKey = "-----BEGIN PRIVATE KEY-----\nMIIEabc\n-----END PRIVATE KEY-----\n";
  const forms: [string, string, "json" | "base64"][] = [
    ["file as is (several lines)", keyFile, "json"],
    ["one line", JSON.stringify(JSON.parse(keyFile)), "json"],
    ["base64", Buffer.from(keyFile).toString("base64"), "base64"],
    ["base64 wrapped at 76", Buffer.from(keyFile).toString("base64").replace(/(.{76})/g, "$1\n"), "base64"],
    ["quoted", `'${JSON.stringify(JSON.parse(keyFile))}'`, "json"],
    ["double encoded", JSON.stringify(JSON.stringify(JSON.parse(keyFile))), "json"],
    ["unescaped newlines in the key", keyFile.replace(/\\n/g, "\n"), "json"],
    ["double escaped newlines", keyFile.replace(/\\n/g, "\\\\n"), "json"],
  ];
  for (const [label, raw, format] of forms) {
    const account = parseServiceAccount(raw);
    assert.equal(account.client_email, "drive-sync@nordavo-portal.iam.gserviceaccount.com", label);
    assert.equal(account.private_key, expectKey, label);
    assert.equal(account.project_id, "nordavo-portal", label);
    assert.equal(account.format, format, label);
  }
});

test("serviceAccountStatus says whether the key is set and readable", () => {
  assert.deepEqual(serviceAccountStatus(undefined).configured, false);
  assert.equal(serviceAccountStatus("  ").configured, false);
  const bad = serviceAccountStatus("not a key");
  assert.equal(bad.configured, true);
  assert.equal(bad.ok, false);
  const good = serviceAccountStatus(keyFile);
  assert.equal(good.ok, true);
  assert.equal(good.ok && good.email, "drive-sync@nordavo-portal.iam.gserviceaccount.com");
  const oauth = serviceAccountStatus(JSON.stringify({ type: "authorized_user", client_email: "x@y", private_key: "-----BEGIN PRIVATE KEY-----" }));
  assert.equal(oauth.ok, false);
  assert.match(!oauth.ok ? oauth.error : "", /not a service account/);
  const notPem = serviceAccountStatus(JSON.stringify({ type: "service_account", client_email: "x@y", private_key: "abc" }));
  assert.match(!notPem.ok ? notPem.error : "", /not a PEM key/);
});

test("parseServiceAccount fails with a clear message", () => {
  assert.throws(() => parseServiceAccount(undefined), /is missing/);
  assert.throws(() => parseServiceAccount("{not json"), /not valid JSON/);
  assert.throws(() => parseServiceAccount(JSON.stringify({ client_email: "x" })), /private_key/);
});
