import { test } from "node:test";
import assert from "node:assert/strict";
import { enforceRules, QUALIFY_SYSTEM, qualifyInput, qualifySchema, ruleBasedDecision } from "@/lib/ai/prompts/qualify";

const sample = {
  decision: "GO",
  segment: "saas",
  score: 78,
  reason: "SaaS bedrijf met 40 medewerkers en twee open backend vacatures.",
  client_contact_risk: false,
  red_flags: [],
  opening_line: "Ik zag dat jullie al een tijd een senior backend developer zoeken.",
};

test("qualifySchema parses a sample answer", () => {
  assert.deepEqual(qualifySchema.parse(sample), sample);
  assert.equal(qualifySchema.parse({ ...sample, segment: null, decision: "REVIEW" }).segment, null);
});

test("qualifySchema rejects out of range or unknown values", () => {
  assert.throws(() => qualifySchema.parse({ ...sample, score: 120 }));
  assert.throws(() => qualifySchema.parse({ ...sample, decision: "MAYBE" }));
  assert.throws(() => qualifySchema.parse({ ...sample, segment: "consultancy" }));
  const { opening_line: _omit, ...missing } = sample;
  void _omit;
  assert.throws(() => qualifySchema.parse(missing));
});

test("enforceRules: client contact risk is always NO_GO", () => {
  assert.equal(enforceRules({ ...qualifySchema.parse(sample), client_contact_risk: true }).decision, "NO_GO");
  assert.equal(enforceRules(qualifySchema.parse(sample)).decision, "GO");
});

test("ruleBasedDecision: under 5 employees is NO_GO without Claude", () => {
  assert.equal(ruleBasedDecision({ employees: 3 })?.decision, "NO_GO");
  assert.equal(ruleBasedDecision({ employees: 5 }), null);
  assert.equal(ruleBasedDecision({ employees: null }), null);
});

test("system prompt holds the ICP rules and stays free of record data", () => {
  for (const phrase of ["REVIEW", "client_contact_risk", "eenmanszaak", "EU verblijf", "Minder dan 5 medewerkers", "eigen team in Bangalore"]) {
    assert.ok(QUALIFY_SYSTEM.includes(phrase), phrase);
  }
  assert.doesNotMatch(QUALIFY_SYSTEM, /\b20\d\d-\d\d-\d\d\b/);
});

test("qualifyInput says unknowns out loud and includes vacancy text", () => {
  const input = qualifyInput({
    name: "Acme",
    domain: "acme.nl",
    website: null,
    employees: null,
    sector: null,
    legalForm: null,
    city: null,
    linkedinUrl: null,
    signalTypes: ["lang_open"],
    vacancies: [{ title: "Backend Developer", postedAt: "2026-08-01T00:00:00Z", firstSeenAt: null, source: "linkedin", location: "Utrecht", text: "Java en Spring" }],
  });
  assert.match(input, /Omvang \(medewerkers\): onbekend/);
  assert.match(input, /Vacature 1: Backend Developer/);
  assert.match(input, /Geplaatst: 2026-08-01/);
  assert.match(input, /Java en Spring/);
  assert.match(input, /Andere signalen: lang_open/);
});
