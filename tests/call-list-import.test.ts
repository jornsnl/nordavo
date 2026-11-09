import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dedupeContacts,
  domainFrom,
  historyExternalId,
  linkedinKind,
  matchHeader,
  parseCallList,
  parseCallOutcome,
  parseCategory,
  parseContactStatus,
  parsePrio,
  type Sheet,
} from "@/lib/sales/call-list-import";
import { parseRoute } from "@/lib/sales/labels";

const bellen: Sheet = {
  sheet: "Bellen",
  data: [
    ["Nordavo bellijst"],
    ["Prio", "Bedrijf", "Categorie", "Wat het bedrijf doet", "Sector", "Medewerkers", "Plaats", "Website", "LinkedIn bedrijf", "Algemeen nummer", "Rode vlaggen", "Openingszin", "Opmerking bron", "Contactpersoon", "Functie", "Tier", "Route", "Mobiel", "Mailadres", "LinkedIn persoon", "Status", "Pogingen", "Laatste poging", "Doorverwezen naar", "Notitie beller"],
    [1, "Impaqt Software", "Development", "Builds SaaS", "Software", "45", "Utrecht", "https://www.impaqt.nl/", "linkedin.com/company/impaqt", "030 1234567", "Agency; Uses freelancers", "Saw your Python vacancy", "Apify", "Anna de Boer", "CTO", "Tier 1", "Mobile", "+31612345678", "anna@impaqt.nl", "https://nl.linkedin.com/in/annadeboer", "Geen gehoor", 2, new Date("2026-11-02T10:00:00Z"), null, "Call after 10"],
    [1, "Impaqt Software", null, null, null, null, null, "impaqt.nl", null, null, null, null, null, "Bert Jansen", "Head of Data", 2, null, null, "bert@impaqt.nl", null, "Nieuw", 0, null, null, null],
    [2, "No Site BV", "Data & BI", null, null, null, "Gouda", null, null, null, null, null, null, "Cees", "Owner", "3", null, null, null, null, null, null, null, null, null],
  ],
};
const overig: Sheet = {
  sheet: "Overige contacten",
  data: [
    ["Bedrijf", "Website", "Contactpersoon", "Functie", "Rol", "Mailadres"],
    ["Impaqt Software", "impaqt.nl", "Dirk Dev", "Lead developer", "Reserve", "dirk@impaqt.nl"],
    ["Impaqt Software", "impaqt.nl", "Anna de Boer", "CTO", "Extra", "anna@impaqt.nl"],
  ],
};
const vacatures: Sheet = {
  sheet: "Vacatures",
  data: [
    ["Bedrijf", "Website", "Vacature", "Rolgroep", "Datum online", "Dagen open", "Bron", "Link"],
    ["Impaqt Software", "impaqt.nl", "Senior Python developer", "Backend", "2026-10-01", 39, "LinkedIn", "https://linkedin.com/jobs/1"],
    ["Unknown Corp", null, "Data engineer", "Data", null, 10, "Indeed", null],
  ],
};
const verrijken: Sheet = {
  sheet: "Nog verrijken",
  data: [
    ["Bedrijf", "Website", "Contactpersoon", "Functie", "LinkedIn persoon"],
    ["No Site BV", null, "Eva Bakker", "CTO", "linkedin.com/in/evabakker"],
  ],
};

test("helpers read the Excel values", () => {
  assert.equal(domainFrom("https://www.Impaqt.nl/jobs"), "impaqt.nl");
  assert.equal(domainFrom("not a site"), null);
  assert.equal(parsePrio("P2"), 2);
  assert.equal(parsePrio("A"), 1);
  assert.equal(parseCategory("Development"), "development");
  assert.equal(parseCategory("Data & BI"), "data_bi");
  assert.equal(parseCategory("beide"), "both");
  assert.equal(parseContactStatus("Geen gehoor", "new"), "in_outreach");
  assert.equal(parseContactStatus("Niet bereikt na 3 pogingen", "new"), "not_reached");
  assert.equal(parseContactStatus("Niet geïnteresseerd", "new"), "not_interested");
  assert.equal(parseContactStatus("Afspraak gepland", "new"), "reached");
  assert.equal(parseContactStatus("", "enrich"), "enrich");
});

test("parseCallList reads all four tabs and merges companies within the file", () => {
  const parsed = parseCallList([bellen, overig, vacatures, verrijken]);
  assert.equal(parsed.companies.length, 3);
  const impaqt = parsed.companies.find((c) => c.key === "d:impaqt.nl");
  assert.ok(impaqt);
  assert.equal(impaqt.prio, 1);
  assert.equal(impaqt.category, "development");
  assert.equal(impaqt.employees, 45);
  assert.deepEqual(impaqt.red_flags, ["Agency", "Uses freelancers"]);
  assert.equal(impaqt.general_phone, "030 1234567");
  const noSite = parsed.companies.find((c) => c.name === "No Site BV");
  assert.equal(noSite?.key, "n:no site bv");
  assert.equal(noSite?.category, "data_bi");

  const anna = parsed.contacts.find((c) => c.first_name === "Anna" && c.tab === "bellen");
  assert.equal(anna?.last_name, "de Boer");
  assert.equal(anna?.tier, 1);
  assert.equal(anna?.status, "in_outreach");
  assert.equal(anna?.attempts, 2);
  assert.equal(anna?.last_attempt_at, "2026-11-02");
  assert.equal(anna?.linkedin_url, "https://nl.linkedin.com/in/annadeboer");
  // No number on the call tab: the contact needs enriching.
  assert.equal(parsed.contacts.find((c) => c.first_name === "Cees")?.status, "enrich");
  assert.equal(parsed.contacts.find((c) => c.first_name === "Dirk")?.role, "reserve");
  assert.equal(parsed.contacts.find((c) => c.first_name === "Eva")?.status, "enrich");

  assert.equal(parsed.signals.length, 2);
  assert.equal(parsed.signals[0].companyKey, "d:impaqt.nl");
  assert.equal(parsed.signals[0].role_group, "Backend");
  assert.equal(parsed.signals[0].posted_at, "2026-10-01");
  assert.ok(parsed.signals[1].posted_at, "days open becomes a date online");
  assert.equal(parsed.tabs.find((t) => t.tab === "bellen")?.rows, 3);
});

test("dedupeContacts keeps one contact per person, the call tab wins", () => {
  const parsed = parseCallList([bellen, overig]);
  const contacts = dedupeContacts(parsed.contacts);
  const annas = contacts.filter((c) => c.first_name === "Anna");
  assert.equal(annas.length, 1);
  assert.equal(annas[0].role, "main");
  assert.equal(annas[0].tab, "bellen");
});

test("matchHeader is tolerant of extra words, punctuation and spacing", () => {
  const fields = {
    phone: ["mobiel", "telefoon"],
    status: ["status"],
    last_attempt_at: ["laatste poging"],
    email: ["e mail", "mail"],
    person_linkedin: ["linkedin", "li"],
    linkedin_url: ["linkedin bedrijf"],
  };
  assert.equal(matchHeader("Telefoon (mobiel)", fields), "phone");
  assert.equal(matchHeader("Status oud", fields), "status");
  assert.equal(matchHeader("Datum laatste poging", fields), "last_attempt_at");
  assert.equal(matchHeader("E-mail", fields), "email");
  assert.equal(matchHeader("Linked In", fields), "person_linkedin");
  assert.equal(matchHeader("LinkedIn bedrijf", fields), "linkedin_url", "the longest alias wins");
  assert.equal(matchHeader("Opmerkingen intern", fields), null);
  assert.equal(matchHeader("Lijst", fields), null, "short aliases only match exactly");
});

test("the column mapping lists recognised, ignored and missing columns per tab", () => {
  const sheet: Sheet = {
    sheet: "Bellen (340)",
    data: [
      ["Bedrijf", "Website", "Contactpersoon", "Telefoon (mobiel)", "Status oud", "Kleur", "LinkedIn"],
      ["Acme", "acme.nl", "Jan Smit", "+31612345678", "Geen gehoor", "rood", "https://www.linkedin.com/company/acme"],
    ],
  };
  const parsed = parseCallList([sheet]);
  const mapping = parsed.columns["Bellen (340)"];
  assert.ok(mapping, "a tab name with extra words is still found");
  assert.deepEqual(
    mapping.recognized.map((r) => [r.column, r.field]),
    [
      ["Bedrijf", "name"],
      ["Website", "website"],
      ["Contactpersoon", "full_name"],
      ["Telefoon (mobiel)", "phone"],
      ["Status oud", "status"],
      ["LinkedIn", "person_linkedin"],
    ],
  );
  assert.deepEqual(mapping.ignored, ["Kleur"]);
  assert.ok(mapping.missing.includes("Attempts"));
  // A company page in the LinkedIn column goes to the company, not the person.
  assert.equal(parsed.companies[0].linkedin_url, "https://www.linkedin.com/company/acme");
  assert.equal(parsed.contacts[0].linkedin_url, null);
});

test("LinkedIn links go where they point, whichever column they are in", () => {
  assert.equal(linkedinKind("https://www.linkedin.com/company/impaqt/"), "company");
  assert.equal(linkedinKind("nl.linkedin.com/in/annadeboer"), "person");
  assert.equal(linkedinKind("https://example.com"), null);
  const sheet: Sheet = {
    sheet: "Bellen",
    data: [
      ["Bedrijf", "LinkedIn bedrijf", "Contactpersoon", "LinkedIn persoon"],
      ["Swap BV", "https://linkedin.com/in/kees", "Kees", "https://linkedin.com/company/swap"],
    ],
  };
  const parsed = parseCallList([sheet]);
  assert.equal(parsed.companies[0].linkedin_url, "https://linkedin.com/company/swap");
  assert.equal(parsed.contacts[0].linkedin_url, "https://linkedin.com/in/kees");
});

test("old statuses become the call on the timeline, with a stable external id", () => {
  assert.equal(parseCallOutcome("Geen gehoor"), "no_answer");
  assert.equal(parseCallOutcome("Niet bereikt na 3 pogingen"), "no_answer");
  assert.equal(parseCallOutcome("Terugbellen"), "call_back");
  assert.equal(parseCallOutcome("Afspraak gepland"), "meeting_planned");
  assert.equal(parseCallOutcome("Niet geïnteresseerd"), "reached_not_interested");
  assert.equal(parseCallOutcome("Interesse"), "reached_interested");
  assert.equal(parseCallOutcome("Doorverwezen"), "referred");
  assert.equal(parseCallOutcome("Verkeerd nummer"), "wrong_number");
  assert.equal(parseCallOutcome("Verkeerde persoon"), "wrong_person");
  assert.equal(parseCallOutcome("Bereikt"), "bereikt");
  assert.equal(parseCallOutcome("Nieuw"), null);
  assert.equal(parseCallOutcome("Niet benaderen"), null);
  assert.equal(parseContactStatus("Verkeerd nummer", "new"), "enrich");

  const parsed = parseCallList([bellen]);
  const anna = parsed.contacts.find((c) => c.first_name === "Anna");
  assert.deepEqual(anna?.history, { outcome: "no_answer", statusText: "Geen gehoor" });
  const bert = parsed.contacts.find((c) => c.first_name === "Bert");
  assert.equal(bert?.history, null, "Nieuw with 0 attempts is no call");

  const id = "00000000-0000-0000-0000-000000000001";
  assert.equal(historyExternalId(id, anna!.history, "2026-11-02"), `import:call:${id}:no_answer:2026-11-02`);
  assert.equal(historyExternalId(id, { outcome: null, statusText: "Gebeld" }, null), `import:call:${id}:gebeld:undated`);
});

test("routes become the fixed pick list; anything else goes to the caller note", () => {
  assert.equal(parseRoute("Mobiel"), "Mobile");
  assert.equal(parseRoute("06"), "Mobile");
  assert.equal(parseRoute("Receptie"), "Via reception");
  assert.equal(parseRoute("algemeen nummer"), "Main number");
  assert.equal(parseRoute("E-mail"), "Mail");
  assert.equal(parseRoute("LinkedIn"), "LinkedIn");
  assert.equal(parseRoute("Bellen", "+31612345678"), "Mobile");
  assert.equal(parseRoute("Bellen", "030 1234567"), "Main number");
  assert.equal(parseRoute("via de buurman"), null);

  const sheet: Sheet = {
    sheet: "Bellen",
    data: [
      ["Bedrijf", "Contactpersoon", "Route", "Notitie"],
      ["Route BV", "Ria", "Via de buurman", "Bel na 10"],
      ["Route BV", "Rob", "Receptie", null],
    ],
  };
  const contacts = parseCallList([sheet]).contacts;
  assert.equal(contacts[0].route, null);
  assert.equal(contacts[0].caller_note, "Bel na 10\nRoute: Via de buurman");
  assert.equal(contacts[1].route, "Via reception");
});
