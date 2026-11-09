import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import {
  ANSWER_OPTIONS,
  BAND_LABELS,
  CLIENT_INTRO_TEMPLATE,
  CONSENT_TEXT_TEMPLATE,
  DEVELOPER_INTRO_SENTENCE,
  DIMENSION_TEXTS,
  INSTRUMENT_VERSION,
  INTRO_CHECKBOX,
  INTRO_SECTIONS,
  ITEMS,
  PAGE_COUNT,
  PAGE_INSTRUCTION,
  PERSON_INTRO,
  REPORT_FOOTER,
  SCORE_TOOLTIP,
  VACANCY_SENTENCE,
  WATERMARK_TEMPLATE,
  WITHDRAWN_MAIL_TEMPLATE,
} from "@/lib/wsp/content";
import {
  bandFor,
  flagReason,
  itemScore,
  itemsOnPage,
  longestRun,
  qualityFlags,
  scoreAnswers,
  scoreFromMean,
  secondsPerStatement,
  type Answers,
  type PageTimes,
} from "@/lib/wsp/scoring";
import {
  consentText,
  pdfFileName,
  privacyUrl,
  reportIntro,
  shareChecked,
  shareStatus,
  splitName,
  splitPrivacy,
  watermarkText,
  withdrawnMailText,
} from "@/lib/wsp/text";
import { introFor, orderedDimensions, pageItems, progressPercent, firstOpenPage, vacancyTextWithSentence } from "@/lib/wsp/view";
import { buildReportPdf } from "@/lib/wsp/pdf";

function answersBy(rule: (item: (typeof ITEMS)[number]) => number): Answers {
  return Object.fromEntries(ITEMS.map((item) => [item.code, rule(item)]));
}
const asAsked = (item: (typeof ITEMS)[number], other: number) => (item.dimension === "check" ? (item.expected as number) : other);
const slow: PageTimes = { 1: 60000, 2: 60000, 3: 60000, 4: 60000, 5: 60000, 6: 12000 };

// ---------------------------------------------------------------------------
// Scoring: the four test cases of part 2
// ---------------------------------------------------------------------------

test("test case: all 50 answers 3 gives 50 and Middle everywhere", () => {
  const results = scoreAnswers(answersBy((item) => asAsked(item, 3)));
  assert.equal(results.length, 5);
  for (const r of results) {
    assert.equal(r.score, 50);
    assert.equal(r.band, "middle");
    assert.equal(r.mean, 3);
  }
});

test("test case: normal items 5 and reversed items 1 gives 100", () => {
  const results = scoreAnswers(answersBy((item) => asAsked(item, item.key === "normal" ? 5 : 1)));
  assert.deepEqual(results.map((r) => r.score), [100, 100, 100, 100, 100]);
  assert.ok(results.every((r) => r.band === "higher"));
});

test("test case: normal items 1 and reversed items 5 gives 0", () => {
  const results = scoreAnswers(answersBy((item) => asAsked(item, item.key === "normal" ? 1 : 5)));
  assert.deepEqual(results.map((r) => r.score), [0, 0, 0, 0, 0]);
  assert.ok(results.every((r) => r.band === "lower"));
});

test("test case: mean 3.6 gives 65 Middle, mean 3.64 gives 66 Higher side", () => {
  assert.equal(scoreFromMean(3.6), 65);
  assert.equal(bandFor(scoreFromMean(3.6)), "middle");
  assert.equal(scoreFromMean(3.64), 66);
  assert.equal(bandFor(scoreFromMean(3.64)), "higher");
  // A dimension whose ten item scores average 3.6 (six 4s and four 3s).
  const e = ITEMS.filter((item) => item.dimension === "E");
  const answers = answersBy((item) => asAsked(item, 3));
  e.forEach((item, i) => {
    const score = i < 6 ? 4 : 3;
    answers[item.code] = item.key === "reversed" ? 6 - score : score;
  });
  const extraversion = scoreAnswers(answers).find((r) => r.dimension === "E");
  assert.equal(extraversion?.mean, 3.6);
  assert.equal(extraversion?.score, 65);
  assert.equal(extraversion?.band, "middle");
});

test("scoring: item score, band limits, checks do not count, every statement required", () => {
  const reversed = ITEMS.find((item) => item.key === "reversed")!;
  const normal = ITEMS.find((item) => item.key === "normal")!;
  assert.equal(itemScore(reversed, 2), 4);
  assert.equal(itemScore(normal, 2), 2);
  assert.equal(bandFor(34), "lower");
  assert.equal(bandFor(35), "middle");
  assert.equal(bandFor(65), "middle");
  assert.equal(bandFor(66), "higher");
  assert.equal(scoreFromMean(1), 0);
  assert.equal(scoreFromMean(5), 100);
  assert.equal(scoreFromMean(3.3), 58); // 57.5 rounds up, as round() on a numeric in Postgres
  const withWrongChecks = answersBy((item) => (item.dimension === "check" ? 5 : 3));
  assert.ok(scoreAnswers(withWrongChecks).every((r) => r.score === 50));
  const missing = answersBy((item) => asAsked(item, 3));
  delete missing.O10;
  assert.throws(() => scoreAnswers(missing), /O10/);
});

// ---------------------------------------------------------------------------
// Quality flags (staff only)
// ---------------------------------------------------------------------------

test("flags: none for careful varied answers", () => {
  const answers = answersBy((item) => asAsked(item, 1 + ((item.position * 7) % 5)));
  assert.deepEqual(qualityFlags(answers, slow), []);
});

test("flags: attention check, too fast, straightlining, yes saying", () => {
  const all5 = answersBy(() => 5);
  const fast: PageTimes = { 1: 1000, 2: 1000, 3: 1000, 4: 1000, 5: 1000, 6: 200 };
  const flags = qualityFlags(all5, fast);
  assert.deepEqual(flags.map((f) => f.type).sort(), ["attention_check_failed", "straightlining", "too_fast", "yes_saying"]);
  assert.deepEqual(flags.find((f) => f.type === "attention_check_failed")?.details, { CHK1: 5, CHK2: 5 });
  assert.equal(flags.find((f) => f.type === "too_fast")?.details.seconds_per_statement, 0.1);
  assert.equal(flags.find((f) => f.type === "straightlining")?.details.run, 52);
});

test("flags: CHK1 must be 4 and CHK2 must be 1", () => {
  const ok = answersBy((item) => asAsked(item, 1 + ((item.position * 7) % 5)));
  assert.deepEqual(qualityFlags({ ...ok, CHK2: 2 }, slow).map((f) => f.type), ["attention_check_failed"]);
  assert.deepEqual(qualityFlags({ ...ok, CHK1: 3 }, slow).map((f) => f.type), ["attention_check_failed"]);
});

test("flags: too fast uses time per page divided by the statements on it, pages over 10 minutes left out", () => {
  assert.equal(itemsOnPage(1).length, 10);
  assert.equal(itemsOnPage(6).length, 2);
  assert.equal(secondsPerStatement({ 1: 10000, 6: 2000 }), 1);
  assert.equal(secondsPerStatement({ 1: 10000, 2: 11 * 60 * 1000 }), 1);
  assert.equal(secondsPerStatement({ 1: 11 * 60 * 1000 }), null);
  assert.equal(secondsPerStatement({ 1: 20000, 2: 20000, 3: 20000, 4: 20000, 5: 20000, 6: 4000 }), 2);
});

test("flags: straightlining is 12 or more in a row, yes saying from 4.2", () => {
  const answers = answersBy((item) => asAsked(item, 1 + ((item.position * 7) % 5)));
  for (const item of ITEMS.slice(0, 11)) answers[item.code] = 2;
  assert.equal(longestRun(answers).length, 11);
  assert.ok(!qualityFlags(answers, slow).some((f) => f.type === "straightlining"));
  for (const item of ITEMS.slice(0, 12)) answers[item.code] = 2;
  assert.ok(qualityFlags(answers, slow).some((f) => f.type === "straightlining"));

  const yes = answersBy((item) => asAsked(item, 4));
  for (const item of ITEMS.filter((i) => i.dimension !== "check").slice(0, 10)) yes[item.code] = 5; // mean 4.2
  assert.ok(qualityFlags(yes, slow).some((f) => f.type === "yes_saying"));
  const almost = answersBy((item) => asAsked(item, 4));
  for (const item of ITEMS.filter((i) => i.dimension !== "check").slice(0, 9)) almost[item.code] = 5; // mean 4.18
  assert.ok(!qualityFlags(almost, slow).some((f) => f.type === "yes_saying"));
});

test("flag reasons are readable", () => {
  assert.match(flagReason({ type: "too_fast", details: { seconds_per_statement: 0.4 } }), /0.4 seconds/);
  assert.match(flagReason({ type: "attention_check_failed", details: { CHK1: 2 } }), /CHK1 answered 2/);
});

// ---------------------------------------------------------------------------
// The statements and texts are exact
// ---------------------------------------------------------------------------

test("52 statements in fixed order, 10 per page, the same as the SQL seed", () => {
  assert.equal(ITEMS.length, 52);
  assert.deepEqual(ITEMS.map((i) => i.position), Array.from({ length: 52 }, (_, i) => i + 1));
  assert.equal(PAGE_COUNT, 6);
  assert.equal(INSTRUMENT_VERSION, "nordavo-wsp-v1");
  for (const dim of ["E", "A", "C", "S", "O"]) assert.equal(ITEMS.filter((i) => i.dimension === dim).length, 10);
  assert.deepEqual(
    ITEMS.filter((i) => i.dimension === "check").map((i) => [i.position, i.code, i.expected]),
    [
      [23, "CHK1", 4],
      [44, "CHK2", 1],
    ],
  );
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/20261116000000_wsp_core.sql"), "utf8");
  const rows = [...sql.matchAll(/\('nordavo-wsp-v1', (\d+), '([A-Z0-9]+)', '((?:[^']|'')*)', '(\w+)', (?:'(\w+)'|null), (\d|null)\)/g)];
  assert.equal(rows.length, 52);
  for (const [, position, code, statement, dimension, key, expected] of rows) {
    const item = ITEMS[Number(position) - 1];
    assert.equal(item.code, code);
    assert.equal(item.statement, statement.replace(/''/g, "'"));
    assert.equal(item.dimension, dimension);
    assert.equal(item.key, key ?? null);
    assert.equal(item.expected, expected === "null" ? null : Number(expected));
  }
});

test("spot checks of the exact texts", () => {
  assert.equal(ITEMS[5].statement, "I don't talk a lot.");
  assert.equal(ITEMS[22].statement, 'For this statement, please select "Moderately accurate".');
  assert.equal(ITEMS[51].statement, "I am full of ideas.");
  assert.deepEqual(ANSWER_OPTIONS.map((o) => o.label), [
    "Very inaccurate",
    "Moderately inaccurate",
    "Neither accurate nor inaccurate",
    "Moderately accurate",
    "Very accurate",
  ]);
  assert.equal(PAGE_INSTRUCTION, "Describe yourself as you generally are now, not as you wish to be in the future.");
  assert.equal(DEVELOPER_INTRO_SENTENCE, "This is optional. Not completing it has no consequences for your role.");
  assert.equal(INTRO_CHECKBOX, "I have read this and want to start.");
  assert.equal(INTRO_SECTIONS.map((s) => s.bullets.length).join(","), "3,4,4");
  assert.equal(
    VACANCY_SENTENCE,
    "As part of the process, shortlisted candidates are invited to complete a short working style questionnaire (about 10 minutes). You always see your own results first.",
  );
  assert.deepEqual(DIMENSION_TEXTS.map((d) => d.name), ["Openness", "Conscientiousness", "Extraversion", "Agreeableness", "Emotional stability"]);
  assert.deepEqual(Object.values(BAND_LABELS), ["Lower side", "Middle", "Higher side"]);
  assert.ok(PERSON_INTRO.body.startsWith("This report describes your working style on five dimensions."));
  assert.ok(CLIENT_INTRO_TEMPLATE.body.endsWith("[first name] has seen this report and chose to share it with you."));
  assert.ok(SCORE_TOOLTIP.startsWith("This score shows where your answers fall"));
  assert.ok(REPORT_FOOTER.endsWith("(ipip.ori.org), public domain."));
  for (const d of DIMENSION_TEXTS) {
    for (const band of ["lower", "middle", "higher"] as const) {
      assert.ok(d.bands[band].forYou.length > 10 && d.bands[band].forEmployer.length > 10, `${d.name} ${band}`);
    }
  }
  // No text was left with a placeholder by mistake, except the defined ones.
  assert.ok(CONSENT_TEXT_TEMPLATE.includes("[client name]"));
  assert.ok(WITHDRAWN_MAIL_TEMPLATE.includes("[first name]"));
  assert.ok(WATERMARK_TEMPLATE.includes("[date of consent]"));
});

test("filling in names, intro per role, consent, mail, watermark, file name", () => {
  assert.deepEqual(splitName("Ravi  Kumar Shah"), { first: "Ravi", last: "Kumar Shah" });
  assert.deepEqual(splitName("Asha"), { first: "Asha", last: "" });
  assert.equal(reportIntro("person", "Ravi").heading, "About your report");
  const client = reportIntro("client", "Ravi");
  assert.equal(client.heading, "How to read this profile");
  assert.ok(client.body.startsWith("This profile shows how Ravi describes their own working style"));
  assert.ok(!client.body.includes("[first name]"));
  assert.deepEqual(reportIntro("staff", "Ravi"), client, "staff sees the client intro");
  assert.equal(consentText("KG"), "I agree that KG can view and download my Working Style Profile. I can withdraw this at any time.");
  assert.equal(
    withdrawnMailText("Ravi"),
    "Ravi has withdrawn permission to share their Working Style Profile with you. Please delete any downloaded copies.",
  );
  assert.equal(
    watermarkText("KG", "Ravi Kumar", "9 November 2026"),
    "Shared with KG by Ravi Kumar on 9 November 2026. Confidential. Delete when no longer needed or when consent is withdrawn.",
  );
  assert.equal(pdfFileName("Ravi Kumar", "2026-11-09T10:00:00Z"), "working-style-profile_ravi-kumar_2026-11-09.pdf");
  assert.equal(pdfFileName("José Müller-Smit", "2026-11-09T23:30:00Z"), "working-style-profile_jose-muller-smit_2026-11-10.pdf");
});

test("privacy link: placeholder replaced only by an http(s) address from the env", () => {
  const last = INTRO_SECTIONS[2].bullets[3];
  const parts = splitPrivacy(last);
  assert.ok(parts);
  assert.ok(parts.before.endsWith("Read our privacy statement "));
  assert.equal(parts.after, ".");
  assert.equal(privacyUrl("https://nordavo.nl/privacy"), "https://nordavo.nl/privacy");
  assert.equal(privacyUrl("javascript:alert(1)"), null);
  assert.equal(privacyUrl(undefined), null);
});

test("the share box is never ticked by default", () => {
  assert.equal(shareStatus([]), "not_shared");
  assert.equal(shareChecked(shareStatus([])), false);
  assert.equal(shareStatus([{ consented_at: "2026-01-01", revoked_at: "2026-02-01" }]), "withdrawn");
  assert.equal(shareChecked("withdrawn"), false);
  assert.equal(shareStatus([{ consented_at: "2026-01-01", revoked_at: "2026-02-01" }, { consented_at: "2026-03-01", revoked_at: null }]), "shared");
  assert.equal(shareChecked("shared"), true);
});

// ---------------------------------------------------------------------------
// Questionnaire and report view helpers
// ---------------------------------------------------------------------------

test("questionnaire: pages of 10, progress, continue on the first open page", () => {
  assert.equal(pageItems(ITEMS, 1).length, 10);
  assert.equal(pageItems(ITEMS, 6).map((i) => i.code).join(","), "S10,O10");
  assert.equal(progressPercent(26, 52), 50);
  const answered = new Set(ITEMS.slice(0, 13).map((i) => i.code));
  assert.equal(firstOpenPage(ITEMS, (item) => answered.has(item.code)), 2);
  assert.equal(firstOpenPage(ITEMS, () => true), 6);
});

test("developers get the extra sentence on top of the intro, candidates not", () => {
  assert.equal(introFor("developer").top, DEVELOPER_INTRO_SENTENCE);
  assert.equal(introFor("candidate").top, null);
});

test("report: dimensions in the order Openness, Conscientiousness, Extraversion, Agreeableness, Emotional stability", () => {
  const results = [
    { dimension: "E", score: 50, band: "middle", mean: 3 },
    { dimension: "A", score: 50, band: "middle", mean: 3 },
    { dimension: "C", score: 50, band: "middle", mean: 3 },
    { dimension: "S", score: 50, band: "middle", mean: 3 },
    { dimension: "O", score: 72, band: "higher", mean: 3.9 },
  ] as const;
  assert.deepEqual(orderedDimensions([...results]).map((d) => d.text.name), [
    "Openness",
    "Conscientiousness",
    "Extraversion",
    "Agreeableness",
    "Emotional stability",
  ]);
  assert.equal(orderedDimensions([...results])[0].score, 72);
});

test("vacancy text: the fixed sentence is added when the profile is on", () => {
  assert.equal(vacancyTextWithSentence("We hire.", true), `We hire.\n\n${VACANCY_SENTENCE}`);
  assert.equal(vacancyTextWithSentence(null, true), VACANCY_SENTENCE);
  assert.equal(vacancyTextWithSentence("We hire.", false), "We hire.");
});

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

const sampleReport = {
  fullName: "Ravi Kumar",
  roleLabel: "Backend developer",
  completedAt: "2026-11-09T10:00:00Z",
  results: [
    { dimension: "O", score: 72, band: "higher", mean: 3.9 },
    { dimension: "C", score: 50, band: "middle", mean: 3 },
    { dimension: "E", score: 20, band: "lower", mean: 1.8 },
    { dimension: "A", score: 50, band: "middle", mean: 3 },
    { dimension: "S", score: 50, band: "middle", mean: 3 },
  ],
} as const;

/** All text drawn in a PDF, page by page (pdf-lib writes hex strings in Flate streams). */
function pdfTexts(bytes: Uint8Array): string[] {
  const raw = Buffer.from(bytes);
  const out: string[] = [];
  let at = 0;
  while ((at = raw.indexOf("stream", at)) !== -1) {
    let start = at + 6;
    if (raw[start] === 0x0d) start += 1;
    if (raw[start] === 0x0a) start += 1;
    const end = raw.indexOf("endstream", start);
    if (end === -1) break;
    try {
      const content = inflateSync(raw.subarray(start, end)).toString("latin1");
      const strings = [...content.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)].map((m) => Buffer.from(m[1], "hex").toString("latin1"));
      if (strings.length) out.push(strings.join("\n"));
    } catch {
      // not a Flate stream
    }
    at = end + 9;
  }
  return out;
}

test("PDF: client PDF has the watermark on every page", async () => {
  const { PDFDocument } = await import("pdf-lib");
  const bytes = await buildReportPdf({
    ...sampleReport,
    results: [...sampleReport.results],
    audience: "client",
    watermark: { clientName: "KG", consentedAt: "2026-11-09T12:00:00Z" },
  });
  const doc = await PDFDocument.load(bytes);
  assert.ok(doc.getPageCount() >= 2, "five dimensions do not fit one page");
  const pages = pdfTexts(bytes);
  assert.equal(pages.length, doc.getPageCount());
  for (const page of pages) {
    assert.ok(page.includes("Shared with KG by Ravi Kumar on 9 November 2026. Confidential."), "watermark on every page");
  }
  const all = pages.join("\n");
  assert.ok(all.includes("How to read this profile"));
  assert.ok(all.includes("This profile shows how Ravi describes"));
  assert.ok(all.includes("72 / 100"));
  assert.ok(all.includes("Statements adapted from the International"));
  assert.ok(!/CHK|attention_check|too_fast|Interpret with caution/.test(all), "no flags or raw answers");
});

test("PDF: person and staff PDFs have no watermark and the right intro", async () => {
  for (const audience of ["person", "staff"] as const) {
    const bytes = await buildReportPdf({ ...sampleReport, results: [...sampleReport.results], audience, watermark: null });
    const all = pdfTexts(bytes).join("\n");
    assert.ok(!all.includes("Shared with"), "no watermark");
    const intro = audience === "person" ? "About your report" : "How to read this profile";
    assert.ok(all.includes(intro), audience);
    assert.ok(!/Interpret with caution|CHK1/.test(all));
  }
});

// ---------------------------------------------------------------------------
// Scores nowhere else (rule 2): only the feature's own files read them
// ---------------------------------------------------------------------------

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...filesUnder(path));
    else if (/\.(ts|tsx)$/.test(name)) out.push(path);
  }
  return out;
}

test("no list, board, search, talent pool or MCP code reads profile data", () => {
  const allowed = [/src\/lib\/wsp\//, /src\/components\/wsp\//, /working-style/, /src\/jobs\/wsp\.ts$/, /src\/lib\/database\.types\.ts$/];
  const offenders = filesUnder(join(process.cwd(), "src"))
    .filter((file) => !allowed.some((re) => re.test(file.replace(/\\/g, "/"))))
    .filter((file) =>
      /wsp_(results|answers|flags|report|client_reports)\b|\b(loadReport|listClientReports|getStaffAssessment|listMyAssessments|WspReportView)\b/.test(
        readFileSync(file, "utf8"),
      ),
    );
  assert.deepEqual(offenders, []);
});
