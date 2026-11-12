import { test } from "node:test";
import assert from "node:assert/strict";
import {
  likeExact,
  MANUAL_SOURCE,
  manualContactRow,
  parseLinkedinCompany,
  parseLinkedinProfile,
  parseWebsite,
} from "@/lib/gtm/manual";

test("parseWebsite turns a URL or bare domain into the normalised domain and a website", () => {
  assert.deepEqual(parseWebsite("https://www.Acme.nl/about?x=1"), {
    domain: "acme.nl",
    website: "https://www.Acme.nl/about?x=1",
  });
  assert.deepEqual(parseWebsite("  acme.nl "), { domain: "acme.nl", website: "https://acme.nl" });
  assert.deepEqual(parseWebsite("www.app.acme.co.uk/"), { domain: "app.acme.co.uk", website: "https://www.app.acme.co.uk/" });
  assert.deepEqual(parseWebsite("http://acme.io:8080"), { domain: "acme.io", website: "http://acme.io:8080" });
});

test("parseWebsite takes the domain of a pasted email address", () => {
  assert.deepEqual(parseWebsite("jan@Acme.nl"), { domain: "acme.nl", website: "https://acme.nl" });
});

test("parseWebsite rejects values without a usable domain", () => {
  for (const value of ["", "   ", "acme", "localhost", "acme .nl", "ftp://acme.nl", "-acme.nl", "acme.n1", "https://", null, undefined]) {
    assert.equal(parseWebsite(value), null, String(value));
  }
});

test("parseWebsite agrees with the SQL normalize_domain on the key", () => {
  // Same lead whatever form the domain is typed in.
  const forms = ["acme.nl", "ACME.NL", "https://acme.nl", "https://www.acme.nl/", "www.acme.nl/jobs#open"];
  assert.deepEqual(new Set(forms.map((f) => parseWebsite(f)?.domain)), new Set(["acme.nl"]));
});

test("parseLinkedinProfile only accepts personal profiles", () => {
  assert.equal(parseLinkedinProfile("https://nl.linkedin.com/in/Jane-Doe/?trk=x"), "https://www.linkedin.com/in/Jane-Doe");
  assert.equal(parseLinkedinProfile("linkedin.com/company/acme"), null);
  assert.equal(parseLinkedinProfile("https://example.com/in/jane"), null);
  assert.equal(parseLinkedinProfile("linkedin.com/in/"), null);
});

test("parseLinkedinCompany only accepts company pages", () => {
  assert.equal(parseLinkedinCompany("https://www.linkedin.com/company/Acme/"), "https://www.linkedin.com/company/Acme");
  assert.equal(parseLinkedinCompany("linkedin.com/in/jane-doe"), null);
});

const NOW = "2026-11-07T10:00:00.000Z";
const COMPANY = "00000000-0000-4000-8000-000000000001";

test("manualContactRow fills source and dates on email and phone", () => {
  const result = manualContactRow(
    COMPANY,
    {
      first_name: " Jane ",
      last_name: "Doe",
      title: "CTO",
      tier: 1,
      email: "Jane@Acme.NL",
      phone: "06 1234 5678",
      linkedin_url: "https://www.linkedin.com/in/jane-doe/",
    },
    NOW,
  );
  assert.ok(result.ok);
  assert.deepEqual(result.row, {
    company_id: COMPANY,
    first_name: "Jane",
    last_name: "Doe",
    title: "CTO",
    tier: 1,
    linkedin_url: "https://www.linkedin.com/in/jane-doe",
    email: "jane@acme.nl",
    email_source: MANUAL_SOURCE,
    email_found_at: NOW,
    email_status: "unknown",
    phone: "+31612345678",
    phone_source: MANUAL_SOURCE,
    phone_found_at: NOW,
    phone_type: "mobiel",
    source: "manual",
    sources: ["manual"],
  });
});

test("manualContactRow leaves email and phone metadata empty without values", () => {
  const result = manualContactRow(COMPANY, { last_name: "Doe" }, NOW);
  assert.ok(result.ok);
  assert.equal(result.row.first_name, null);
  assert.equal(result.row.email_source, null);
  assert.equal(result.row.email_status, null);
  assert.equal(result.row.phone_type, null);
  assert.equal(result.row.tier, null);
});

test("manualContactRow reports every invalid field", () => {
  const result = manualContactRow(COMPANY, { email: "not-an-email", phone: "12", linkedin_url: "linkedin.com/company/acme" }, NOW);
  assert.ok(!result.ok);
  assert.deepEqual(Object.keys(result.fieldErrors).sort(), ["email", "first_name", "linkedin_url", "phone"]);
});

test("likeExact escapes LIKE wildcards", () => {
  assert.equal(likeExact("jan_de_vries@acme.nl"), "jan\\_de\\_vries@acme.nl");
  assert.equal(likeExact("100%"), "100\\%");
});
