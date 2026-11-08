import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync, deflateSync } from "node:zlib";
import {
  CandidateIndex,
  cleanLinkedin,
  cleanPhone,
  dedupeKeys,
  detectPreset,
  draftFromRow,
  fillEmpty,
  guessCandidateMapping,
  parseYears,
  phoneKey,
  splitSkills,
} from "@/lib/screening/candidate-csv";
import { cvFileKind, heuristicFields, nameFromFileName, sniffMatches } from "@/lib/screening/cv-text";
import { extractDocxText, wordXmlToText } from "@/lib/screening/docx";
import { extractPdfText, looksLikeText, textFromContentStream } from "@/lib/screening/pdf-text";
import {
  compareScores,
  costUsd,
  MUST_HAVE_CAP,
  normalizeScore,
  rankApplications,
  readBreakdown,
  scoringRequirements,
  verdictFor,
} from "@/lib/screening/scoring";
import { evaluateTechstack, matchedExcludedProfile, planTechstackMoves, profileCore, requiredHits, type TechstackRules } from "@/lib/screening/techstack";
import { requirementsFromText } from "@/lib/screening/talent-query";

// ---------------------------------------------------------------------------
// CSV header detection and mapping
// ---------------------------------------------------------------------------

test("detectPreset recognises LinkedIn, Naukri and Manatal exports, and falls back to a sheet", () => {
  assert.equal(detectPreset(["First Name", "Last Name", "Headline", "Profile URL", "Email"]), "linkedin");
  assert.equal(detectPreset(["Name", "Email ID", "Phone No", "Total Experience", "Key Skills", "Current Designation"]), "naukri");
  assert.equal(detectPreset(["Full Name", "Email", "Phone Number", "Current Position", "Current Company", "Source"]), "manatal");
  assert.equal(detectPreset(["Candidate Name", "Phone Number", "Email ID?", "Notes"]), "sheet");
});

test("guessCandidateMapping maps Naukri headers", () => {
  const headers = ["Name", "Email ID", "Phone No", "Current Location", "Total Experience", "Current Designation", "Current Company", "Key Skills", "Resume Headline"];
  const m = guessCandidateMapping(headers);
  assert.equal(m.full_name, "Name");
  assert.equal(m.email, "Email ID");
  assert.equal(m.phone, "Phone No");
  assert.equal(m.location, "Current Location");
  assert.equal(m.years_experience, "Total Experience");
  assert.equal(m.current_title, "Current Designation");
  assert.equal(m.current_company, "Current Company");
  assert.equal(m.skills, "Key Skills");
  assert.equal(m.summary, "Resume Headline");
});

test("guessCandidateMapping maps a hiring sheet with Airtable style columns", () => {
  const headers = ["Candidate Name", "Phone Number", "Email ID", "Total Experience (Years)", "LinkedIn URL", "Current Company", "Video link", "Judith notes"];
  const m = guessCandidateMapping(headers, "sheet");
  assert.equal(m.full_name, "Candidate Name");
  assert.equal(m.phone, "Phone Number");
  assert.equal(m.email, "Email ID");
  assert.equal(m.years_experience, "Total Experience (Years)");
  assert.equal(m.linkedin_url, "LinkedIn URL");
  assert.equal(m.video_url, "Video link");
  // A column is never used twice.
  assert.equal(new Set(Object.values(m)).size, Object.values(m).length);
});

test("guessCandidateMapping handles LinkedIn first and last name columns", () => {
  const m = guessCandidateMapping(["First Name", "Last Name", "Headline", "Profile URL", "Email Address"]);
  assert.equal(m.first_name, "First Name");
  assert.equal(m.last_name, "Last Name");
  assert.equal(m.linkedin_url, "Profile URL");
  assert.equal(m.summary, "Headline");
  assert.equal(m.email, "Email Address");
});

test("parseYears reads the common experience formats", () => {
  assert.equal(parseYears("4 Year(s) 6 Month(s)"), 4);
  assert.equal(parseYears("4.5"), 4);
  assert.equal(parseYears("6+ yrs"), 6);
  assert.equal(parseYears("18 months"), 1);
  assert.equal(parseYears("7"), 7);
  assert.equal(parseYears("fresher"), null);
  assert.equal(parseYears(""), null);
});

test("draftFromRow normalises a row and skips rows without a name", () => {
  const mapping = { first_name: "First", last_name: "Last", email: "Email", phone: "Phone", linkedin_url: "Profile", skills: "Skills", years_experience: "Exp", current_company: "Company" };
  const ok = draftFromRow(
    { First: "PRIYA", Last: "SHARMA", Email: " Priya.S@Example.com, other@x.com", Phone: "+91 98450-12345", Profile: "in.linkedin.com/in/priya-s/?trk=x", Skills: "Python; dbt | Airflow, python", Exp: "5 yrs", Company: "Acme" },
    mapping,
  );
  assert.ok(ok.ok);
  if (ok.ok) {
    assert.equal(ok.draft.full_name, "Priya Sharma");
    assert.equal(ok.draft.email, "priya.s@example.com");
    assert.equal(ok.draft.phone, "+919845012345");
    assert.equal(ok.draft.linkedin_url, "https://www.linkedin.com/in/priya-s");
    assert.deepEqual(ok.draft.skills, ["Python", "dbt", "Airflow"]);
    assert.equal(ok.draft.years_experience, 5);
    assert.deepEqual(ok.draft.employers, ["Acme"]);
    assert.equal(ok.draft.location, null);
  }
  const noName = draftFromRow({ First: "", Last: "", Email: "a@b.co" }, mapping);
  assert.deepEqual(noName, { ok: false, reason: "No name" });
  const empty = draftFromRow({ First: "", Last: "", Email: "" }, mapping);
  assert.equal(empty.ok, false);
});

test("cleaners: phone, LinkedIn and skills", () => {
  assert.equal(cleanPhone("12345"), null);
  assert.equal(cleanPhone("098450 12345 / 080 1234567"), "09845012345");
  assert.equal(cleanLinkedin("https://example.com/in/x"), null);
  assert.equal(cleanLinkedin("linkedin.com/in/Ravi-K/"), "https://www.linkedin.com/in/ravi-k");
  assert.deepEqual(splitSkills("CI/CD, Node.js\nReact"), ["CI/CD", "Node.js", "React"]);
});

// ---------------------------------------------------------------------------
// Dedupe
// ---------------------------------------------------------------------------

test("phoneKey compares the last 10 digits", () => {
  assert.equal(phoneKey("+91 98450 12345"), phoneKey("09845012345"));
  assert.equal(phoneKey("12"), null);
});

test("CandidateIndex finds duplicates by email, LinkedIn and phone", () => {
  const index = new CandidateIndex([
    { id: "a", email: "Asha@Example.com", phone: null, linkedin_url: null },
    { id: "b", email: null, phone: "+91 98450 12345", linkedin_url: null },
    { id: "c", email: null, phone: null, linkedin_url: "https://www.linkedin.com/in/meera/" },
  ]);
  assert.deepEqual(index.find(dedupeKeys({ email: "asha@example.com", phone: null, linkedin_url: null })), { id: "a", on: "email" });
  assert.deepEqual(index.find(dedupeKeys({ email: null, phone: "9845012345", linkedin_url: null })), { id: "b", on: "phone" });
  assert.deepEqual(index.find(dedupeKeys({ email: null, phone: null, linkedin_url: "linkedin.com/in/Meera" })), { id: "c", on: "linkedin" });
  assert.equal(index.find(dedupeKeys({ email: "new@example.com", phone: "1234567890", linkedin_url: null })), null);
  // Email wins over phone when both match different records.
  assert.equal(index.find(dedupeKeys({ email: "asha@example.com", phone: "9845012345", linkedin_url: null }))?.id, "a");
});

test("fillEmpty fills empty fields and never overwrites", () => {
  const existing = { email: "x@y.com", phone: null, linkedin_url: null, current_title: "Data engineer", years_experience: null, skills: [], summary: null, video_url: null, employers: [] };
  const update = fillEmpty(existing, { email: "other@y.com", phone: "+911234567890", current_title: "Other", years_experience: 4, skills: ["SQL"] });
  assert.deepEqual(update, { phone: "+911234567890", years_experience: 4, skills: ["SQL"] });
});

// ---------------------------------------------------------------------------
// DOCX and PDF text
// ---------------------------------------------------------------------------

/** A minimal zip archive (deflated entries) for the DOCX fixture. */
function makeZip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content, "utf8");
    const compressed = deflateRawSync(data);
    const nameBuf = Buffer.from(name, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, compressed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + compressed.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

test("extractDocxText reads the body and the header of a tiny DOCX", () => {
  const docx = makeZip({
    "[Content_Types].xml": "<Types/>",
    "word/document.xml": `<?xml version="1.0"?><w:document ${W}><w:body><w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>Ravi Kumar</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">Senior Backend </w:t></w:r><w:r><w:t>Engineer</w:t></w:r></w:p><w:p><w:r><w:t>Skills:</w:t><w:tab/><w:t>Go, PostgreSQL &amp; Kafka</w:t></w:r></w:p></w:body></w:document>`,
    "word/header1.xml": `<w:hdr ${W}><w:p><w:r><w:t>ravi.kumar@example.com | +91 98450 12345</w:t></w:r></w:p></w:hdr>`,
  });
  const text = extractDocxText(docx);
  assert.equal(text, "ravi.kumar@example.com | +91 98450 12345\n\nRavi Kumar\nSenior Backend Engineer\nSkills: Go, PostgreSQL & Kafka");
  const fields = heuristicFields(text, "cv.docx");
  assert.equal(fields.email, "ravi.kumar@example.com");
  assert.equal(fields.phone, "+919845012345");
  assert.equal(fields.full_name, "Ravi Kumar");
  assert.throws(() => extractDocxText(makeZip({ "other.xml": "<x/>" })), /not a Word document/);
  assert.throws(() => extractDocxText(Buffer.from("not a zip")), /zip/);
});

test("wordXmlToText decodes entities and line breaks", () => {
  assert.equal(wordXmlToText(`<w:p><w:r><w:t>A&lt;B&#233;</w:t><w:br/><w:t>C</w:t></w:r></w:p>`), "A<Bé\nC");
});

test("light PDF extraction reads simple text operators", () => {
  assert.equal(textFromContentStream("BT /F1 12 Tf 72 700 Td (Hello) Tj 0 -14 Td [(Wor) -20 (ld) -400 (again)] TJ ET"), "Hello\nWorld again\n");
  const sentence = "Senior data engineer with seven years of experience building pipelines in Python and SQL for retail and banking clients.";
  const content = Array.from({ length: 4 }, (_, i) => `BT 72 ${700 - i * 14} Td (${sentence}) Tj ET`).join("\n");
  const stream = deflateSync(Buffer.from(content, "latin1"));
  const pdf = Buffer.concat([
    Buffer.from("%PDF-1.4\n1 0 obj\n<< /Length " + stream.length + " /Filter /FlateDecode >>\nstream\n", "latin1"),
    stream,
    Buffer.from("\nendstream\nendobj\n%%EOF", "latin1"),
  ]);
  const text = extractPdfText(pdf);
  assert.ok(text.includes("seven years of experience"));
  assert.ok(looksLikeText(text));
  assert.equal(looksLikeText("ÿþ ÿþ 0x12 ¤¤¤ ".repeat(40)), false);
  assert.equal(extractPdfText(Buffer.from("not a pdf")), "");
});

test("CV file kinds, magic bytes and names from file names", () => {
  assert.equal(cvFileKind("Ravi CV.PDF", "application/pdf"), "pdf");
  assert.equal(cvFileKind("cv.docx", ""), "docx");
  assert.equal(cvFileKind("cv.exe", "application/pdf"), null);
  assert.equal(cvFileKind("cv.pdf", "image/png"), null);
  assert.equal(sniffMatches("pdf", Buffer.from("%PDF-1.7")), true);
  assert.equal(sniffMatches("docx", Buffer.from("%PDF")), false);
  assert.equal(nameFromFileName("Priya_Sharma-CV (2).pdf"), "Priya Sharma");
  assert.equal(nameFromFileName("resume_final_2024.pdf"), null);
});

// ---------------------------------------------------------------------------
// Techstack rules
// ---------------------------------------------------------------------------

const backend: TechstackRules = { stack: ["Node.js", "PostgreSQL", "TypeScript", "AWS"], must_haves: [], excluded_profiles: ["Frontend only", "QA"], techstack_min_hits: null };

test("requiredHits: about half the stack, at least 1, at most 3, or the vacancy setting", () => {
  assert.equal(requiredHits(backend), 2);
  assert.equal(requiredHits({ ...backend, stack: ["Go"] }), 1);
  assert.equal(requiredHits({ ...backend, stack: ["a", "b", "c", "d", "e", "f", "g", "h"] }), 3);
  assert.equal(requiredHits({ ...backend, techstack_min_hits: 4 }), 4);
  assert.equal(requiredHits({ ...backend, techstack_min_hits: 9 }), 4);
});

test("evaluateTechstack: pass, fail, unclear", () => {
  const pass = evaluateTechstack(backend, { skills: ["node", "Postgres", "Docker"], currentTitle: "Backend developer", summary: null, cvText: null });
  assert.equal(pass.result, "pass");
  assert.deepEqual(pass.hits, ["Node.js", "PostgreSQL"]);

  const frontend = evaluateTechstack(backend, { skills: ["React", "CSS"], currentTitle: "Front-end Developer", summary: null, cvText: null });
  assert.equal(frontend.result, "fail");
  assert.match(frontend.reason, /Excluded profile \(Frontend only\)/);

  const frontendWithNode = evaluateTechstack(backend, { skills: ["React", "Node.js"], currentTitle: "Frontend engineer", summary: null, cvText: null });
  assert.equal(frontendWithNode.result, "unclear");

  const noStack = evaluateTechstack(backend, { skills: ["Java", "Spring"], currentTitle: "Software engineer", summary: null, cvText: "Built banking apps in Java." });
  assert.equal(noStack.result, "fail");
  assert.match(noStack.reason, /None of the stack/);

  const oneHit = evaluateTechstack(backend, { skills: ["AWS", "Java"], currentTitle: "Engineer", summary: null, cvText: null });
  assert.equal(oneHit.result, "unclear");

  const nothing = evaluateTechstack(backend, { skills: [], currentTitle: null, summary: null, cvText: null });
  assert.equal(nothing.result, "unclear");

  const titleOnly = evaluateTechstack(backend, { skills: [], currentTitle: "Software engineer", summary: null, cvText: null });
  assert.equal(titleOnly.result, "unclear");
});

test("excluded profiles match title variants and not unrelated words", () => {
  assert.equal(profileCore("Frontend only"), "frontend");
  const c = (title: string) => ({ skills: [], currentTitle: title, summary: null, cvText: null });
  assert.equal(matchedExcludedProfile(["frontend"], c("Front End Developer")), "frontend");
  assert.equal(matchedExcludedProfile(["QA"], c("QA Automation Engineer")), "QA");
  assert.equal(matchedExcludedProfile(["QA"], c("Backend developer (quality focus)")), null);
});

test("planTechstackMoves groups fails by reason and never touches unclear", () => {
  const plan = planTechstackMoves([
    { applicationId: "1", result: "pass", reason: "Has 2 of 4" },
    { applicationId: "2", result: "fail", reason: "Excluded profile (QA)." },
    { applicationId: "3", result: "fail", reason: "Excluded profile (QA)." },
    { applicationId: "4", result: "unclear", reason: "?" },
  ]);
  assert.deepEqual(plan.pass, ["1"]);
  assert.deepEqual(plan.fail, [{ reason: "Techstack mismatch: Excluded profile (QA)", ids: ["2", "3"] }]);
});

// ---------------------------------------------------------------------------
// Score parsing
// ---------------------------------------------------------------------------

const vacancy = { stack: ["Python", "dbt", "Snowflake"], must_haves: ["5+ years Python", "dbt"], nice_to_haves: ["Airflow"] };

test("scoringRequirements derives must haves, alternatives and nice to haves", () => {
  assert.deepEqual(scoringRequirements(vacancy), [
    { label: "5+ years Python", kind: "must_have", alternatives: [] },
    { label: "dbt", kind: "must_have", alternatives: [] },
    { label: "Snowflake", kind: "alternative", alternatives: [] },
    { label: "Airflow", kind: "nice_to_have", alternatives: [] },
  ]);
  const rows = [
    { label: "BigQuery", kind: "alternative" as const, alternatives: ["Snowflake", "Redshift"], position: 2 },
    { label: "Python", kind: "must_have" as const, alternatives: [], position: 1 },
  ];
  assert.deepEqual(scoringRequirements(vacancy, rows).map((r) => r.label), ["Python", "BigQuery"]);
});

test("normalizeScore caps the score on a missing must have and sets the verdict", () => {
  const reqs = scoringRequirements(vacancy);
  const out = normalizeScore(
    {
      requirements: [
        { label: "5+ years python", status: "met", evidence: "Six years of Python." },
        { label: "dbt", status: "alternative", evidence: "Uses SQLMesh." },
        { label: "Snowflake", status: "alternative", evidence: "BigQuery." },
      ],
      match_percentage: 81.6,
      verdict: "fit",
      summary: "Strong   Python engineer.",
    },
    reqs,
  );
  assert.equal(out.mustHaveMissing, 1);
  assert.equal(out.score, MUST_HAVE_CAP);
  assert.equal(out.verdict, "no_fit");
  assert.equal(out.summary, "Strong Python engineer.");
  assert.equal(out.breakdown[1].status, "missing");
  assert.match(out.breakdown[1].evidence, /^Only an alternative/);
  assert.equal(out.breakdown[2].status, "alternative");
  // Airflow was skipped by the model: missing, but it is only a nice to have.
  assert.equal(out.breakdown[3].status, "missing");
  assert.equal(out.breakdown[3].kind, "nice_to_have");

  const good = normalizeScore(
    { requirements: reqs.map((r) => ({ label: r.label, status: "met", evidence: "yes" })), match_percentage: 140, verdict: "maybe", summary: "ok" },
    reqs,
  );
  assert.equal(good.score, 100);
  assert.equal(good.verdict, "fit");
});

test("verdictFor, ranking, breakdown reading, comparisons and cost", () => {
  assert.equal(verdictFor(70, 0), "fit");
  assert.equal(verdictFor(69, 0), "maybe");
  assert.equal(verdictFor(49, 0), "no_fit");
  assert.equal(verdictFor(95, 1), "no_fit");

  const ranked = rankApplications([
    { id: "a", cv_score: null, created_at: "2026-01-01" },
    { id: "b", cv_score: 60, created_at: "2026-01-03" },
    { id: "c", cv_score: 80, created_at: "2026-01-02" },
    { id: "d", cv_score: 60, created_at: "2026-01-01" },
  ]);
  assert.deepEqual(ranked.map((r) => r.id), ["c", "d", "b", "a"]);

  assert.deepEqual(readBreakdown([{ label: "Go", status: "met", kind: "alternative", evidence: "x" }, { nope: 1 }, "x"]), [
    { label: "Go", status: "met", kind: "alternative", evidence: "x" },
  ]);
  assert.deepEqual(readBreakdown(null), []);

  assert.deepEqual(compareScores([{ before: 60, after: 70 }, { before: 80, after: 76 }, { before: null, after: 50 }]), {
    compared: 2,
    meanDelta: 3,
    meanAbsDelta: 7,
    verdictChanges: 1,
  });

  assert.equal(costUsd({ model: "claude-opus-5-5", inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }), 4);
  assert.equal(costUsd({ model: "claude-haiku-5-5", inputTokens: 2000, outputTokens: 1000, cacheReadTokens: 10000, cacheWriteTokens: 0 }), 0.0008);
  assert.equal(costUsd({ model: "gpt", inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 }), null);
});

test("requirementsFromText turns a free text profile into stack skills", () => {
  const r = requirementsFromText("Senior data engineer with Python, dbt and Snowflake");
  assert.equal(r.seniority, "senior");
  assert.deepEqual(r.stack, ["data", "Python", "dbt", "Snowflake"]);
  assert.equal(requirementsFromText("lead react developer").seniority, "lead");
});
