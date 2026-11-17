import { test } from "node:test";
import assert from "node:assert/strict";
import {
  callNumbers,
  cleanDescription,
  currentOpeningLine,
  durationPhrase,
  parseRedFlags,
  prioLine,
  sentence,
} from "@/lib/sales/call-brief";
import { buildSheetRows, sheetToTsv, type SheetCompany, type SheetContact } from "@/lib/sales/call-sheet";
import { cheatsheetKeyFromTitle, defaultCheatsheet, hasPlaceholder, mergeCheatsheet } from "@/lib/sales/cheatsheet";
import { mergeChoices } from "@/lib/sales/choices";
import { buildSignals, defaultSignalKinds } from "@/lib/sales/signals";
import { buildContactTimeline, describeChange, describeContactMoment, lastContact } from "@/lib/sales/timeline";
import { personInputSchema } from "@/lib/sales/call-contacts";

// Call screen: what the caller sees about a company (feedback Julius, 9 items).

// A real shape of companies.red_flags: labelled pieces and sentences cut at the commas.
const flags = [
  "Embedded/hardware: vaak fysiek lab nodig",
  "Staat al op bellijst: nieuwe vacature",
  "Vacature in het Nederlands",
  "Medewerkers (LinkedIn): 21-50",
  "Segment: 4 Leersegment: zorg",
  "Wat doet het bedrijf: Wij ondersteunen zorgprocessen. Met technologie voor alarmering",
  "communicatie en zelfredzaamheid. We zorgen ervoor dat de juiste zorgvraag bij de juiste zorgmedewerker terecht komt. Zodat er effectiever én meer…",
  "Toelichting check: Zorgalarmering",
  "Waarom lastiger: Werkt met patiënt of zorgdata (bijzondere persoonsgegevens). Klanten eisen vaak NEN 7510 en verwerking binnen de EU",
  "Hoe oplossen: Developer werkt alleen met test of geanonimiseerde data",
  "geen toegang tot productie. Nordavo regelt verwerkersovereenkomst",
  "EU standaardcontractbepalingen en een beveiligde laptop",
  "Vraag in het gesprek: Werkt jullie development team met echte patiëntdata of met testdata?",
  "Zekerheid LinkedIn match: Zeker (uit vacature)",
];

test("parseRedFlags separates real red flags from what they do, the objection with its answer and the question", () => {
  const b = parseRedFlags(flags);
  assert.deepEqual(b.redFlags, [
    "Embedded/hardware: vaak fysiek lab nodig.",
    "Vacature in het Nederlands.",
    "Segment: 4 Leersegment: zorg.",
  ]);
  // Cut off sentence: only the complete sentences stay, no "…".
  assert.equal(
    b.whatTheyDo,
    "Wij ondersteunen zorgprocessen. Met technologie voor alarmering, communicatie en zelfredzaamheid. We zorgen ervoor dat de juiste zorgvraag bij de juiste zorgmedewerker terecht komt.",
  );
  assert.equal(b.objections.length, 1);
  assert.equal(b.objections[0].objection, "Werkt met patiënt of zorgdata (bijzondere persoonsgegevens). Klanten eisen vaak NEN 7510 en verwerking binnen de EU.");
  // The answer is one sentence again, not three labels.
  assert.equal(
    b.objections[0].answer,
    "Developer werkt alleen met test of geanonimiseerde data, geen toegang tot productie. Nordavo regelt verwerkersovereenkomst, EU standaardcontractbepalingen en een beveiligde laptop.",
  );
  assert.deepEqual(b.questions, ["Werkt jullie development team met echte patiëntdata of met testdata?"]);
  assert.deepEqual(b.facts, ["Employees (LinkedIn): 21-50"]);
});

test("parseRedFlags keeps a flag with its follow up and leaves import bookkeeping out", () => {
  const b = parseRedFlags([
    "Bureau/projectwerk voor klanten: check klantcontact",
    "Vacature >180 dagen: mogelijk evergreen",
    "check of hij nog live is",
    "Vacature in het Nederlands",
    "150 tot 500 FTE",
    "Zekerheid LinkedIn match: Niet gevonden",
    "Staat al op bellijst: nieuwe vacature",
  ]);
  assert.deepEqual(b.redFlags, [
    "Bureau/projectwerk voor klanten: check klantcontact.",
    "Vacature >180 dagen: mogelijk evergreen, check of hij nog live is.",
    "Vacature in het Nederlands.",
  ]);
  assert.deepEqual(b.facts, ["150 tot 500 FTE"]);
  assert.deepEqual(parseRedFlags(null), { redFlags: [], whatTheyDo: null, objections: [], questions: [], facts: [] });
});

test("sentence makes a whole sentence", () => {
  assert.equal(sentence("  zorgdata in beeld "), "Zorgdata in beeld.");
  assert.equal(sentence("Is dit klaar?"), "Is dit klaar?");
  assert.equal(sentence("Eerste zin. Tweede zin die afbreekt…"), "Eerste zin.");
  assert.equal(sentence("een lange zin zonder punt..."), "Een lange zin zonder punt.");
});

test("cleanDescription drops list and source lines and keeps a real description", () => {
  assert.equal(
    cleanDescription("BELLIJST LAMAR (Web Partners, verstuurd 15-10-2026): tabblad Bellen\nBronnen: Lamar bellijst 15-10 (Bellen); Scrape 29-09\nPrio (leadlijst): 1"),
    null,
  );
  assert.equal(
    cleanDescription("BELLIJST LAMAR (Web Partners): tabblad Bellen\nSoftwarebureau voor zorginstellingen.\nBronnen: Scrape 29-09"),
    "Softwarebureau voor zorginstellingen.",
  );
  assert.equal(cleanDescription(null), null);
});

test("the opening line follows the vacancy of today", () => {
  const line = "Ik zag dat jullie al 22 dagen een Senior Back-end Developer zoeken. Wij plaatsen binnen drie weken een developer.";
  const vacancies = [
    { title: "Senior Back-end Developer", days: 68 },
    { title: "Data Engineer", days: 5 },
  ];
  const out = currentOpeningLine(line, vacancies)!;
  assert.equal(out.days, 68);
  assert.ok(out.text.startsWith("Ik zag dat jullie al ruim twee maanden een Senior Back-end Developer zoeken."));
  assert.equal(out.outdated, false);
  // Short while open: days.
  assert.equal(currentOpeningLine(line, [{ title: "Senior Back-end Developer", days: 22 }])!.text.includes("al 22 dagen"), true);
  assert.equal(currentOpeningLine("Jullie zoeken sinds vorige week een FDE.", [{ title: "FDE", days: 40 }])!.text, "Jullie zoeken al 40 dagen een FDE.");
  // No open vacancy left: the line is flagged, not rewritten.
  assert.deepEqual(currentOpeningLine(line, []), { text: line, days: null, outdated: true });
  // Without a time in it nothing changes.
  assert.deepEqual(currentOpeningLine("Jullie bouwen een nieuw platform.", vacancies), { text: "Jullie bouwen een nieuw platform.", days: null, outdated: false });
  assert.equal(currentOpeningLine(null, vacancies), null);
});

test("durationPhrase", () => {
  assert.equal(durationPhrase(0), "sinds vandaag");
  assert.equal(durationPhrase(1), "sinds gisteren");
  assert.equal(durationPhrase(22), "al 22 dagen");
  assert.equal(durationPhrase(100), "al ruim drie maanden");
  assert.equal(durationPhrase(974), "al 974 dagen");
});

test("prioLine gives one line with the reason, or the strongest signal, and counts the red flags", () => {
  assert.equal(
    prioLine({ reason: "SaaS met drie rollen open", strongestSignal: null, redFlags: [] }),
    "SaaS met drie rollen open.",
  );
  const line = prioLine({
    reason: null,
    strongestSignal: "Open for long, Senior Back-end Developer, 68 days open",
    redFlags: ["Embedded/hardware: vaak fysiek lab nodig.", "Vacature in het Nederlands.", "Segment: 4 Leersegment: zorg."],
  });
  assert.ok(line.startsWith("Strongest signal: Open for long, Senior Back-end Developer, 68 days open."));
  assert.ok(line.includes("3 red flags count against it (Embedded/hardware, Vacature in het Nederlands, ...)"));
  assert.equal(prioLine({ reason: null, strongestSignal: null, redFlags: [] }), "No signal known.");
});

test("the general number is the fallback at every contact, and a wrong mobile is not offered", () => {
  const href = (n: string) => `tel:${n}`;
  const both = callNumbers({ phone: "+31 6 1234 5678", phoneWrong: false }, "+31 55 203 2203", href);
  assert.equal(both.dial?.kind, "contact");
  assert.equal(both.generalDial?.number, "+31 55 203 2203");
  const wrong = callNumbers({ phone: "+31 6 1234 5678", phoneWrong: true }, "+31 55 203 2203", href);
  assert.equal(wrong.dial?.kind, "general");
  assert.equal(wrong.generalDial, null);
  const none = callNumbers({ phone: null, phoneWrong: false }, null, href);
  assert.deepEqual(none, { dial: null, generalDial: null });
  assert.equal(callNumbers({ phone: "+31 55 203 2203", phoneWrong: false }, "+31 55 203 2203", href).generalDial, null);
});

// ---------------------------------------------------------------------------
// Signals
// ---------------------------------------------------------------------------

const kinds = mergeChoices("signal_type", []).map((o) => ({ value: o.value, label: o.label, hidden: o.hidden }));
const NOW = Date.parse("2026-11-17T10:00:00Z");

test("signals: the built in kinds are the Signal types list, strongest first", () => {
  assert.deepEqual(
    kinds.map((k) => k.value),
    defaultSignalKinds.map((k) => k.value),
  );
  assert.equal(kinds[0].value, "funding");
});

test("buildSignals orders by strength, derives the vacancy signals and gives every signal a date and source", () => {
  const rows = [
    { id: "a", type: "vacature", title: "Senior Back-end Developer", source: "apify", source_url: "https://nl.indeed.com/viewjob?jk=1", posted_at: "2026-09-07", first_seen_at: "2026-10-26T08:00:00Z" },
    { id: "b", type: "vacature", title: "Data Engineer", source: "linkedin", source_url: null, posted_at: "2026-11-10", first_seen_at: "2026-11-10T08:00:00Z" },
    { id: "c", type: "funding", title: "Series A", source: "overig", source_url: "https://www.example.com/news", posted_at: "2026-11-01", first_seen_at: "2026-11-02T08:00:00Z" },
    { id: "d", type: "employee_growth", title: "21-50 to 51-100", source: "linkedin", source_url: null, posted_at: "2026-10-01", first_seen_at: "2026-10-01T08:00:00Z" },
    { id: "e", type: "closed_one", title: "Old", source: "overig", source_url: null, posted_at: null, first_seen_at: "2026-01-01T00:00:00Z", closed_at: "2026-02-01T00:00:00Z" },
  ];
  const out = buildSignals(rows, kinds, NOW);
  assert.deepEqual(out.signals.map((s) => s.type), ["funding", "employee_growth", "lang_open", "vacature"]);
  assert.equal(out.strongest?.type, "funding");
  assert.equal(out.strongest?.source, "example.com");
  const vacancy = out.signals.find((s) => s.type === "vacature")!;
  assert.equal(vacancy.detail, "Data Engineer (+1 more)");
  assert.equal(vacancy.days, 7);
  const long = out.signals.find((s) => s.type === "lang_open")!;
  assert.equal(long.derived, true);
  assert.equal(long.days, 71);
  assert.equal(long.source, "Indeed");
  assert.equal(out.strongestText, "Funding, Series A");
});

test("a new signal kind is just another option of the list, an unknown one still shows last", () => {
  const extended = [
    ...kinds,
    ...mergeChoices("signal_type", [{ list_key: "signal_type", value: "nieuwe_coo", label: "New COO", description: null, position: 5, hidden: false, tone: null }])
      .filter((o) => o.value === "nieuwe_coo")
      .map((o) => ({ value: o.value, label: o.label, hidden: o.hidden })),
  ];
  const rows = [
    { id: "x", type: "nieuwe_coo", title: "New COO 2026", source: "overig", source_url: null, posted_at: "2026-11-01", first_seen_at: null },
    { id: "y", type: "iets_anders", title: "Something", source: "overig", source_url: null, posted_at: "2026-11-02", first_seen_at: null },
  ];
  const out = buildSignals(rows, extended, NOW);
  assert.deepEqual(out.signals.map((s) => [s.type, s.label]), [
    ["nieuwe_coo", "New COO"],
    ["iets_anders", "Iets anders"],
  ]);
  // Hidden kinds stay out.
  assert.equal(buildSignals(rows, extended.map((k) => (k.value === "nieuwe_coo" ? { ...k, hidden: true } : k)), NOW).signals.length, 1);
});

// ---------------------------------------------------------------------------
// Timeline: contact moments only
// ---------------------------------------------------------------------------

test("the timeline has contact moments only, with who, and the last contact on top", () => {
  const rows = [
    { id: "1", date: "2026-10-15T09:00:00Z", type: "contact", channel: "bellen", outcome: "no_answer", notes: "Voicemail", contact_id: "c1", created_by: null, caller_id: "k1" },
    { id: "2", date: "2026-11-02T09:00:00Z", type: "change", channel: "system", outcome: null, notes: null, contact_id: "c1", created_by: "u1" },
    { id: "3", date: "2026-11-02T09:00:01Z", type: "change", channel: "system", outcome: null, notes: null, contact_id: "c1", created_by: "u1" },
    { id: "4", date: "2026-11-05T09:00:00Z", type: "contact", channel: "mail", outcome: "verstuurd", notes: null, contact_id: "c2", created_by: "u1" },
    { id: "5", date: "2026-11-06T09:00:00Z", type: "view", channel: "system", outcome: null, notes: null, contact_id: "c1", created_by: "u1" },
    { id: "6", date: "2026-11-09T09:00:00Z", type: "reply", channel: "mail", outcome: "reply_positief", notes: "Bel mij dinsdag", contact_id: "c2", created_by: null, caller_id: null },
  ];
  const items = buildContactTimeline(rows, new Map([["u1", "Julius"]]), new Map([["c1", "A"], ["c2", "B"]]), new Map([["k1", "Lamar"]]));
  assert.deepEqual(items.map((i) => i.id), ["6", "4", "1"]);
  assert.deepEqual(items.map((i) => i.summary), ["Mail: Positive reply", "Mail: Sent", "Call: No answer"]);
  assert.equal(items[2].who, "Lamar");
  assert.equal(items[2].notes, "Voicemail");
  assert.equal(items[1].who, "Julius");
  assert.equal(lastContact(items)?.id, "6");
  assert.equal(lastContact([]), null);
  assert.equal(describeContactMoment({ channel: "meeting", outcome: "afspraak", type: "meeting" }), "Meeting: Meeting booked");
});

test("a wrong number mark reads as a sentence in Activities", () => {
  assert.equal(describeChange("phone_wrong_at", null, "2026-11-17T10:00:00Z"), "Mobile number marked as wrong");
  assert.equal(describeChange("phone_wrong_at", "2026-11-17T10:00:00Z", null), "Wrong number mark removed");
});

// ---------------------------------------------------------------------------
// The sheet
// ---------------------------------------------------------------------------

test("the sheet has the same split: red flags, what they do, objection, question, general number, opening line of today", () => {
  const company: SheetCompany = {
    id: "co",
    name: "Acme",
    openingLine: "Ik zag dat jullie al 22 dagen een Senior Back-end Developer zoeken.",
    redFlags: flags,
    generalPhone: "+31 55 203 2203",
    website: null,
    linkedinUrl: null,
    description: "BELLIJST LAMAR (Web Partners): tabblad Bellen\nBronnen: Scrape 29-09",
  };
  const contact: SheetContact = {
    id: "ct",
    company_id: "co",
    full_name: "Test Person",
    title: "CTO",
    phone: "+31 6 1234 5678",
    email: null,
    linkedin_url: null,
    status: "new",
    attempts: 0,
    last_attempt_at: null,
    callback_at: null,
  };
  const rows = buildSheetRows(
    [contact],
    new Map([["co", company]]),
    new Map([["co", [{ title: "Senior Back-end Developer", url: null, since: "2026-09-07" }]]]),
    new Set(["ct"]),
    NOW,
  );
  const r = rows[0];
  assert.equal(r.generalPhone, "+31 55 203 2203");
  assert.equal(r.phoneKind, "contact");
  assert.deepEqual(r.redFlags, ["Embedded/hardware: vaak fysiek lab nodig.", "Vacature in het Nederlands.", "Segment: 4 Leersegment: zorg."]);
  // The description is only list information, so what the flags say takes over.
  assert.ok(r.whatTheyDo?.startsWith("Wij ondersteunen zorgprocessen."));
  assert.ok(r.objection?.startsWith("Objection: Werkt met patiënt of zorgdata"));
  assert.ok(r.objection?.includes("Answer: Developer werkt alleen met test"));
  assert.equal(r.question, "Werkt jullie development team met echte patiëntdata of met testdata?");
  assert.equal(r.daysOpen, 71);
  assert.ok(r.openingLine?.includes("al ruim twee maanden"));
  const tsv = sheetToTsv(rows).split("\n");
  assert.equal(tsv[0].split("\t").length, tsv[1].split("\t").length);
  assert.ok(tsv[0].includes("Red flags\tWhat they do\tObjection and answer\tQuestion"));
  assert.ok(!tsv[1].includes("…"));
});

// ---------------------------------------------------------------------------
// Cheat sheet
// ---------------------------------------------------------------------------

test("the cheat sheet has the five sections, with drafts until Julius saves his own text", () => {
  const drafts = mergeCheatsheet([]);
  assert.deepEqual(drafts.map((s) => s.key), ["usps", "price", "starter_fee", "trade_off", "meetings"]);
  assert.ok(drafts.every((s) => s.draft && s.builtin));
  // Nothing is invented: the starter fee has no amount, only a placeholder.
  const fee = drafts.find((s) => s.key === "starter_fee")!;
  assert.ok(hasPlaceholder(fee.body));
  assert.ok(!/\d/.test(fee.body));
  assert.ok(drafts.find((s) => s.key === "meetings")!.body.includes("Tuesday, Wednesday and Friday"));
  assert.equal(defaultCheatsheet.length, 5);

  const saved = mergeCheatsheet([
    { key: "price", title: "Price", body: "Our own text", position: 5, hidden: false },
    { key: "objections", title: "Objections", body: "Text", position: 100, hidden: false },
    { key: "usps", title: "USPs", body: "x", position: 10, hidden: true },
  ]);
  assert.deepEqual(saved.map((s) => s.key), ["price", "usps", "starter_fee", "trade_off", "meetings", "objections"]);
  assert.equal(saved[0].draft, false);
  assert.equal(saved[1].hidden, true);
  assert.equal(saved.at(-1)?.builtin, false);
  assert.equal(cheatsheetKeyFromTitle("Bezwaren & antwoorden", []), "bezwaren_antwoorden");
});

// ---------------------------------------------------------------------------
// Editing contacts
// ---------------------------------------------------------------------------

test("a contact edit needs a name and a number and mail that look right", () => {
  assert.ok(personInputSchema.safeParse({ firstName: "Test", phone: "+31 6 1234 5678", email: "test@example.nl" }).success);
  assert.ok(personInputSchema.safeParse({ lastName: "Jansen" }).success);
  assert.equal(personInputSchema.safeParse({ firstName: " ", lastName: "" }).success, false);
  assert.equal(personInputSchema.safeParse({ firstName: "A", phone: "bel mij" }).success, false);
  assert.equal(personInputSchema.safeParse({ firstName: "A", email: "geen mail" }).success, false);
  assert.ok(personInputSchema.safeParse({ firstName: "A", phone: "", email: "" }).success);
});
