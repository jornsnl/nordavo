import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatDays,
  formatPercent,
  funnelShare,
  hasPoolFilter,
  pageCount,
  parsePoolParams,
  poolArgs,
  poolHref,
  poolQuery,
  scoreBuckets,
  sortHref,
} from "@/lib/academy/ats/pool";
import { placementWelcomeMail, stuckReminderMail, topCandidateMail } from "@/lib/academy/ats/mail";
import { DRAFT_TITLES, draftInput, draftSystemPrompt, lessonDraftSchema, normalizeDraft, transcriptDraft } from "@/lib/academy/ats/draft";
import { jobModule } from "@/lib/modules";
import { isMailCategory } from "@/lib/notify/categories";

const BASE = "/dashboard/candidates/academy";

test("pool parameters: known filters only, defaults dropped", () => {
  const f = parsePoolParams({
    q: "  ravi ",
    enrolled: "yes",
    state: "in_progress",
    inactive: "yes",
    certificate: "no",
    top: "1",
    min_progress: "250",
    min_check: "abc",
    vacancy: "00000000-0000-0000-0000-000000000001",
    group: "not-a-uuid",
    sort: "check",
    dir: "desc",
    page: "3",
  });
  assert.equal(f.q, "ravi");
  assert.equal(f.enrolled, true);
  assert.equal(f.state, "in_progress");
  assert.equal(f.inactive, true);
  assert.equal(f.certificate, false);
  assert.equal(f.top, true);
  assert.equal(f.minProgress, 100);
  assert.equal(f.minCheck, undefined);
  assert.equal(f.vacancy, "00000000-0000-0000-0000-000000000001");
  assert.equal(f.group, undefined);
  assert.equal(f.sort, "check");
  assert.equal(f.desc, true);
  assert.equal(f.page, 3);

  const empty = parsePoolParams({ sort: "drop table", state: "rejected", page: "-1", inactive: "no" });
  assert.deepEqual(empty, parsePoolParams({}));
  assert.equal(empty.sort, "name");
  assert.equal(empty.page, 1);
  assert.equal(hasPoolFilter(empty), false);
  assert.equal(hasPoolFilter(f), true);
});

test("pool arguments page through the database function", () => {
  const f = parsePoolParams({ enrolled: "no", page: "2", sort: "progress" });
  const args = poolArgs(f, 50);
  assert.equal(args.p_enrolled, false);
  assert.equal(args.p_sort, "progress");
  assert.equal(args.p_desc, false);
  assert.equal(args.p_limit, 50);
  assert.equal(args.p_offset, 50);
  assert.equal(args.p_search, null);
  assert.equal(args.p_inactive, null);
});

test("pool links keep the filters and round-trip", () => {
  const f = parsePoolParams({ q: "data", top: "yes", sort: "watch", dir: "desc", page: "2" });
  assert.deepEqual(parsePoolParams(Object.fromEntries(poolQuery(f))), f);
  assert.equal(poolHref(BASE, parsePoolParams({})), BASE);
  assert.match(poolHref(BASE, f, { page: 3 }), /page=3/);
  // A new column sorts high to low first (names A to Z); the same column flips.
  assert.match(sortHref(BASE, f, "progress"), /sort=progress&dir=desc/);
  assert.doesNotMatch(sortHref(BASE, f, "watch"), /dir=desc/);
  assert.doesNotMatch(sortHref(BASE, f, "name"), /sort=|dir=/);
  assert.doesNotMatch(sortHref(BASE, f, "watch"), /page=/);
});

test("pool formatting", () => {
  assert.equal(formatDays(null), "");
  assert.equal(formatDays(0), "today");
  assert.equal(formatDays(1), "1 day");
  assert.equal(formatDays(12), "12 days");
  assert.equal(formatPercent(66.6), "67%");
  assert.equal(formatPercent(null), "");
  assert.equal(pageCount(0), 1);
  assert.equal(pageCount(101, 50), 3);
});

test("funnel shares and score buckets", () => {
  assert.equal(funnelShare(3, 4), 75);
  assert.equal(funnelShare(5, 0), 0);
  assert.equal(funnelShare(9, 4), 100);
  const buckets = scoreBuckets({ "0-49": 1, "50-69": 0, "70-89": 2, "90-100": 1, none: 7 });
  assert.deepEqual(buckets.map((b) => b.bucket), ["0-49", "50-69", "70-89", "90-100"]);
  assert.deepEqual(buckets.map((b) => b.share), [25, 0, 50, 25]);
  assert.ok(scoreBuckets(null).every((b) => b.count === 0 && b.share === 0));
});

test("reminder mail: language, next lesson, escaped", () => {
  const en = stuckReminderMail({
    name: "Ravi Kumar",
    locale: "en",
    courseTitle: "Working in a Dutch team",
    lessonTitle: "Saying no <politely>",
    url: "https://portal.nordavo.nl/academy/courses/c/lessons/l",
    daysInactive: 9,
    siteUrl: "https://portal.nordavo.nl",
  });
  assert.equal(en.subject, "Continue with Working in a Dutch team");
  assert.match(en.html, /Hi Ravi,/);
  assert.match(en.html, /9 days/);
  assert.ok(!en.html.includes("<politely>"));
  assert.match(en.text, /Continue: https:\/\/portal\.nordavo\.nl\/academy\/courses\/c\/lessons\/l/);
  const nl = stuckReminderMail({ name: "Sabine", locale: "nl", courseTitle: "Klantcourse", lessonTitle: "Les", url: "https://x/y", daysInactive: 8 });
  assert.equal(nl.subject, "Ga verder met Klantcourse");
  assert.match(nl.html, /Ga verder/);
});

test("welcome mails for developer and client", () => {
  const dev = placementWelcomeMail({
    name: "Asha Rao",
    locale: "en",
    audience: "developer",
    clientName: "Klant & Co",
    developerName: "Asha Rao",
    startDate: "2026-12-01",
    url: "https://portal/login?next=/academy",
    linkKind: "login",
  });
  assert.equal(dev.subject, "Welcome to Klant & Co");
  assert.match(dev.html, /Klant &amp; Co/);
  assert.match(dev.text, /Klant & Co/);
  assert.match(dev.text, /2026-12-01/);
  assert.match(dev.html, /Open the Academy/);
  const client = placementWelcomeMail({
    name: "Sabine de Vries",
    locale: "nl",
    audience: "client",
    clientName: "KG",
    developerName: "Asha",
    startDate: "2026-12-01",
    url: "https://portal/auth/confirm?x",
    linkKind: "new",
  });
  assert.match(client.subject, /Asha start bij jullie/);
  assert.match(client.html, /Hoi Sabine,/);
  assert.match(client.html, /Stel je wachtwoord in/);
  assert.match(client.text, /module 1/);
});

test("top candidate mail lists the modules", () => {
  const mail = topCandidateMail({ name: "Ravi", locale: "en", moduleTitles: ["Working independently", "Quality <and> growth"], url: "https://x" });
  assert.equal(mail.subject, "New modules are open for you");
  assert.match(mail.html, /<li>Working independently<\/li>/);
  assert.ok(!mail.html.includes("<and>"));
  assert.match(mail.text, /- Quality <and> growth/);
});

test("mail categories and job module", () => {
  for (const c of ["academy_welcome", "academy_top_candidate", "academy_reminder"]) assert.ok(isMailCategory(c), c);
  assert.equal(jobModule("academy-reminders"), "academy");
  assert.equal(jobModule("academy-ats-sync"), "academy");
  assert.equal(jobModule("forms-reminders"), "recruitment");
});

test("AI draft is normalised to what the tables take", () => {
  const raw = lessonDraftSchema.parse({
    explanation_html: "<h2>Saying no</h2><p>Dutch teams value directness.</p>",
    tasks: [
      { title: "  Block your overlap window  ", description: "", deadline_offset_days: 0 },
      { title: "", description: "dropped", deadline_offset_days: null },
      { title: "Plan week 2", description: "Write the plan", deadline_offset_days: 99999 },
    ],
    questions: [
      { question: "Q1", options: ["a", "b", "c"], correct_index: 1, explanation: "because" },
      { question: "Q2", options: ["a"], correct_index: 0, explanation: "too few options" },
      { question: "Q3", options: ["a", "b"], correct_index: 5, explanation: "bad index" },
      { question: "Q4", options: ["a", "b", "c", "d"], correct_index: 3, explanation: "" },
      { question: "Q5", options: ["a", "b"], correct_index: 0, explanation: "x" },
      { question: "Q6", options: ["a", "b"], correct_index: 0, explanation: "over the limit" },
    ],
  });
  const draft = normalizeDraft(raw);
  assert.equal(draft.tasks.length, 2);
  assert.equal(draft.tasks[0].title, "Block your overlap window");
  assert.equal(draft.tasks[0].description, null);
  assert.equal(draft.tasks[0].deadline_offset_days, 0);
  assert.equal(draft.tasks[1].deadline_offset_days, 3650);
  assert.deepEqual(draft.questions.map((q) => q.question), ["Q1", "Q4", "Q5"]);
  assert.equal(draft.questions[1].explanation, null);
  assert.equal(DRAFT_TITLES.knowledge_check, "Draft: knowledge check");
});

test("without AI the transcript becomes the draft explanation", () => {
  const vtt = "WEBVTT\n\n1\n00:00:01.000 --> 00:00:04.000\nWelcome to the team.\n\n2\n00:00:05.000 --> 00:00:08.000\nIn the Netherlands <we> say no.";
  const draft = transcriptDraft(vtt, "en");
  assert.equal(draft.tasks.length, 0);
  assert.equal(draft.questions.length, 0);
  assert.match(draft.explanationHtml, /<h2>Transcript \(draft, to be edited\)<\/h2>/);
  assert.match(draft.explanationHtml, /<p>Welcome to the team\.<\/p>/);
  assert.match(draft.explanationHtml, /&lt;we&gt;/);
  assert.doesNotMatch(draft.explanationHtml, /-->|WEBVTT/);
  assert.match(transcriptDraft("Hallo", "nl").explanationHtml, /concept/);
});

test("draft prompt follows the lesson language and caps the transcript", () => {
  assert.match(draftSystemPrompt("nl"), /Dutch/);
  assert.match(draftSystemPrompt("en"), /English/);
  assert.match(draftSystemPrompt("en"), /Exactly three/);
  const input = draftInput({ lessonTitle: "Escalating", transcript: "x".repeat(70_000) });
  assert.match(input, /^Lesson: Escalating/);
  assert.ok(input.length < 61_000);
});
