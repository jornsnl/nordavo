import { test } from "node:test";
import assert from "node:assert/strict";
import {
  filterSummary,
  filterToJson,
  isSuppressedFor,
  linkedinUrl,
  parseListFilter,
  safeCsvCell,
  toCsv,
} from "@/lib/gtm/lists";
import { checkOpeningLine, openingLineInput } from "@/lib/ai/prompts/opening-line";

test("parseListFilter reads valid values and ignores the rest", () => {
  assert.deepEqual(parseListFilter({ segment: "saas", signal: "lang_open", tier: "1", min_score: "60", limit: "50" }), {
    segment: "saas",
    signalType: "lang_open",
    tier: 1,
    minScore: 60,
    limit: 50,
  });
  assert.deepEqual(parseListFilter({ segment: "bakkerij", signal: "x", tier: "4", min_score: "abc", limit: "-1" }), { limit: 200 });
  assert.equal(parseListFilter({ limit: "99999" }).limit, 1000);
  assert.equal(parseListFilter({}, 100).limit, 100);
  assert.equal(parseListFilter({ signal_type: "funding" }).signalType, "funding");
  assert.equal(parseListFilter({ segment: ["productie", "saas"] }).segment, "productie");
});

test("filterToJson and filterSummary round-trip for the export history", () => {
  const json = filterToJson({ segment: "saas", signalType: "vacature", tier: 1, minScore: 70, limit: 100 }, { deliver: "sheet" });
  assert.deepEqual(json, { limit: 100, segment: "saas", signal_type: "vacature", tier: 1, min_score: 70, deliver: "sheet" });
  assert.equal(filterSummary(json), "SaaS, Vacancy, tier 1, score 70+, max 100");
  assert.equal(filterSummary({}), "No filter");
  assert.equal(filterSummary(null), "No filter");
});

test("linkedinUrl adds the scheme only when needed", () => {
  assert.equal(linkedinUrl("linkedin.com/in/x"), "https://www.linkedin.com/in/x");
  assert.equal(linkedinUrl("https://linkedin.com/company/acme"), "https://linkedin.com/company/acme");
  assert.equal(linkedinUrl(null), "");
});

test("CSV cells that look like formulas are neutralised, phone numbers are not", () => {
  assert.equal(safeCsvCell("=HYPERLINK(1)"), "'=HYPERLINK(1)");
  assert.equal(safeCsvCell("@cmd"), "'@cmd");
  assert.equal(safeCsvCell("-x"), "'-x");
  assert.equal(safeCsvCell("+31612345678"), "+31612345678");
  assert.equal(safeCsvCell("-5"), "-5");
  assert.equal(safeCsvCell(null), "");
  assert.equal(toCsv(["a", "b"], [["1, 2", null]]), 'a,b\r\n"1, 2",');
});

test("isSuppressedFor mirrors is_suppressed per channel", () => {
  const target = { contactId: "c1", companyId: "co1", email: "Jan@Acme.nl" };
  assert.equal(isSuppressedFor(target, [{ contact_id: "c1", company_id: null, email: null, scope: "alle_kanalen" }], "bellen"), true);
  assert.equal(isSuppressedFor(target, [{ contact_id: null, company_id: "co1", email: null, scope: "alleen_mail" }], "bellen"), false);
  assert.equal(isSuppressedFor(target, [{ contact_id: null, company_id: "co1", email: null, scope: "alleen_bellen" }], "bellen"), true);
  assert.equal(isSuppressedFor(target, [{ contact_id: null, company_id: null, email: "jan@acme.nl", scope: "alle_kanalen" }], "mail"), true);
  assert.equal(isSuppressedFor(target, [{ contact_id: "c2", company_id: "co2", email: null, scope: "alle_kanalen" }], "mail"), false);
});

test("checkOpeningLine blocks claims Nordavo cannot back", () => {
  assert.equal(checkOpeningLine("  Ik zag dat jullie een senior data engineer zoeken.  "), "Ik zag dat jullie een senior data engineer zoeken.");
  assert.equal(checkOpeningLine("Ons eigen team in Bangalore staat klaar."), null);
  assert.equal(checkOpeningLine("Wij zijn 50% goedkoper."), null);
  assert.equal(checkOpeningLine("Eerste zin. Tweede zin."), null);
  assert.equal(checkOpeningLine("Acme B.V. zoekt een developer."), "Acme B.V. zoekt een developer.");
  assert.equal(checkOpeningLine(""), null);
});

test("openingLineInput names exactly one signal", () => {
  const input = openingLineInput({
    companyName: "Acme",
    domain: "acme.nl",
    segment: "saas",
    firstName: "Jan",
    title: "CTO",
    signalType: "lang_open",
    signalTitle: "Senior Python developer",
  });
  assert.match(input, /Signaal \(gebruik alleen dit\): vacature die al langer dan 60 dagen open staat/);
  assert.match(input, /Titel van het signaal: Senior Python developer/);
});
