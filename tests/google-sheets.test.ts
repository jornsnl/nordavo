import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildValueRange,
  columnLetter,
  parseServiceAccount,
  quoteSheetTitle,
  valuesToRows,
  webPartnersShareWith,
} from "@/lib/integrations/google-sheets";

test("columnLetter maps 1-based indexes to A1 letters", () => {
  assert.equal(columnLetter(1), "A");
  assert.equal(columnLetter(8), "H");
  assert.equal(columnLetter(26), "Z");
  assert.equal(columnLetter(27), "AA");
  assert.equal(columnLetter(52), "AZ");
  assert.equal(columnLetter(703), "AAA");
});

test("quoteSheetTitle escapes single quotes", () => {
  assert.equal(quoteSheetTitle("Bellijst"), "'Bellijst'");
  assert.equal(quoteSheetTitle("Julius' lijst"), "'Julius'' lijst'");
});

test("buildValueRange pads short rows, cuts long rows and keeps the header first", () => {
  const body = buildValueRange("Lijst", ["Bedrijf", "Contact", "Telefoon"], [
    ["Acme", "Jan Jansen", "+31612345678"],
    ["Beta", null],
    ["Gamma", "Piet", "+31687654321", "extra"],
  ]);
  assert.equal(body.range, "'Lijst'!A1:C4");
  assert.equal(body.majorDimension, "ROWS");
  assert.deepEqual(body.values, [
    ["Bedrijf", "Contact", "Telefoon"],
    ["Acme", "Jan Jansen", "+31612345678"],
    ["Beta", "", ""],
    ["Gamma", "Piet", "+31687654321"],
  ]);
});

test("buildValueRange with no rows writes only the header", () => {
  assert.equal(buildValueRange("Lijst", ["A", "B"], []).range, "'Lijst'!A1:B1");
});

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
  assert.throws(() => parseServiceAccount(undefined), /ontbreekt/);
  assert.throws(() => parseServiceAccount("{not json"), /geen geldige JSON/);
  assert.throws(() => parseServiceAccount(JSON.stringify({ client_email: "x" })), /private_key/);
});

test("webPartnersShareWith splits and trims the env var", () => {
  const before = process.env.WEBPARTNERS_SHARE_WITH;
  process.env.WEBPARTNERS_SHARE_WITH = " bel@webpartners.nl, ,team@webpartners.nl ,geen-mail";
  assert.deepEqual(webPartnersShareWith(), ["bel@webpartners.nl", "team@webpartners.nl"]);
  if (before === undefined) delete process.env.WEBPARTNERS_SHARE_WITH;
  else process.env.WEBPARTNERS_SHARE_WITH = before;
});
