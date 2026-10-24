import { test } from "node:test";
import assert from "node:assert/strict";
import {
  countDistinctTechRoles,
  isLongOpen,
  isTechRole,
  mentionsRemoteOrExternal,
  parseEmployeeCount,
  pickDecisionMakers,
  techRoleKey,
  tierForTitle,
} from "@/lib/gtm/signals";

test("isTechRole keeps developer and data roles", () => {
  for (const title of [
    "Senior Backend Developer (Java)",
    "Medior Frontend Developer React",
    "Full Stack Developer",
    "Fullstack ontwikkelaar .NET",
    "Data Engineer",
    "BI Developer",
    "Power BI specialist",
    "Data Analist",
    "Data Scientist",
    "Machine Learning Engineer",
    "Software Engineer",
    "PHP programmeur",
  ]) {
    assert.equal(isTechRole(title), true, title);
  }
});

test("isTechRole drops non-tech and look-alikes", () => {
  for (const title of [
    "Accountmanager",
    "Business Developer",
    "IT Recruiter",
    "Werktuigbouwkundig Engineer",
    "Service Engineer",
    "Stage Frontend Developer",
    "Marketing Manager",
    "",
    null,
  ]) {
    assert.equal(isTechRole(title), false, String(title));
  }
});

test("techRoleKey strips seniority, gender suffix and location", () => {
  assert.equal(techRoleKey("Senior Backend Developer (m/v/x) - Utrecht"), "backend developer");
  assert.equal(techRoleKey("Medior Backend Developer"), "backend developer");
  assert.equal(techRoleKey("Data Engineer M/V"), "data engineer");
});

test("countDistinctTechRoles counts the same role once", () => {
  assert.equal(
    countDistinctTechRoles(["Senior Backend Developer", "Medior Backend Developer (m/v)", "Office manager"]),
    1,
  );
  assert.equal(countDistinctTechRoles(["Backend Developer", "Data Engineer", "Data Engineer"]), 2);
});

test("mentionsRemoteOrExternal", () => {
  assert.equal(mentionsRemoteOrExternal("Je werkt volledig remote vanuit huis."), true);
  assert.equal(mentionsRemoteOrExternal("Je werkt samen met ons externe team in Polen."), true);
  assert.equal(mentionsRemoteOrExternal("We werken met een nearshore partner."), true);
  assert.equal(mentionsRemoteOrExternal("Kantoor in Utrecht, twee dagen thuiswerken."), false);
  assert.equal(mentionsRemoteOrExternal(null), false);
});

test("isLongOpen uses posted date or first seen, more than 60 days", () => {
  const now = new Date("2026-10-24T12:00:00Z");
  assert.equal(isLongOpen({ postedAt: "2026-08-01T00:00:00Z" }, now), true);
  assert.equal(isLongOpen({ postedAt: "2026-10-01T00:00:00Z" }, now), false);
  assert.equal(isLongOpen({ postedAt: "2026-10-20T00:00:00Z", firstSeenAt: "2026-07-01T00:00:00Z" }, now), true);
  assert.equal(isLongOpen({ postedAt: "2026-08-25T12:00:00Z" }, now), false); // exactly 60 days
  assert.equal(isLongOpen({ postedAt: "geen datum" }, now), false);
});

test("parseEmployeeCount", () => {
  assert.equal(parseEmployeeCount("45"), 45);
  assert.equal(parseEmployeeCount(12), 12);
  assert.equal(parseEmployeeCount("11-50 employees"), 31);
  assert.equal(parseEmployeeCount("1-10"), 6);
  assert.equal(parseEmployeeCount("50+"), 50);
  assert.equal(parseEmployeeCount("1.200"), 1200);
  assert.equal(parseEmployeeCount("onbekend"), null);
  assert.equal(parseEmployeeCount(undefined), null);
});

test("tierForTitle maps the briefing tiers", () => {
  assert.equal(tierForTitle("CTO"), 1);
  assert.equal(tierForTitle("Co-founder & CTO"), 1);
  assert.equal(tierForTitle("Head of Engineering"), 1);
  assert.equal(tierForTitle("Head of Data & Analytics"), 1);
  assert.equal(tierForTitle("VP Engineering"), 1);
  assert.equal(tierForTitle("Engineering Manager"), 1);
  assert.equal(tierForTitle("Technisch directeur"), 1);
  assert.equal(tierForTitle("Eigenaar"), 2);
  assert.equal(tierForTitle("Directeur"), 2);
  assert.equal(tierForTitle("CEO & Founder"), 2);
  assert.equal(tierForTitle("Managing Director"), 2);
  assert.equal(tierForTitle("Recruiter"), 3);
  assert.equal(tierForTitle("HR Manager"), 3);
  assert.equal(tierForTitle("HR Directeur"), 3);
  assert.equal(tierForTitle("Talent Acquisition Specialist"), 3);
  assert.equal(tierForTitle("Backend Developer"), null);
  assert.equal(tierForTitle("Office Manager"), null);
  assert.equal(tierForTitle(null), null);
});

test("pickDecisionMakers takes the best two by tier at the right company", () => {
  const person = (title: string, linkedin: string, companyDomain: string | null = "acme.nl") => ({
    firstName: "A",
    lastName: linkedin,
    title,
    linkedinUrl: `linkedin.com/in/${linkedin}`,
    companyDomain,
  });
  const picked = pickDecisionMakers(
    [
      person("Recruiter", "r1"),
      person("Developer", "d1"),
      person("CEO", "c1"),
      person("CTO", "t1", "other.nl"),
      person("Head of Engineering", "h1", null),
      person("Head of Engineering", "h1"),
    ],
    { count: 2, domain: "acme.nl" },
  );
  assert.deepEqual(
    picked.map((p) => [p.lastName, p.tier]),
    [["h1", 1], ["c1", 2]],
  );
  const one = pickDecisionMakers([person("CEO", "c1"), person("Recruiter", "r1")], {
    count: 1,
    domain: "acme.nl",
    existingLinkedin: ["linkedin.com/in/c1"],
  });
  assert.deepEqual(one.map((p) => p.lastName), ["r1"]);
});
