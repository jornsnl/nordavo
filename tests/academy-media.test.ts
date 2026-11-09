import { test } from "node:test";
import assert from "node:assert/strict";
import { academyMessages, t } from "@/lib/academy/i18n";
import { mediaEn, mediaNl } from "@/lib/academy/i18n-media";
import {
  checkDocumentFile,
  checkImageFile,
  checkVideoFile,
  documentFilePath,
  documentFormat,
  formatBytes,
  imageUrl,
  isNewDocument,
  pathBelongsTo,
  safeFileName,
  subtitlePath,
  videoContentType,
  videoFilePath,
} from "@/lib/academy/media/files";
import { cuesToTranscript, formatClock, formatTimestamp, normalizeSubtitles, parseCues, parseTimestamp, toVtt, transcriptCues, transcriptText } from "@/lib/academy/media/vtt";
import { coveredSeconds, mergeRanges, playedStep, rangesPayload, resumePosition, watchedPercent } from "@/lib/academy/media/watch";
import { answerText, answersCsv, fieldKey, isFilled, missingRequired, normalizeAnswers, normalizeFields } from "@/lib/academy/media/worksheet";
import { digestDue, digestMail, localClock } from "@/lib/academy/media/digest";
import { certificateFileName, renderCertificatePdf } from "@/lib/academy/media/certificate-pdf";
import { readVideoState, readWorksheetState, videoShowsTranscript } from "@/lib/academy/media/state";
import { blockTypes } from "@/lib/academy/blocks/types";

// ---------------------------------------------------------------------------
// i18n
// ---------------------------------------------------------------------------

test("media texts exist in both languages with the same placeholders, and are merged", () => {
  for (const key of Object.keys(mediaEn) as (keyof typeof mediaEn)[]) {
    assert.ok(mediaNl[key], `nl misses ${key}`);
    const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
    assert.equal(vars(mediaNl[key]), vars(mediaEn[key]), `placeholders of ${key}`);
    assert.equal(academyMessages.en[key], mediaEn[key]);
    assert.equal(academyMessages.nl[key], mediaNl[key]);
  }
  assert.equal(t("nl", "video.watched", { percent: 40 }), "40% bekeken");
  assert.equal(t("en", "document.version", { version: 3 }), "Version 3");
});

// ---------------------------------------------------------------------------
// Subtitles and transcripts
// ---------------------------------------------------------------------------

test("timestamps: VTT, short and SRT forms", () => {
  assert.equal(parseTimestamp("00:01:02.345"), 62.345);
  assert.equal(parseTimestamp("01:02.5"), 62.5);
  assert.equal(parseTimestamp("00:00:03,250"), 3.25);
  assert.equal(parseTimestamp("1:00:00.000"), 3600);
  assert.equal(parseTimestamp("00:61.000"), null);
  assert.equal(parseTimestamp("abc"), null);
  assert.equal(formatTimestamp(62.345), "00:01:02.345");
  assert.equal(formatTimestamp(3725.5), "01:02:05.500");
  assert.equal(formatClock(65), "1:05");
  assert.equal(formatClock(3725), "1:02:05");
});

test("parseCues reads WebVTT with ids and notes, and SRT", () => {
  const vtt = "WEBVTT\n\nNOTE made by hand\n\nintro\n00:00:01.000 --> 00:00:03.000 align:start\nHello <c.x>there</c>\n<b>friend</b>\n\n00:00:00.500 --> 00:00:00.900\nFirst\n\n00:00:05.000 --> 00:00:04.000\nBackwards";
  const cues = parseCues(vtt);
  assert.equal(cues.length, 2);
  assert.deepEqual(cues[0], { start: 0.5, end: 0.9, text: "First" });
  assert.equal(cues[1].text, "Hello there\n<b>friend</b>");

  const srt = "1\r\n00:00:01,000 --> 00:00:02,500\r\nOne\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\nTwo\r\n";
  assert.deepEqual(parseCues(srt), [
    { start: 1, end: 2.5, text: "One" },
    { start: 3, end: 4, text: "Two" },
  ]);
});

test("normalizeSubtitles turns SRT into clean WebVTT and refuses junk", () => {
  const result = normalizeSubtitles("1\n00:00:01,000 --> 00:00:02,000\nHoi\n");
  assert.ok(result.ok);
  if (result.ok) {
    assert.equal(result.vtt, "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHoi\n");
    assert.equal(result.cues, 1);
  }
  assert.equal(normalizeSubtitles("just some words").ok, false);
  assert.equal(normalizeSubtitles("x".repeat(2_000_001)).ok, false);
});

test("a timed transcript round-trips and becomes subtitles; plain text stays plain", () => {
  const cues = [
    { start: 0, end: 2.5, text: "Welcome." },
    { start: 2.5, end: 6, text: "This is the Academy." },
  ];
  const transcript = cuesToTranscript(cues);
  assert.ok(!transcript.startsWith("WEBVTT"));
  assert.deepEqual(transcriptCues(transcript), cues);
  assert.equal(toVtt(transcriptCues(transcript)!), `WEBVTT\n\n${transcript}\n`);
  assert.equal(transcriptText(transcript), "Welcome. This is the Academy.");
  assert.equal(transcriptCues("Gewoon tekst zonder tijden."), null);
  assert.equal(transcriptText("  Gewoon tekst. "), "Gewoon tekst.");
});

// ---------------------------------------------------------------------------
// Watch measurement
// ---------------------------------------------------------------------------

test("ranges merge, clip and count covered seconds once", () => {
  assert.deepEqual(
    mergeRanges([
      [10, 20],
      [0, 5],
      [5.5, 8],
      [15, 25],
    ]),
    [
      [0, 8],
      [10, 25],
    ],
  );
  assert.deepEqual(mergeRanges([[-3, 4], [90, 130], [7, 7]], { duration: 100 }), [
    [0, 4],
    [90, 100],
  ]);
  assert.equal(coveredSeconds([[0, 10], [5, 15]]), 15);
});

test("watchedPercent: real coverage, 100 when at most 1.5 s missing", () => {
  assert.equal(watchedPercent([[0, 45]], 100), 45);
  assert.equal(watchedPercent([[0, 45], [40, 50]], 100), 50);
  assert.equal(watchedPercent([[0, 98.6]], 100), 100);
  assert.equal(watchedPercent([], 100), 0);
  assert.equal(watchedPercent([[0, 10]], null), 0);
});

test("playedStep counts continuous playback, not seeks", () => {
  // 1 second of wall time at 1x: a quarter-second update counts.
  assert.deepEqual(playedStep(10, 10.25, 1, 250), [10, 10.25]);
  // At 2x the media moves twice as fast.
  assert.deepEqual(playedStep(10, 12, 2, 1000), [10, 12]);
  // Jumping 60 seconds ahead in 250 ms is a seek.
  assert.equal(playedStep(10, 70, 1, 250), null);
  // Backwards or standing still adds nothing.
  assert.equal(playedStep(10, 5, 1, 250), null);
  assert.equal(playedStep(10, 10, 1, 250), null);
  // Seeking to the end gives no coverage, so it does not complete the video.
  assert.equal(watchedPercent(rangesPayload([[0, 5]]), 600), 0);
});

test("resumePosition continues where you were, or restarts at the end", () => {
  assert.equal(resumePosition(120, 600), 120);
  assert.equal(resumePosition(597, 600), 0);
  assert.equal(resumePosition(null, 600), 0);
  assert.equal(resumePosition(700, 900), 700);
  // A shorter new version: clamped, and at the end that means restart.
  assert.equal(resumePosition(500, 300), 0);
});

test("rangesPayload keeps the longest ranges when there are too many", () => {
  const many = Array.from({ length: 10 }, (_, i): [number, number] => [i * 10, i * 10 + (i === 3 ? 5 : 1)]);
  const payload = rangesPayload(many, 2);
  assert.equal(payload.length, 2);
  assert.deepEqual(payload[1], [30, 35]);
});

// ---------------------------------------------------------------------------
// Worksheets
// ---------------------------------------------------------------------------

const rawFields = [
  { label: "Your goal", type: "short_text", required: true },
  { label: "Your goal", type: "long_text" },
  { label: "Team size", type: "number", min: 10, max: 1 },
  { label: "Start", type: "date" },
  { label: "Preferred channel", type: "choice", options: ["Slack", "Teams", "Slack", " "] },
  { label: "Empty choice", type: "choice", options: [] },
  { label: "Read the policy", type: "checkbox", required: true },
  { label: "Rituals", type: "checkbox", options: ["Weekly plan", "Daily check-in"] },
  { label: "Old style", type: "textarea" },
  { label: "", type: "short_text" },
  { label: "Unknown", type: "slider" },
];

test("normalizeFields keeps known types, unique keys, clean options and bounds", () => {
  const fields = normalizeFields(rawFields);
  assert.deepEqual(
    fields.map((f) => [f.key, f.type]),
    [
      ["your_goal", "short_text"],
      ["your_goal_2", "long_text"],
      ["team_size", "number"],
      ["start", "date"],
      ["preferred_channel", "choice"],
      ["read_the_policy", "checkbox"],
      ["rituals", "checkbox"],
      ["old_style", "long_text"],
    ],
  );
  assert.deepEqual(fields[2].min, 1);
  assert.deepEqual(fields[2].max, 10);
  assert.deepEqual(fields[4].options, ["Slack", "Teams"]);
  // Existing keys stay when the label changes (answers keep their place).
  assert.equal(normalizeFields([{ key: "goal", label: "New label", type: "short_text" }])[0].key, "goal");
  assert.equal(fieldKey("Één doel!", new Set()), "een_doel");
  assert.deepEqual(normalizeFields("nope"), []);
});

test("normalizeAnswers cleans per type and drops what does not fit", () => {
  const fields = normalizeFields(rawFields);
  const answers = normalizeAnswers(fields, {
    your_goal: "Ship it",
    your_goal_2: "   ",
    team_size: "12",
    start: "2026-02-30",
    preferred_channel: "Email",
    read_the_policy: true,
    rituals: ["Daily check-in", "Hack"],
    old_style: "Line 1\r\nLine 2",
    extra: "dropped",
  });
  assert.deepEqual(answers, { your_goal: "Ship it", read_the_policy: true, rituals: ["Daily check-in"], old_style: "Line 1\nLine 2" });
  assert.equal(normalizeAnswers(fields, { team_size: 5 }).team_size, 5);
  assert.equal(normalizeAnswers(fields, { start: "2026-02-28" }).start, "2026-02-28");
  assert.equal(normalizeAnswers(fields, { preferred_channel: "Teams" }).preferred_channel, "Teams");
});

test("missingRequired and isFilled follow the SQL rule", () => {
  const fields = normalizeFields(rawFields);
  assert.deepEqual(
    missingRequired(fields, {}).map((f) => f.key),
    ["your_goal", "read_the_policy"],
  );
  assert.deepEqual(missingRequired(fields, { your_goal: "x", read_the_policy: true }), []);
  assert.ok(!isFilled(false));
  assert.ok(!isFilled([]));
  assert.ok(isFilled(0));
});

test("answers as text and CSV", () => {
  const fields = normalizeFields(rawFields);
  assert.equal(answerText(fields[5], true, "Ja"), "Ja");
  assert.equal(answerText(fields[6], ["Weekly plan", "Daily check-in"]), "Weekly plan, Daily check-in");
  const csv = answersCsv(fields.slice(0, 2), [{ name: "Ravi, K", email: "r@x.in", submittedAt: null, answers: { your_goal: 'Say "no"' } }]);
  assert.equal(csv.split("\n")[0], "Name,E-mail,Submitted,Your goal,Your goal");
  assert.equal(csv.split("\n")[1], '"Ravi, K",r@x.in,,"Say ""no""",');
});

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

test("storage paths follow the contract and stay safe", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  assert.equal(safeFileName("Één video (final).MP4"), "Een-video-final-.MP4");
  assert.equal(safeFileName("../../etc"), "etc");
  assert.equal(videoFilePath(id, 2, "intro.mp4"), `academy/video/${id}/v2-intro.mp4`);
  assert.equal(subtitlePath(id, 2, "nl"), `academy/video/${id}/v2-subtitles-nl.vtt`);
  assert.equal(documentFilePath(id, 1, "Werkboek.docx"), `academy/document/${id}/v1-Werkboek.docx`);
  assert.equal(imageUrl(`academy/image/${id}/a.png`), `/academy/files/image/${id}/a.png`);
  assert.ok(pathBelongsTo(`academy/video/${id}/v2-intro.mp4`, `academy/video/${id}/v2-`));
  assert.ok(!pathBelongsTo(`academy/video/${id}/v2-../x`, `academy/video/${id}/v2-`));
});

test("file checks: video, documents, images", () => {
  assert.ok(checkVideoFile("a.mp4", 10, "").ok);
  assert.ok(checkVideoFile("a.bin", 10, "video/webm").ok);
  assert.ok(!checkVideoFile("a.avi", 10, "video/x-msvideo").ok);
  assert.ok(!checkVideoFile("a.mp4", 6 * 1024 ** 3, "video/mp4").ok);
  assert.ok(checkDocumentFile("Checklist.xlsx", 1000).ok);
  assert.ok(!checkDocumentFile("evil.exe", 1000).ok);
  assert.ok(!checkDocumentFile("big.pdf", 21 * 1024 * 1024).ok);
  assert.ok(checkImageFile("a.webp", 10, "image/webp").ok);
  assert.ok(!checkImageFile("a.svg", 10, "image/svg+xml").ok);
  assert.equal(videoContentType("x.mov", ""), "video/quicktime");
  assert.equal(documentFormat("a.DOCX"), "word");
  assert.equal(documentFormat("a.csv"), "excel");
  assert.equal(formatBytes(3.4 * 1024 * 1024), "3.4 MB");
  assert.equal(formatBytes(null), "");
  assert.ok(isNewDocument(new Date(Date.now() + 1000).toISOString()));
  assert.ok(!isNewDocument("2020-01-01T00:00:00Z"));
});

// ---------------------------------------------------------------------------
// Block registry and state
// ---------------------------------------------------------------------------

test("media block types: video shows the transcript by default, state readers are safe", () => {
  assert.deepEqual(blockTypes.video.defaultContent, { transcript: true });
  assert.ok(videoShowsTranscript({}));
  assert.ok(!videoShowsTranscript({ transcript: false }));
  assert.deepEqual(readVideoState(null), { video: null, version: null, progress: null, showTranscript: true });
  const ws = readWorksheetState({ document: { id: "d", title: "W", description: null, fields: [{ label: "A", type: "short_text" }] }, answers: { a: "x", b: "y" }, submittedAt: null });
  assert.deepEqual(ws.answers, { a: "x" });
});

// ---------------------------------------------------------------------------
// Mail summary
// ---------------------------------------------------------------------------

test("localClock gives the local day, hour and weekday", () => {
  // Monday 9 November 2026, 07:30 UTC = 08:30 Amsterdam, 13:00 Kolkata.
  const at = new Date("2026-11-09T07:30:00Z");
  assert.deepEqual(localClock(at, "Europe/Amsterdam"), { date: "2026-11-09", hour: 8, weekday: 1 });
  assert.deepEqual(localClock(at, "Asia/Kolkata"), { date: "2026-11-09", hour: 13, weekday: 1 });
});

test("digestDue: daily from 08:00 local once a day, weekly on Monday, off never", () => {
  const amsterdam = "Europe/Amsterdam";
  const early = new Date("2026-11-10T06:30:00Z"); // 07:30 Amsterdam
  const later = new Date("2026-11-10T07:05:00Z"); // 08:05 Amsterdam
  assert.equal(digestDue({ frequency: "daily", sentAt: null, timeZone: amsterdam }, early), false);
  assert.equal(digestDue({ frequency: "daily", sentAt: null, timeZone: amsterdam }, later), true);
  assert.equal(digestDue({ frequency: "daily", sentAt: "2026-11-10T07:01:00Z", timeZone: amsterdam }, later), false);
  assert.equal(digestDue({ frequency: "daily", sentAt: "2026-11-09T07:01:00Z", timeZone: amsterdam }, later), true);
  // India: 08:00 Kolkata is 02:30 UTC.
  assert.equal(digestDue({ frequency: "daily", sentAt: null, timeZone: "Asia/Kolkata" }, new Date("2026-11-10T02:45:00Z")), true);
  assert.equal(digestDue({ frequency: "daily", sentAt: null, timeZone: amsterdam }, new Date("2026-11-10T02:45:00Z")), false);
  // Weekly: Monday only, at most once in six days.
  const monday = new Date("2026-11-09T08:00:00Z");
  assert.equal(digestDue({ frequency: "weekly", sentAt: null, timeZone: amsterdam }, monday), true);
  assert.equal(digestDue({ frequency: "weekly", sentAt: null, timeZone: amsterdam }, later), false);
  assert.equal(digestDue({ frequency: "weekly", sentAt: "2026-11-09T07:10:00Z", timeZone: amsterdam }, monday), false);
  assert.equal(digestDue({ frequency: "weekly", sentAt: "2026-11-02T07:10:00Z", timeZone: amsterdam }, monday), true);
  assert.equal(digestDue({ frequency: "off", sentAt: null, timeZone: amsterdam }, monday), false);
});

test("digestMail: in the person's language, escaped, with absolute links", () => {
  const nl = digestMail({
    name: "Sanne de Vries",
    locale: "nl",
    frequency: "daily",
    items: [{ title: "Je certificaat <staat> klaar", body: "Download het", link: "/academy/certificates/1", createdAt: "2026-11-09T08:00:00Z" }],
    total: 3,
    timeZone: "Europe/Amsterdam",
    siteUrl: "https://portal.nordavo.nl/",
  });
  assert.equal(nl.subject, "3 nieuwe meldingen in de Nordavo Academy");
  assert.ok(nl.html.includes("Hoi Sanne,"));
  assert.ok(nl.html.includes("Je certificaat &lt;staat&gt; klaar"));
  assert.ok(nl.html.includes("https://portal.nordavo.nl/academy/certificates/1"));
  assert.ok(nl.text.includes("En nog 2 meer."));
  const en = digestMail({ name: "Ravi", locale: "en", frequency: "weekly", items: [], total: 1, timeZone: "Asia/Kolkata", siteUrl: "https://portal.nordavo.nl" });
  assert.equal(en.subject, "1 new notification in the Nordavo Academy");
  assert.ok(en.html.includes("Your weekly summary"));
});

// ---------------------------------------------------------------------------
// Certificate
// ---------------------------------------------------------------------------

test("the certificate is a one page PDF with an ASCII file name", async () => {
  const pdf = await renderCertificatePdf({
    fullName: "Ravi Kumar Venkataraghavan Subramanian Iyer",
    courseTitle: "Welcome to a Dutch team — developercourse",
    number: "NA-2026-ABCD1234",
    issuedAt: "2026-11-09T10:00:00Z",
    locale: "en",
  });
  assert.equal(Buffer.from(pdf.slice(0, 5)).toString(), "%PDF-");
  assert.ok(pdf.length > 1000);
  const nl = await renderCertificatePdf({ fullName: "Sanne Öztürk", courseTitle: "Klantcourse", number: "NA-1", issuedAt: "2026-11-09", locale: "nl" });
  assert.equal(Buffer.from(nl.slice(0, 5)).toString(), "%PDF-");
  assert.equal(certificateFileName("Communiceren over 4.000 km", "NA-2026-X", "nl"), "certificaat-communiceren-over-4-000-km-NA-2026-X.pdf");
});
