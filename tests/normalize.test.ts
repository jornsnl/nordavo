import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isExcludedFromCalling,
  normalizeDomain,
  normalizeEmail,
  normalizeLinkedin,
  normalizePhone,
  phoneTypeFor,
  signalDedupeKey,
  splitName,
} from "@/lib/gtm/normalize";

test("normalizeDomain strips protocol, www, path and port", () => {
  assert.equal(normalizeDomain("https://www.Example.NL/jobs?x=1"), "example.nl");
  assert.equal(normalizeDomain("example.nl:8080"), "example.nl");
  assert.equal(normalizeDomain("sub.example.nl/"), "sub.example.nl");
  assert.equal(normalizeDomain(""), null);
  assert.equal(normalizeDomain(null), null);
});

test("normalizeLinkedin matches the SQL function", () => {
  assert.equal(normalizeLinkedin("https://nl.linkedin.com/in/Jan-Jansen/?trk=x"), "linkedin.com/in/jan-jansen");
  assert.equal(normalizeLinkedin("linkedin.com/in/x///"), "linkedin.com/in/x");
  assert.equal(normalizeLinkedin("https://www.linkedin.com/company/acme/"), "linkedin.com/company/acme");
});

test("normalizeEmail", () => {
  assert.equal(normalizeEmail("  JAN@Acme.nl "), "jan@acme.nl");
  assert.equal(normalizeEmail("geen-mail"), null);
});

test("normalizePhone and phoneTypeFor", () => {
  assert.equal(normalizePhone("06 12 34 56 78"), "+31612345678");
  assert.equal(normalizePhone("0031 20 123 4567"), "+31201234567");
  assert.equal(normalizePhone("+91 98765 43210"), "+919876543210");
  assert.equal(normalizePhone("123"), null);
  assert.equal(phoneTypeFor("+31612345678"), "mobiel");
  assert.equal(phoneTypeFor("+31201234567"), "vast");
  assert.equal(phoneTypeFor("+919876543210"), null);
});

test("isExcludedFromCalling catches eenmanszaak and vof", () => {
  assert.equal(isExcludedFromCalling("Eenmanszaak"), true);
  assert.equal(isExcludedFromCalling("V.O.F."), true);
  assert.equal(isExcludedFromCalling("Vennootschap onder firma"), true);
  assert.equal(isExcludedFromCalling("BV"), false);
  assert.equal(isExcludedFromCalling(null), false);
});

test("splitName keeps Dutch prefixes in the last name", () => {
  assert.deepEqual(splitName("Jan van der Berg"), { first: "Jan", last: "van der Berg" });
  assert.deepEqual(splitName("Priya"), { first: "Priya", last: null });
});

test("signalDedupeKey prefers the URL and ignores tracking", () => {
  const a = signalDedupeKey({ source: "linkedin", sourceUrl: "https://www.linkedin.com/jobs/view/123/?trk=a", companyDomain: "x.nl" });
  const b = signalDedupeKey({ source: "linkedin", sourceUrl: "https://www.linkedin.com/jobs/view/123", companyDomain: "x.nl" });
  assert.equal(a, b);
  assert.equal(
    signalDedupeKey({ source: "indeed", companyDomain: "x.nl", title: "Senior  React Dev" }),
    "indeed:x.nl:senior react dev",
  );
});
