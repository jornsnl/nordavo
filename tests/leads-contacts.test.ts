import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cleanLinkedinUrl,
  cleanSourceUrl,
  isLinkedinCaseRepair,
  isLinkedinLinkBroken,
  linkedinMemberUrn,
  normalizeLinkedin,
  signalDedupeKey,
  vacancyUrlKey,
} from "@/lib/gtm/normalize";
import { extractLeadNotes } from "@/lib/gtm/lead-notes";
import { companyNameKey, domainStem, duplicateWarning } from "@/lib/sales/duplicates";
import { contactRoleFrom, linkedinPatch, nameMatchAllowed, personKeys } from "@/lib/sales/contact-keys";
import { daysOnline, onlineSince, vacancyFacts } from "@/lib/sales/vacancies";
import { companyKeyError } from "@/lib/mcp/sales-tools";

// ---------------------------------------------------------------------------
// LinkedIn links (5504e5e9, 85f649cd, 2afaec56)
// ---------------------------------------------------------------------------

test("cleanLinkedinUrl keeps the case of the path and adds https://", () => {
  assert.equal(cleanLinkedinUrl("linkedin.com/in/ACwAAB12CdEf"), "https://www.linkedin.com/in/ACwAAB12CdEf");
  assert.equal(cleanLinkedinUrl("https://nl.linkedin.com/in/Nick-Dijk/?trk=x"), "https://www.linkedin.com/in/Nick-Dijk");
  assert.equal(cleanLinkedinUrl("linkedin.com/company/brightcape"), "https://www.linkedin.com/company/brightcape");
  assert.equal(cleanLinkedinUrl("LinkedIn.com/IN/Foo-Bar//"), "https://www.linkedin.com/in/Foo-Bar");
  assert.equal(cleanLinkedinUrl("www.example.com/x"), "https://www.example.com/x");
  assert.equal(cleanLinkedinUrl("  "), null);
  // The key for matching stays lowercase and the same as before.
  assert.equal(normalizeLinkedin(cleanLinkedinUrl("linkedin.com/in/ACwAAB12CdEf")), "linkedin.com/in/acwaab12cdef");
});

test("linkedinMemberUrn finds the Apify member id", () => {
  assert.equal(linkedinMemberUrn("https://www.linkedin.com/in/ACwAAB12CdEfGh"), "ACwAAB12CdEfGh");
  assert.equal(linkedinMemberUrn("ACoAAB12CdEfGh"), "ACoAAB12CdEfGh");
  assert.equal(linkedinMemberUrn("https://www.linkedin.com/in/nickphdijk"), null);
  assert.equal(isLinkedinLinkBroken("https://www.linkedin.com/in/acwaab12cdefgh"), true);
  assert.equal(isLinkedinLinkBroken("https://www.linkedin.com/in/ACwAAB12CdEfGh"), false);
  assert.equal(isLinkedinLinkBroken("https://www.linkedin.com/in/nickphdijk"), false);
});

test("isLinkedinCaseRepair only for the same link with its case back", () => {
  assert.equal(isLinkedinCaseRepair("https://www.linkedin.com/in/acwaab12cdefgh", "linkedin.com/in/ACwAAB12CdEfGh"), true);
  assert.equal(isLinkedinCaseRepair("https://www.linkedin.com/in/ACwAAB12CdEfGh", "linkedin.com/in/acwaab12cdefgh"), false);
  assert.equal(isLinkedinCaseRepair("https://www.linkedin.com/in/jan", "https://www.linkedin.com/in/piet"), false);
});

test("personKeys and linkedinPatch: Apify link and normal link are the same person", () => {
  const apify = personKeys({ linkedin_url: "linkedin.com/in/ACwAAB12CdEfGh", first: "Nick", last: "Dijk" });
  assert.equal(apify.memberUrn, "ACwAAB12CdEfGh");
  assert.equal(apify.linkedinUrl, "https://www.linkedin.com/in/ACwAAB12CdEfGh");

  // Known with the Apify link; now the normal link comes in: it replaces the link, the id is kept.
  const vanity = personKeys({ linkedin_url: "https://www.linkedin.com/in/nickphdijk" });
  assert.deepEqual(linkedinPatch({ linkedin_url: "https://www.linkedin.com/in/ACwAAB12CdEfGh", linkedin_member_urn: "ACwAAB12CdEfGh" }, vanity), {
    linkedin_url: "https://www.linkedin.com/in/nickphdijk",
  });
  // Known with the normal link; the Apify link comes in: only the member id is added.
  assert.deepEqual(linkedinPatch({ linkedin_url: "https://www.linkedin.com/in/nickphdijk", linkedin_member_urn: null }, apify), {
    linkedin_member_urn: "ACwAAB12CdEfGh",
  });
  // A lowercased Apify link gets its case back.
  assert.deepEqual(
    linkedinPatch({ linkedin_url: "https://www.linkedin.com/in/acwaab12cdefgh", linkedin_member_urn: "acwaab12cdefgh" }, apify),
    { linkedin_url: "https://www.linkedin.com/in/ACwAAB12CdEfGh" },
  );
});

test("nameMatchAllowed: same name at the company, unless LinkedIn says otherwise", () => {
  const keys = personKeys({ linkedin_url: "linkedin.com/in/jan-a", first: "Jan", last: "Jansen" });
  assert.equal(nameMatchAllowed({ linkedin_url: null }, keys), true);
  assert.equal(nameMatchAllowed({ linkedin_url: "https://www.linkedin.com/in/ACwAAB12CdEfGh" }, keys), true);
  assert.equal(nameMatchAllowed({ linkedin_url: "https://www.linkedin.com/in/jan-b" }, keys), false);
});

test("contactRoleFrom: backup is stored as reserve", () => {
  assert.equal(contactRoleFrom("Backup"), "reserve");
  assert.equal(contactRoleFrom("main"), "main");
  assert.equal(contactRoleFrom("extra"), "extra");
  assert.equal(contactRoleFrom("boss"), null);
});

// ---------------------------------------------------------------------------
// Vacancy links (3f541eed)
// ---------------------------------------------------------------------------

test("cleanSourceUrl accepts links without https://", () => {
  assert.equal(cleanSourceUrl("nl.indeed.com/viewjob?jk=abc123"), "https://nl.indeed.com/viewjob?jk=abc123");
  assert.equal(cleanSourceUrl("https://www.linkedin.com/jobs/view/123"), "https://www.linkedin.com/jobs/view/123");
  assert.equal(cleanSourceUrl("no link here"), null);
  assert.equal(cleanSourceUrl("javascript:alert(1)"), null);
});

test("signalDedupeKey keeps the Indeed job id, so every vacancy is its own", () => {
  const a = signalDedupeKey({ source: "apify", sourceUrl: "nl.indeed.com/viewjob?jk=AAA111&from=serp", companyDomain: "semplor.nl" });
  const b = signalDedupeKey({ source: "apify", sourceUrl: "https://nl.indeed.com/viewjob?jk=BBB222", companyDomain: "semplor.nl" });
  assert.notEqual(a, b);
  assert.equal(a, "apify:nl.indeed.com/viewjob?jk=aaa111");
  assert.equal(signalDedupeKey({ source: "apify", sourceUrl: "https://nl.indeed.com/viewjob?vjk=AAA111", companyDomain: "x" }), a);
  // LinkedIn job links and plain links keep their old key.
  assert.equal(vacancyUrlKey("https://www.linkedin.com/jobs/view/123/?trk=a&refId=b"), "www.linkedin.com/jobs/view/123");
  assert.equal(vacancyUrlKey("https://acme.nl/vacatures/dev?utm_source=x"), "acme.nl/vacatures/dev");
  assert.equal(vacancyUrlKey("https://acme.nl/jobs?id=42&utm_source=x"), "acme.nl/jobs?id=42");
});

// ---------------------------------------------------------------------------
// Opening line, red flags, general number (dfd3ac00)
// ---------------------------------------------------------------------------

test("extractLeadNotes takes the marked parts out of What they do", () => {
  const notes = extractLeadNotes("Data consultancy in Utrecht.\nOPENING LINE: Saw your Data Engineer post\nRED FLAGS: small team; uses offshore\nGENERAL NUMBER: 030 123 4567");
  assert.deepEqual(notes, {
    description: "Data consultancy in Utrecht.",
    opening_line: "Saw your Data Engineer post",
    red_flags: ["small team", "uses offshore"],
    general_phone: "030 123 4567",
  });
  const inline = extractLeadNotes("We build apps. **Opening line:** Hoi! **Red flags:** none");
  assert.equal(inline?.description, "We build apps.");
  assert.equal(inline?.opening_line, "Hoi!");
  assert.deepEqual(inline?.red_flags, []);
  assert.equal(extractLeadNotes("Just a description: nothing else"), null);
});

// ---------------------------------------------------------------------------
// Possible duplicates (a402b3e5) and batch import (143e4a7a)
// ---------------------------------------------------------------------------

test("companyNameKey and domainStem find the same company on .nl and .com", () => {
  assert.equal(companyNameKey("Brightcape B.V."), "brightcape");
  assert.equal(companyNameKey("BrightCape"), "brightcape");
  assert.equal(companyNameKey("The Data Company Nederland"), "datacompany");
  assert.equal(domainStem("brightcape.nl"), "brightcape");
  assert.equal(domainStem("app.brightcape.co.uk"), "brightcape");
  assert.equal(domainStem("nodomain:finneo"), null);
  assert.match(
    duplicateWarning([{ id: "1", name: "Brightcape", domain: "brightcape.com", lead_status: "new", reason: "same name" }]) ?? "",
    /Possible duplicate of Brightcape \(brightcape\.com, same name\)/,
  );
  assert.equal(duplicateWarning([]), null);
});

test("companyKeyError rejects only a company without website and LinkedIn", () => {
  assert.equal(companyKeyError({ domain: "finneo.nl" }), null);
  assert.equal(companyKeyError({ linkedin_url: "linkedin.com/company/turkischgids" }), null);
  assert.match(companyKeyError({}) ?? "", /No website or company LinkedIn page/);
});

// ---------------------------------------------------------------------------
// Days online (d7e7e54e, 1127cbd0, 6deb9a51)
// ---------------------------------------------------------------------------

test("daysOnline counts whole days in Amsterdam", () => {
  const now = Date.parse("2026-11-12T10:00:00Z");
  assert.equal(daysOnline("2026-11-12", now), 0);
  assert.equal(daysOnline("2026-11-01", now), 11);
  assert.equal(daysOnline(null, now), null);
  // 23:30 UTC on the 12th is already the 13th in Amsterdam.
  assert.equal(daysOnline("2026-11-12", Date.parse("2026-11-12T23:30:00Z")), 1);
  assert.equal(onlineSince({ posted_at: "2026-10-01", first_seen_at: "2026-11-11T09:00:00Z" }), "2026-10-01");
  assert.equal(onlineSince({ posted_at: null, first_seen_at: "2026-11-11T23:30:00Z" }), "2026-11-12");
});

test("vacancyFacts: count, oldest and newest, titles with days", () => {
  const now = Date.parse("2026-11-12T10:00:00Z");
  const facts = vacancyFacts(
    [
      { id: "b", title: "Backend developer", url: "https://x/b", source: "apify", onlineSince: "2026-11-09", postedAt: "2026-11-09" },
      { id: "a", title: "Data engineer", url: null, source: "apify", onlineSince: "2026-10-31", postedAt: null },
    ],
    now,
  );
  assert.equal(facts.vacancy_count, 2);
  assert.equal(facts.oldest_vacancy_on, "2026-10-31");
  assert.equal(facts.oldest_vacancy_days, 12);
  assert.equal(facts.newest_vacancy_days, 3);
  assert.equal(facts.vacancy_titles, "Data engineer (12d), Backend developer (3d)");
  assert.equal(vacancyFacts([], now).vacancy_count, 0);
});
