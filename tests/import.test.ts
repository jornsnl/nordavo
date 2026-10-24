import { test } from "node:test";
import assert from "node:assert/strict";
import {
  channelFromText,
  domainForRow,
  guessMapping,
  importActivityId,
  outcomeFromText,
  parseSheetDate,
} from "@/lib/gtm/import";

test("guessMapping: Dutch sheet headers", () => {
  assert.deepEqual(
    guessMapping(["Bedrijfsnaam", "Website", "Rechtsvorm", "Aantal medewerkers", "Voornaam", "Achternaam", "Functie", "LinkedIn", "E-mail", "Mobiel", "Gebeld op", "Uitkomst"]),
    {
      company_name: "Bedrijfsnaam",
      domain: "Website",
      legal_form: "Rechtsvorm",
      employees: "Aantal medewerkers",
      first_name: "Voornaam",
      last_name: "Achternaam",
      title: "Functie",
      person_linkedin: "LinkedIn",
      email: "E-mail",
      phone: "Mobiel",
      last_contacted_at: "Gebeld op",
      contact_outcome: "Uitkomst",
    },
  );
});

test("guessMapping: the Max CSV columns", () => {
  assert.deepEqual(guessMapping(["firstname", "lastname", "company", "website", "company linkedin", "person linkedin"]), {
    first_name: "firstname",
    last_name: "lastname",
    company_name: "company",
    domain: "website",
    company_linkedin: "company linkedin",
    person_linkedin: "person linkedin",
  });
});

test("guessMapping: English headers, domain before website, full name", () => {
  const mapping = guessMapping(["Company", "Domain", "Website", "Name", "Job Title", "Email Address", "Phone Number", "Last contacted", "Outcome", "Company LinkedIn URL", "Employees"]);
  assert.equal(mapping.domain, "Domain");
  assert.equal(mapping.company_name, "Company");
  assert.equal(mapping.full_name, "Name");
  assert.equal(mapping.title, "Job Title");
  assert.equal(mapping.email, "Email Address");
  assert.equal(mapping.phone, "Phone Number");
  assert.equal(mapping.last_contacted_at, "Last contacted");
  assert.equal(mapping.contact_outcome, "Outcome");
  assert.equal(mapping.company_linkedin, "Company LinkedIn URL");
  assert.equal(mapping.employees, "Employees");
  assert.equal(mapping.person_linkedin, undefined);
});

test("guessMapping: laatst benaderd, naam, telefoon, domein", () => {
  const mapping = guessMapping(["Naam", "Domein", "Telefoon", "Laatst benaderd", "Kanaal"]);
  assert.deepEqual(mapping, { full_name: "Naam", domain: "Domein", phone: "Telefoon", last_contacted_at: "Laatst benaderd", contact_channel: "Kanaal" });
});

test("parseSheetDate supports dd-mm-yyyy, yyyy-mm-dd and d-m-yy", () => {
  assert.equal(parseSheetDate("13-03-2025"), "2025-03-13T12:00:00.000Z");
  assert.equal(parseSheetDate("2025-03-13"), "2025-03-13T12:00:00.000Z");
  assert.equal(parseSheetDate("3-1-25"), "2025-01-03T12:00:00.000Z");
  assert.equal(parseSheetDate("13/03/2025"), "2025-03-13T12:00:00.000Z");
  assert.equal(parseSheetDate("gebeld op 5-6-2024, geen gehoor"), "2024-06-05T12:00:00.000Z");
  assert.equal(parseSheetDate("31-02-2025"), null);
  assert.equal(parseSheetDate("ja"), null);
  assert.equal(parseSheetDate(""), null);
});

test("outcomeFromText recognises the clear cases only", () => {
  assert.equal(outcomeFromText("Geen gehoor, voicemail ingesproken"), "geen_gehoor");
  assert.equal(outcomeFromText("Niet geïnteresseerd"), "niet_geinteresseerd");
  assert.equal(outcomeFromText("Afspraak op dinsdag"), "afspraak");
  assert.equal(outcomeFromText("Gesproken, geen afspraak, mail sturen"), "bereikt");
  assert.equal(outcomeFromText("Gesproken met Jan"), "bereikt");
  assert.equal(outcomeFromText(null, "mail"), "verstuurd");
});

test("channelFromText", () => {
  assert.equal(channelFromText("E-mail"), "mail");
  assert.equal(channelFromText("LinkedIn"), "linkedin");
  assert.equal(channelFromText("gebeld"), "bellen");
  assert.equal(channelFromText(null), "bellen");
});

test("domainForRow uses the website, else a business email", () => {
  assert.equal(domainForRow("https://www.Acme.nl/contact", null), "acme.nl");
  assert.equal(domainForRow("", "jan@acme.nl"), "acme.nl");
  assert.equal(domainForRow(null, "jan@gmail.com"), null);
  assert.equal(domainForRow("n.v.t.", null), null);
});

test("importActivityId is stable per source and row identity", () => {
  const a = importActivityId({ source: "Bellijst ronde 1", domain: "acme.nl", person: "linkedin.com/in/jan", date: "2025-03-13T12:00:00.000Z", channel: "bellen" });
  const b = importActivityId({ source: "bellijst ronde 1 ", domain: "acme.nl", person: "linkedin.com/in/jan", date: "2025-03-13T12:00:00.000Z", channel: "bellen" });
  const c = importActivityId({ source: "Bellijst ronde 2", domain: "acme.nl", person: "linkedin.com/in/jan", date: "2025-03-13T12:00:00.000Z", channel: "bellen" });
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^import:[0-9a-f]{32}$/);
});
