import { test } from "node:test";
import assert from "node:assert/strict";
import { mapPortalCandidate, type PoolCandidate, type PoolCandidateRow } from "@/lib/talent/pool";
import {
  collectText,
  employerTerms,
  findIdentifierLeaks,
  leakMessage,
  profileCode,
  redactIdentifiers,
} from "@/lib/talent/anonymize";
import { leadTime } from "@/lib/talent/lead-time";
import { advanceStage, readSearchBrief } from "@/lib/talent/match";
import {
  candidateLevel,
  clampScore,
  judgementPayload,
  needsSearchBrief,
  normalizeSkill,
  poolPatterns,
  prefilterCandidates,
  selectMatchesToStore,
  seniorityFits,
  twoSentences,
  type VacancyRequirements,
} from "@/lib/talent/prefilter";

function candidate(overrides: Partial<PoolCandidate> = {}): PoolCandidate {
  return {
    id: "00000000-0000-4000-8000-00000000000a",
    name: "Priya Raghavan",
    nameParts: ["Priya", "Raghavan"],
    email: "priya.r@example.com",
    phone: "+91 98450 12345",
    skills: ["Python", "dbt", "Snowflake"],
    yearsExperience: 6,
    seniority: "Senior",
    currentTitle: "Senior Data Engineer at Flipkart",
    employers: ["Infosys Limited", "Flipkart"],
    projectTypes: ["Data platforms"],
    sectors: ["E-commerce"],
    cvText: null,
    summary: "Priya built the Flipkart data platform with Python and Airflow. Contact: priya.r@example.com, +91 98450 12345.",
    hasCvAttachment: false,
    englishLevel: "C1",
    availability: "30 dagen",
    location: "Bangalore",
    status: "available",
    consent: null,
    ...overrides,
  };
}

const ids = {
  nameParts: ["Priya", "Raghavan"],
  email: "priya.r@example.com",
  phone: "+91 98450 12345",
  employers: ["Infosys Limited", "Tata Consultancy Services", "Flipkart"],
  skills: ["Python"],
};

// ---------------------------------------------------------------------------
// Anonymisation (rule 12)
// ---------------------------------------------------------------------------

test("a clean anonymous profile passes the check", () => {
  const text = "Senior Data Engineer met 6 jaar ervaring bij een groot Indiaas IT-dienstverlener en een e-commerce scale-up. Sinds 2018 bouwt ze dataplatformen.";
  assert.deepEqual(findIdentifierLeaks(text, ids), []);
});

test("names, email, phone and employers are caught, case and accent insensitive", () => {
  const leaks = findIdentifierLeaks(
    "PRIYA werkte bij Infosys en TCS? Nee: bij Tata. Mail priya.r@example.com of bel 98450-12345.",
    ids,
  );
  const kinds = leaks.map((l) => l.kind);
  assert.ok(kinds.includes("naam"));
  assert.ok(kinds.includes("e-mail"));
  assert.ok(kinds.includes("telefoon"));
  assert.equal(leaks.filter((l) => l.kind === "werkgever").length, 2, "Infosys and Tata");
});

test("any email address, phone number or link is rejected even if unknown", () => {
  const leaks = findIdentifierLeaks("Zie linkedin.com/in/someone of mail iemand@bedrijf.nl, tel 0612345678", { nameParts: [], email: null, phone: null, employers: [] });
  assert.deepEqual([...new Set(leaks.map((l) => l.kind))].sort(), ["e-mail", "link", "telefoon"]);
});

test("year ranges and short numbers are not phone numbers", () => {
  assert.deepEqual(findIdentifierLeaks("Van 2015 - 2019 bij een bank, 40 uur, 3.500 euro", { nameParts: [], email: null, phone: null, employers: [] }), []);
});

test("name parts that are also skills or very short are ignored", () => {
  const leaks = findIdentifierLeaks("Sterk in Python en Go", { nameParts: ["Python", "Go"], email: null, phone: null, employers: [], skills: ["Python"] });
  assert.deepEqual(leaks, []);
});

test("partial words do not count as a name or employer", () => {
  const leaks = findIdentifierLeaks("Werkte aan een tataki app", { nameParts: ["Ram"], email: null, phone: null, employers: ["Tata Steel"] });
  assert.deepEqual(leaks, []);
  assert.deepEqual(findIdentifierLeaks("Programmeert graag", { nameParts: ["Ram"], email: null, phone: null, employers: [] }), []);
});

test("employerTerms strips legal suffixes and generic words", () => {
  assert.deepEqual(employerTerms("Infosys Limited"), ["infosys limited", "infosys"]);
  assert.deepEqual(employerTerms("Tata Consultancy Services"), ["tata consultancy services", "tata"]);
  assert.deepEqual(employerTerms("Freelance"), []);
});

test("redactIdentifiers removes identifiers before text goes to Claude", () => {
  const redacted = redactIdentifiers(
    "Priya Raghavan built pipelines at Tata Consultancy Services and Flipkart. Mail priya.r@example.com, call +91 98450 12345, see https://github.com/priya",
    ids,
  );
  assert.deepEqual(findIdentifierLeaks(redacted, ids), []);
  assert.ok(redacted.includes("[werkgever]"));
  assert.ok(redacted.includes("[naam]"));
  assert.ok(redacted.includes("pipelines"));
});

test("collectText flattens profile JSON and leakMessage names kinds only", () => {
  assert.equal(collectText({ a: "x", b: ["y", { c: "z" }], n: 3 }), "x\ny\nz\n3");
  const message = leakMessage([{ kind: "naam", match: "Priya" }]);
  assert.ok(message.includes("naam"));
  assert.ok(!message.includes("Priya"));
});

test("profileCode uses the profile id only", () => {
  assert.equal(profileCode("3f2a9c1e-0000-4000-8000-000000000000"), "NV-3F2A9C");
});

// ---------------------------------------------------------------------------
// Matching (T2, T3)
// ---------------------------------------------------------------------------

const vacancy: VacancyRequirements = {
  title: "Senior Data Engineer",
  stack: ["Python", "Snowflake", "Airflow"],
  seniority: "senior",
  hours: 40,
  timezone_overlap: "4 uur",
  budget_min: null,
  budget_max: 3500,
  client_contact_required: false,
  must_haves: ["dbt", "5 jaar ervaring met data pipelines"],
  nice_to_haves: [],
};

test("normalizeSkill folds aliases", () => {
  assert.equal(normalizeSkill("Node.js"), "node");
  assert.equal(normalizeSkill("Postgres"), "postgresql");
  assert.equal(normalizeSkill(" Power BI "), "powerbi");
});

test("seniority: juniors never, mediors for senior roles only with 4+ years", () => {
  assert.equal(candidateLevel({ seniority: null, yearsExperience: 1 }), "junior");
  assert.equal(seniorityFits("senior", { seniority: "Junior", yearsExperience: 8 }), false);
  assert.equal(seniorityFits("senior", { seniority: "Medior", yearsExperience: 3 }), false);
  assert.equal(seniorityFits("senior", { seniority: "Medior", yearsExperience: 4 }), true);
  assert.equal(seniorityFits("medior", { seniority: null, yearsExperience: null }), true);
});

test("prefilter drops juniors and candidates without overlap, ranks by overlap", () => {
  const pool = [
    candidate({ id: "recStrong", skills: ["Python", "Snowflake", "Airflow", "dbt"], yearsExperience: 7 }),
    candidate({ id: "recSome", skills: ["Python"], yearsExperience: 6, summary: null }),
    candidate({ id: "recJunior", skills: ["Python", "Snowflake"], seniority: "Junior", yearsExperience: 1 }),
    candidate({ id: "recNone", skills: ["PHP", "Laravel"], summary: null }),
    candidate({ id: "recText", skills: [], summary: "Bouwt pipelines met Airflow en Snowflake." }),
  ];
  const result = prefilterCandidates(vacancy, pool, 25);
  assert.deepEqual(result.map((r) => r.candidate.id), ["recStrong", "recText", "recSome"]);
  assert.equal(prefilterCandidates(vacancy, pool, 1).length, 1);
});

// ---------------------------------------------------------------------------
// Portal candidates as the pool
// ---------------------------------------------------------------------------

function portalRow(overrides: Partial<PoolCandidateRow> = {}): PoolCandidateRow {
  return {
    id: "00000000-0000-4000-8000-0000000000b1",
    full_name: "Priya Raghavan",
    email: "priya.r@example.com",
    phone: " +91 98450 12345 ",
    location: "Bangalore",
    current_title: "Senior Data Engineer",
    years_experience: 6,
    skills: ["Python", "python", " dbt ", ""],
    cv_path: "candidate/x/cv.pdf",
    summary: "  ",
    status: "available",
    seniority: "senior",
    employers: ["Flipkart", "Infosys Limited"],
    project_types: ["Data platforms"],
    sectors: ["E-commerce"],
    cv_text: "Built pipelines with Airflow.",
    english_level: "C1",
    availability: "30 days notice",
    profile_consent: null,
    ...overrides,
  };
}

test("mapPortalCandidate maps every field the matcher and the profile use", () => {
  const c = mapPortalCandidate(portalRow());
  assert.equal(c.name, "Priya Raghavan");
  assert.deepEqual(c.nameParts, ["Priya", "Raghavan"]);
  assert.equal(c.phone, "+91 98450 12345");
  assert.deepEqual(c.skills, ["Python", "dbt"], "trimmed, no empties, no case duplicates");
  assert.equal(c.seniority, "senior");
  assert.deepEqual(c.employers, ["Flipkart", "Infosys Limited"]);
  assert.equal(c.summary, null, "blank text reads as missing");
  assert.equal(c.cvText, "Built pipelines with Airflow.");
  assert.equal(c.hasCvAttachment, true);
  assert.equal(c.englishLevel, "C1");
  assert.equal(c.availability, "30 days notice");
  assert.equal(c.consent, null);
  assert.equal(mapPortalCandidate(portalRow({ profile_consent: false })).consent, false);
  assert.equal(mapPortalCandidate(portalRow({ cv_path: null })).hasCvAttachment, false);
});

test("a mapped portal candidate goes through the prefilter and stays anonymous for Claude", () => {
  const c = mapPortalCandidate(portalRow({ skills: ["Python", "Snowflake", "Airflow", "dbt"], summary: "Priya worked at Flipkart." }));
  assert.equal(prefilterCandidates(vacancy, [c]).length, 1);
  const payload = JSON.stringify(judgementPayload(c, "K1"));
  assert.deepEqual(findIdentifierLeaks(payload, { nameParts: c.nameParts, email: c.email, phone: c.phone, employers: c.employers, skills: c.skills }), []);
});

test("poolPatterns: one weighted pattern per wanted skill, aliases included", () => {
  const { patterns, weights } = poolPatterns({ stack: ["Node.js", "Postgres"], must_haves: ["Kubernetes", "5 jaar ervaring met data pipelines"] });
  assert.equal(patterns.length, 3, "long must haves are not skills");
  assert.deepEqual(weights, [10, 10, 4]);
  const match = (i: number, text: string) => new RegExp(patterns[i]).test(text);
  assert.ok(match(0, "nodejs , react"));
  assert.ok(match(0, "node.js (backend)"));
  assert.ok(!match(0, "nodemon"));
  assert.ok(match(1, "aws , postgresql"));
  assert.ok(match(1, "worked with psql daily"));
  assert.ok(match(2, "k8s"));
  assert.deepEqual(poolPatterns({ stack: [], must_haves: [] }), { patterns: [], weights: [] });
});

test("poolPatterns never drop a candidate the exact prefilter keeps", () => {
  const stack = ["C#", ".NET", "Power BI", "Vue.js", "Go"];
  const { patterns } = poolPatterns({ stack, must_haves: [] });
  const req: VacancyRequirements = { ...vacancy, stack, must_haves: [] };
  const pool = [
    candidate({ skills: ["csharp"], summary: null }),
    candidate({ skills: ["dotnet"], summary: null }),
    candidate({ skills: ["PowerBI"], summary: null }),
    candidate({ skills: ["VueJS"], summary: null }),
    candidate({ skills: ["Golang"], summary: null }),
    candidate({ skills: [], summary: "Builds services in Go and C#." }),
  ];
  for (const c of pool) {
    assert.equal(prefilterCandidates(req, [c]).length, 1, `exact prefilter keeps ${c.skills.join(",") || c.summary}`);
    const hay = [c.skills.join(" , "), c.summary, c.cvText].filter(Boolean).join(" ").toLowerCase();
    assert.ok(patterns.some((p) => new RegExp(p).test(hay)), `SQL patterns keep ${hay}`);
  }
});

test("judgementPayload never contains name, email, phone or employers", () => {
  const payload = judgementPayload(candidate(), "K1");
  const text = JSON.stringify(payload);
  assert.equal(payload.ref, "K1");
  assert.ok(!("name" in payload) && !("email" in payload) && !("phone" in payload));
  assert.deepEqual(findIdentifierLeaks(text, { ...ids, employers: ["Infosys Limited", "Flipkart"] }), []);
  assert.ok(text.includes("Airflow"));
});

test("selectMatchesToStore keeps the top 3 plus everyone above the bar", () => {
  const scored = [40, 90, 55, 20, 75, 51].map((score, i) => ({ id: i, score }));
  assert.deepEqual(selectMatchesToStore(scored).map((s) => s.score), [90, 75, 55, 51]);
  assert.deepEqual(selectMatchesToStore(scored, { keepAbove: null }).map((s) => s.score), [90, 75, 55]);
  assert.equal(selectMatchesToStore(scored.slice(0, 2)).length, 2);
});

test("search brief is needed with fewer than 3 matches of 70 or more", () => {
  assert.equal(needsSearchBrief([90, 75, 69]), true);
  assert.equal(needsSearchBrief([90, 75, 70]), false);
  assert.equal(needsSearchBrief([]), true);
});

test("clampScore and twoSentences keep Claude output inside the contract", () => {
  assert.equal(clampScore(104.6), 100);
  assert.equal(clampScore(-3), 0);
  assert.equal(clampScore(Number.NaN), 0);
  assert.equal(twoSentences("Een. Twee! Drie? Vier."), "Een. Twee!");
  assert.equal(twoSentences("Geen punt"), "Geen punt");
});

test("advanceStage only moves forward", () => {
  assert.equal(advanceStage("intake", "zoeken"), "zoeken");
  assert.equal(advanceStage("gesprekken", "zoeken"), "gesprekken");
  assert.equal(advanceStage("zoeken", "profielen_verstuurd"), "profielen_verstuurd");
});

test("readSearchBrief tolerates missing or partial JSON", () => {
  assert.equal(readSearchBrief(null), null);
  assert.equal(readSearchBrief({ keywords: ["x"] }), null);
  const brief = readSearchBrief({
    keywords: ["Python"],
    linkedin_boolean: "(Python) AND Snowflake",
    naukri_boolean: "Python AND Snowflake",
    titles: ["Data Engineer"],
    locations: ["Bangalore"],
    min_years: 5,
    notes: [],
    generated_at: "2026-10-20T10:00:00Z",
    scored: 12,
    strong: 1,
  });
  assert.equal(brief?.strong, 1);
});

// ---------------------------------------------------------------------------
// Lead time (T6)
// ---------------------------------------------------------------------------

test("lead time warns from 14 days and turns red after 21 without profiles", () => {
  const now = new Date("2026-10-24T12:00:00Z");
  const base = { profiles_sent_at: null, talent_stage: "zoeken" };
  assert.equal(leadTime({ ...base, intake_at: null }, now).level, "none");
  assert.equal(leadTime({ ...base, intake_at: "2026-10-20T12:00:00Z" }, now).level, "ok");
  assert.equal(leadTime({ ...base, intake_at: "2026-10-10T12:00:00Z" }, now).level, "warning");
  const late = leadTime({ ...base, intake_at: "2026-09-30T12:00:00Z" }, now);
  assert.equal(late.level, "danger");
  assert.equal(late.days, 24);
  const done = leadTime({ intake_at: "2026-10-01T12:00:00Z", profiles_sent_at: "2026-10-15T12:00:00Z", talent_stage: "profielen_verstuurd" }, now);
  assert.equal(done.level, "done");
  assert.equal(done.days, 14);
});
