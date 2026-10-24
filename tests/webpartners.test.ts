import { test } from "node:test";
import assert from "node:assert/strict";
import {
  companyDomainFromEmail,
  mapHeaders,
  parseApproval,
  parseSheetDate,
  parseWebPartnersRows,
  rowExternalId,
} from "@/lib/gtm/webpartners";

const sheet = [
  ["Datum", "Bedrijf", "Naam contactpersoon", "Telefoonnummer", "E-mail", "Reden van de call", "Goedgekeurd?"],
  ["28-10-2026", "Acme Software BV", "Jan de Vries", "06 12345678", "jan@acme.nl", "Zoekt 2 backend devs", ""],
  ["", "", "", "", "", "", ""],
  ["29/10/2026 14:00", "Beta BV", "Piet Jansen", "+31 20 1234567", "", "Data engineer vacature lang open", "Goedgekeurd"],
  ["2026-10-30", "Gamma", "Klaas", "0612345679", "klaas@gmail.com", "Interesse", "niet goedgekeurd"],
];

test("mapHeaders recognises tolerant Dutch headers", () => {
  const columns = mapHeaders(sheet[0]);
  assert.deepEqual(columns, { date: 0, company: 1, name: 2, phone: 3, email: 4, reason: 5, status: 6 });
});

test("mapHeaders accepts English headers in another order", () => {
  const columns = mapHeaders(["Company", "Phone", "Name", "Status", "Date"]);
  assert.equal(columns.company, 0);
  assert.equal(columns.phone, 1);
  assert.equal(columns.name, 2);
  assert.equal(columns.status, 3);
  assert.equal(columns.date, 4);
});

test("parseSheetDate handles Dutch and ISO formats", () => {
  assert.equal(parseSheetDate("28-10-2026"), "2026-10-28");
  assert.equal(parseSheetDate("1/2/26"), "2026-02-01");
  assert.equal(parseSheetDate("2026-10-30T10:00"), "2026-10-30");
  assert.equal(parseSheetDate("31-02-2026"), null);
  assert.equal(parseSheetDate("morgen"), null);
});

test("parseApproval checks negatives first", () => {
  assert.equal(parseApproval("Goedgekeurd"), "goedgekeurd");
  assert.equal(parseApproval("ja"), "goedgekeurd");
  assert.equal(parseApproval("niet goedgekeurd"), "afgekeurd");
  assert.equal(parseApproval("Afgekeurd"), "afgekeurd");
  assert.equal(parseApproval("nee"), "afgekeurd");
  assert.equal(parseApproval("in afwachting"), null);
  assert.equal(parseApproval(""), null);
});

test("parseWebPartnersRows maps rows and skips empty ones", () => {
  const { rows, missingHeaders } = parseWebPartnersRows(sheet);
  assert.deepEqual(missingHeaders, []);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].rowNumber, 2);
  assert.equal(rows[0].outcome, "afspraak");
  assert.equal(rows[0].reason, "Zoekt 2 backend devs");
  assert.equal(rows[1].rowNumber, 4);
  assert.equal(rows[1].date, "2026-10-29");
  assert.equal(rows[1].outcome, "afspraak_goedgekeurd");
  assert.equal(rows[2].outcome, "afspraak_afgekeurd");
  assert.match(rows[0].externalId, /^webpartners:[0-9a-f]{32}$/);
});

test("external id ignores approval and reason, so a later verdict updates the same activity", () => {
  const before = parseWebPartnersRows([sheet[0], sheet[1]]).rows[0];
  const after = parseWebPartnersRows([sheet[0], [...sheet[1].slice(0, 5), "Andere reden", "goedgekeurd"]]).rows[0];
  assert.equal(before.externalId, after.externalId);
  assert.notEqual(before.outcome, after.outcome);
  // Phone formatting does not change identity.
  assert.equal(
    rowExternalId({ date: "2026-10-28", company: "Acme", name: "Jan", phone: "06 12345678", email: null }),
    rowExternalId({ date: "2026-10-28", company: "acme ", name: "jan", phone: "+31612345678", email: null }),
  );
});

test("parseWebPartnersRows reports missing key headers", () => {
  assert.deepEqual(parseWebPartnersRows([["foo", "bar"], ["x", "y"]]).missingHeaders, ["company", "name", "phone"]);
});

test("companyDomainFromEmail skips free mail", () => {
  assert.equal(companyDomainFromEmail("Jan@Acme.NL"), "acme.nl");
  assert.equal(companyDomainFromEmail("klaas@gmail.com"), null);
  assert.equal(companyDomainFromEmail("geen-mail"), null);
});
