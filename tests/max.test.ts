import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMaxCsv, MAX_CSV_HEADER, parseMaxCsv, phoneTypeFromText } from "@/lib/gtm/max";
import type { MaxCandidate } from "@/lib/gtm/lists";

const candidate: MaxCandidate = {
  contact_id: "c1",
  company_id: "co1",
  first_name: "Jan",
  last_name: "van der Berg",
  title: "CTO",
  tier: 1,
  linkedin_url: "linkedin.com/in/jvdberg",
  email: null,
  company_name: "Acme, Software",
  domain: "acme.nl",
  website: null,
  company_linkedin: "linkedin.com/company/acme",
  segment: "saas",
  icp_score: 80,
  legal_form: "BV",
};

test("the Max CSV has exactly the agreed columns", () => {
  assert.deepEqual(MAX_CSV_HEADER, ["firstname", "lastname", "company", "website", "company linkedin", "person linkedin"]);
  const csv = buildMaxCsv([candidate]);
  const [header, row] = csv.split("\r\n");
  assert.equal(header, "firstname,lastname,company,website,company linkedin,person linkedin");
  assert.equal(row, 'Jan,van der Berg,"Acme, Software",https://acme.nl,https://www.linkedin.com/company/acme,https://www.linkedin.com/in/jvdberg');
});

test("phoneTypeFromText understands Dutch and English", () => {
  assert.equal(phoneTypeFromText("Mobile"), "mobiel");
  assert.equal(phoneTypeFromText("mobiel"), "mobiel");
  assert.equal(phoneTypeFromText("Landline"), "vast");
  assert.equal(phoneTypeFromText("Direct dial"), "vast");
  assert.equal(phoneTypeFromText(""), null);
});

test("parseMaxCsv normalises LinkedIn and phone, and reads a type column", () => {
  const csv = [
    "﻿firstname,lastname,company,website,company linkedin,person linkedin,phone,phone type",
    "Jan,Berg,Acme,acme.nl,,https://nl.linkedin.com/in/JVDBerg/?trk=x,06 12 34 56 78,",
    "Piet,Smit,Beta,beta.nl,,https://www.linkedin.com/in/psmit,020 123 4567,mobile",
    "Kees,Bos,Gamma,gamma.nl,,https://www.linkedin.com/in/kbos,,",
    "",
  ].join("\n");
  assert.deepEqual(parseMaxCsv(csv), [
    { line: 2, linkedin: "linkedin.com/in/jvdberg", phone: "+31612345678", phoneType: "mobiel" },
    { line: 3, linkedin: "linkedin.com/in/psmit", phone: "+31201234567", phoneType: "mobiel" },
    { line: 4, linkedin: "linkedin.com/in/kbos", phone: null, phoneType: null },
  ]);
});

test("parseMaxCsv accepts other phone column names and infers the type", () => {
  const csv = "Person LinkedIn;Mobile Phone\nhttps://linkedin.com/in/a;+31 20 1234567\n";
  const rows = parseMaxCsv(csv);
  assert.equal(rows[0].phone, "+31201234567");
  assert.equal(rows[0].phoneType, "vast");
});

test("parseMaxCsv fails clearly without the needed columns", () => {
  assert.throws(() => parseMaxCsv("firstname,phone\nJan,0612345678"), /LinkedIn/);
  assert.throws(() => parseMaxCsv("person linkedin,name\nx,y"), /telefoonnummer/);
});
