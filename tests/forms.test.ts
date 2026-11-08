import { test } from "node:test";
import assert from "node:assert/strict";
import {
  answerText,
  checkCvFile,
  mapAnswers,
  normalizeUrl,
  parseSubmission,
  sourceFromAnswer,
} from "@/lib/forms/answers";
import { ctcBreakdown, formatEur, formatInr, hourlyBreakdown, inrToEur, parseInrAmount } from "@/lib/forms/compensation";
import { formatDeadline, inviteMail, reminderMail, applyUrl } from "@/lib/forms/mail-content";
import { localDate, parseAddressList, reminderDue, type InviteState } from "@/lib/forms/reminders";
import { blocksSchema, fieldName, readBlocks, type Block } from "@/lib/forms/schema";
import { cloneBlocks, freelanceTemplate, fulltimeTemplate } from "@/lib/forms/templates";
import { filterAndSort, type ResponseRow } from "@/lib/forms/responses";

function form(entries: [string, string | File][]) {
  const data = new FormData();
  for (const [k, v] of entries) data.append(k, v);
  return data;
}

const blocks: Block[] = [
  {
    id: "b1",
    title: "Details",
    questions: [
      { id: "name", type: "short_text", label: "Candidate Name", required: true, width: "full", mapsTo: "full_name" },
      { id: "mail", type: "email", label: "Email", required: true, width: "half", mapsTo: "email" },
      { id: "tel", type: "phone", label: "Phone", required: true, width: "half", mapsTo: "phone" },
      { id: "src", type: "single_choice", label: "How did you find us?", required: false, width: "full", options: ["LinkedIn", "Instagram (@nordavotalent)", "Other"], mapsTo: "source" },
      { id: "tools", type: "multiple_choice", label: "Tools", required: true, width: "full", options: ["Clay", "n8n", "Python"] },
      { id: "years", type: "number", label: "Total Experience", required: true, width: "half", mapsTo: "years_experience" },
      { id: "move", type: "yes_no", label: "Relocate", required: true, width: "half", mapsTo: "willing_to_relocate" },
      { id: "li", type: "url", label: "LinkedIn", required: false, width: "full", mapsTo: "linkedin_url" },
      { id: "video", type: "url", label: "Video", required: true, width: "full", mapsTo: "video_url" },
      { id: "cur", type: "current_ctc", label: "Current CTC", required: true, width: "half" },
      { id: "exp", type: "expected_ctc", label: "Expected CTC", required: false, width: "half" },
      { id: "cv", type: "file", label: "CV", required: true, width: "full", mapsTo: "cv" },
    ],
  },
];

function validEntries(): [string, string | File][] {
  return [
    [fieldName("name"), "  Asha Kumar "],
    [fieldName("mail"), "Asha@Example.IN"],
    [fieldName("tel"), "+91 98765 43210"],
    [fieldName("src"), "Instagram (@nordavotalent)"],
    [fieldName("tools"), "Clay"],
    [fieldName("tools"), "n8n"],
    [fieldName("tools"), "Clay"],
    [fieldName("years"), "4.6"],
    [fieldName("move"), "yes"],
    [fieldName("li"), "linkedin.com/in/asha"],
    [fieldName("video"), "https://drive.google.com/file/d/abc/view"],
    [fieldName("cur"), "12 LPA"],
    [fieldName("exp"), "15,00,000"],
    [fieldName("cv"), new File(["%PDF"], "cv.pdf", { type: "application/pdf" })],
  ];
}

test("parseSubmission accepts a valid form and normalises values", () => {
  const result = parseSubmission(blocks, form(validEntries()));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.answers.name, "Asha Kumar");
  assert.equal(result.answers.mail, "asha@example.in");
  assert.deepEqual(result.answers.tools, ["Clay", "n8n"]);
  assert.equal(result.answers.years, 4.6);
  assert.equal(result.answers.move, true);
  assert.equal(result.answers.li, "https://linkedin.com/in/asha");
  assert.equal(result.answers.cur, 1_200_000);
  assert.equal(result.answers.exp, 1_500_000);
  assert.equal(result.files.length, 1);
  assert.equal(result.answers.cv, undefined, "files are stored after the upload");
});

test("parseSubmission reports every problem by question id", () => {
  const result = parseSubmission(
    blocks,
    form([
      [fieldName("mail"), "not-an-email"],
      [fieldName("tel"), "12"],
      [fieldName("src"), "TikTok"],
      [fieldName("tools"), "Rust"],
      [fieldName("years"), "100"],
      [fieldName("move"), "maybe"],
      [fieldName("video"), "javascript:alert(1)"],
      [fieldName("cur"), "a lot"],
      [fieldName("cv"), new File(["x"], "cv.exe", { type: "application/octet-stream" })],
    ]),
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  for (const id of ["name", "mail", "tel", "src", "tools", "years", "move", "video", "cur", "cv"]) {
    assert.ok(result.errors[id], `error for ${id}`);
  }
  assert.equal(result.errors.exp, undefined, "optional and empty is fine");
});

test("checkCvFile limits type and size", () => {
  assert.equal(checkCvFile({ name: "CV.PDF", size: 1000, type: "application/pdf" }), null);
  assert.equal(checkCvFile({ name: "cv.docx", size: 1000, type: "" }), null);
  assert.match(checkCvFile({ name: "cv.pdf", size: 11 * 1024 * 1024, type: "application/pdf" }) ?? "", /at most 10 MB/);
  assert.ok(checkCvFile({ name: "cv.pdf.html", size: 10, type: "text/html" }));
  assert.ok(checkCvFile({ name: "cv.pdf", size: 10, type: "text/html" }), "mime must match");
});

test("mapAnswers fills candidate fields, compensation and source", () => {
  const result = parseSubmission(blocks, form(validEntries()));
  assert.ok(result.ok);
  const mapped = mapAnswers(blocks, result.answers);
  assert.deepEqual(mapped.candidate, {
    full_name: "Asha Kumar",
    email: "asha@example.in",
    phone: "+91 98765 43210",
    years_experience: 5,
    willing_to_relocate: true,
    linkedin_url: "https://linkedin.com/in/asha",
    video_url: "https://drive.google.com/file/d/abc/view",
  });
  assert.deepEqual(mapped.compensation, { current_ctc_inr_year: 1_200_000, expected_ctc_inr_year: 1_500_000 });
  assert.equal(mapped.source, "instagram");
});

test("mapAnswers falls back on a question labelled name", () => {
  const plain: Block[] = [{ id: "b", title: "", questions: [{ id: "n", type: "short_text", label: "Your name", required: true, width: "full" }] }];
  assert.equal(mapAnswers(plain, { n: "Ravi" }).candidate.full_name, "Ravi");
});

test("sourceFromAnswer", () => {
  assert.equal(sourceFromAnswer("LinkedIn"), "linkedin");
  assert.equal(sourceFromAnswer("Naukri.com"), "naukri");
  assert.equal(sourceFromAnswer("A friend told me"), "referral");
  assert.equal(sourceFromAnswer("Something else"), "other");
  assert.equal(sourceFromAnswer(""), null);
});

test("normalizeUrl and answerText", () => {
  assert.equal(normalizeUrl("example.com"), "https://example.com");
  assert.equal(normalizeUrl("http://x.nl"), "http://x.nl");
  assert.equal(answerText(["a", "b"]), "a, b");
  assert.equal(answerText(false), "No");
  assert.equal(answerText({ file_name: "cv.pdf" }), "cv.pdf");
  assert.equal(answerText(undefined), "");
});

test("parseInrAmount reads the ways candidates write rupees", () => {
  assert.equal(parseInrAmount("1200000"), 1_200_000);
  assert.equal(parseInrAmount("12,00,000"), 1_200_000);
  assert.equal(parseInrAmount("₹ 12,00,000"), 1_200_000);
  assert.equal(parseInrAmount("12 LPA"), 1_200_000);
  assert.equal(parseInrAmount("12.5 lakh"), 1_250_000);
  assert.equal(parseInrAmount("1.2 Cr"), 12_000_000);
  assert.equal(parseInrAmount("INR 950 per hour"), 950);
  assert.equal(parseInrAmount("800/hr"), 800);
  assert.equal(parseInrAmount("90k"), 90_000);
  assert.equal(parseInrAmount("about 12"), null);
  assert.equal(parseInrAmount("12-15 LPA"), null);
  assert.equal(parseInrAmount(""), null);
});

test("ctcBreakdown: per year, per month INR and per month EUR", () => {
  assert.deepEqual(ctcBreakdown(1_200_000, 100), { perYearInr: 1_200_000, perMonthInr: 100_000, perMonthEur: 1000 });
  assert.deepEqual(ctcBreakdown(1_000_000, 97.25), { perYearInr: 1_000_000, perMonthInr: 83_333.33, perMonthEur: 856.9 });
  assert.equal(ctcBreakdown(1_200_000, null).perMonthEur, null);
  assert.equal(ctcBreakdown(1_200_000, 0).perMonthEur, null);
});

test("hourlyBreakdown and inrToEur", () => {
  assert.deepEqual(hourlyBreakdown(800, 97.25), { perHourInr: 800, perHourEur: 8.23 });
  assert.equal(hourlyBreakdown(800).perHourEur, null);
  assert.equal(inrToEur(1000, -1), null);
});

test("formatInr uses Indian grouping, formatEur cents for small amounts", () => {
  assert.equal(formatInr(1_200_000), "₹12,00,000");
  assert.equal(formatEur(1030.4), "€1,030");
  assert.equal(formatEur(8.226), "€8.23");
  assert.equal(formatInr(null), "");
});

function invite(overrides: Partial<InviteState> = {}): InviteState {
  return {
    sentAt: "2026-11-01T09:00:00Z",
    deadline: "2026-11-05",
    completedAt: null,
    remindedAt: null,
    reminderCount: 0,
    stage: "fill_out",
    email: "asha@example.in",
    ...overrides,
  };
}

test("reminderDue: only after the deadline, once, never for finished or moved candidates", () => {
  const policy = { maxReminders: 1, intervalDays: 3 };
  const after = new Date("2026-11-06T10:00:00Z");
  assert.equal(reminderDue(invite(), policy, after), true);
  assert.equal(reminderDue(invite(), policy, new Date("2026-11-05T10:00:00Z")), false, "deadline day itself");
  assert.equal(reminderDue(invite({ completedAt: "2026-11-04T10:00:00Z" }), policy, after), false);
  assert.equal(reminderDue(invite({ deadline: null }), policy, after), false);
  assert.equal(reminderDue(invite({ sentAt: null }), policy, after), false);
  assert.equal(reminderDue(invite({ email: null }), policy, after), false);
  assert.equal(reminderDue(invite({ stage: "rejected" }), policy, after), false);
  assert.equal(reminderDue(invite({ stage: "video_review" }), policy, after), false);
  assert.equal(reminderDue(invite({ reminderCount: 1, remindedAt: "2026-11-06T10:00:00Z" }), policy, new Date("2026-11-20T10:00:00Z")), false);
  assert.equal(reminderDue(invite(), { maxReminders: 0, intervalDays: 3 }, after), false);
});

test("reminderDue: a second reminder waits for the interval", () => {
  const policy = { maxReminders: 2, intervalDays: 3 };
  const first = invite({ reminderCount: 1, remindedAt: "2026-11-06T10:00:00Z" });
  assert.equal(reminderDue(first, policy, new Date("2026-11-08T10:00:00Z")), false);
  assert.equal(reminderDue(first, policy, new Date("2026-11-09T10:00:00Z")), true);
});

test("localDate and parseAddressList", () => {
  assert.equal(localDate(new Date("2026-11-05T23:30:00Z")), "2026-11-06", "Amsterdam is ahead of UTC");
  assert.deepEqual(parseAddressList("Floris@nordavo.nl, floris@nordavo.nl; judith@nordavo.nl nope"), [
    "floris@nordavo.nl",
    "judith@nordavo.nl",
  ]);
  assert.deepEqual(parseAddressList(null), []);
});

test("mails carry the personal link, escape names and show the deadline", () => {
  const link = applyUrl("https://portal.nordavo.nl/", "a".repeat(64));
  assert.equal(link, `https://portal.nordavo.nl/apply/${"a".repeat(64)}`);
  const mail = inviteMail({ candidateName: "<b>Asha</b> K", vacancyTitle: "PHP developer", link, deadline: "2026-11-12" });
  assert.match(mail.subject, /PHP developer/);
  assert.ok(mail.html.includes(link));
  assert.ok(mail.text.includes(link));
  assert.ok(mail.html.includes("&lt;b&gt;Asha&lt;/b&gt;"));
  assert.ok(!mail.html.includes("<b>Asha"));
  assert.match(mail.text, /Thursday,? 12 November 2026/);
  const reminder = reminderMail({ candidateName: "Asha", vacancyTitle: "PHP developer", link, deadline: null });
  assert.match(reminder.subject, /Reminder/);
  assert.equal(formatDeadline("12-11-2026"), null);
});

test("templates are valid forms with unique ids and one question per field", () => {
  for (const template of [fulltimeTemplate("PHP & Laravel Developer"), freelanceTemplate("GTM Engineer")]) {
    const parsed = blocksSchema.safeParse(template.blocks);
    assert.ok(parsed.success, parsed.success ? "" : parsed.error.issues.map((i) => i.message).join(", "));
  }
  const full = fulltimeTemplate("PHP & Laravel Developer");
  assert.equal(full.title, "PHP & Laravel Developer Application Form");
  assert.equal(full.roleType, "fulltime");
  assert.ok(full.blocks.flatMap((b) => b.questions).some((q) => q.type === "expected_ctc"));
  const free = freelanceTemplate("GTM Engineer");
  assert.equal(free.blocks.length, 5);
  assert.ok(free.blocks.flatMap((b) => b.questions).some((q) => q.type === "hourly_rate"));
});

test("blocksSchema refuses broken forms", () => {
  const twoEmails: Block[] = [
    {
      id: "b",
      title: "",
      questions: [
        { id: "a", type: "email", label: "Mail", required: false, width: "full", mapsTo: "email" },
        { id: "b2", type: "email", label: "Mail 2", required: false, width: "full", mapsTo: "email" },
      ],
    },
  ];
  assert.equal(blocksSchema.safeParse(twoEmails).success, false);
  const noOptions = [{ id: "b", title: "", questions: [{ id: "a", type: "single_choice", label: "Pick" }] }];
  assert.equal(blocksSchema.safeParse(noOptions).success, false);
  const wrongTarget = [{ id: "b", title: "", questions: [{ id: "a", type: "long_text", label: "Mail", mapsTo: "email" }] }];
  assert.equal(blocksSchema.safeParse(wrongTarget).success, false);
  assert.deepEqual(readBlocks("nonsense"), []);
});

test("cloneBlocks gives fresh ids and keeps the content", () => {
  const original = fulltimeTemplate("X").blocks;
  const copy = cloneBlocks(original);
  assert.notEqual(copy[0].id, original[0].id);
  assert.notEqual(copy[0].questions[0].id, original[0].questions[0].id);
  assert.equal(copy[0].questions[0].label, original[0].questions[0].label);
});

test("filterAndSort: filter on answers and sort by a question", () => {
  const row = (id: string, candidateName: string, answers: Record<string, unknown>, submittedAt: string): ResponseRow => ({
    id,
    candidateId: id,
    candidateName,
    stage: "video_review",
    via: "general",
    formVersion: 1,
    answers,
    submittedAt,
  });
  const rows = [
    row("1", "Asha", { tools: ["Clay", "n8n"], years: 5, move: true }, "2026-11-02"),
    row("2", "Ravi", { tools: ["Python"], years: 2, move: false }, "2026-11-03"),
    row("3", "Meera", { years: 8 }, "2026-11-01"),
  ];
  const questions = blocks[0].questions;
  const tools = { ...questions[4], id: "tools" };
  const years = { ...questions[5], id: "years" };
  const move = { ...questions[6], id: "move" };
  const qs = [tools, years, move];
  assert.deepEqual(filterAndSort(rows, qs, { filters: { tools: "clay" } }).map((r) => r.id), ["1"]);
  assert.deepEqual(filterAndSort(rows, qs, { filters: { move: "no" } }).map((r) => r.id), ["2"]);
  assert.deepEqual(filterAndSort(rows, qs, { filters: { years: ">=5" } }).map((r) => r.id), ["1", "3"]);
  assert.deepEqual(filterAndSort(rows, qs, { sort: "years", dir: "desc" }).map((r) => r.id), ["3", "1", "2"]);
  assert.deepEqual(filterAndSort(rows, qs, { sort: "tools", dir: "asc" }).map((r) => r.id), ["1", "2", "3"], "empty answers last");
  assert.deepEqual(filterAndSort(rows, qs, {}).map((r) => r.id), ["2", "1", "3"], "newest first by default");
});
