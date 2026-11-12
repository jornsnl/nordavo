import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSheetRows, sheetToTsv } from "@/lib/sales/call-sheet";
import { parseMemberCsv } from "@/lib/sales/campaign-import";
import { rate, summarizeCallResults } from "@/lib/sales/caller-stats";
import { choiceLabel, choiceValueFromLabel, mergeChoices, nextPrioLevel, pickable } from "@/lib/sales/choices";
import { isDevDataTitle } from "@/lib/sales/follow";
import { applyChoiceLists, customColumnDefs, customKey, flowColumnDefs, isCustomField, parseCustomInput } from "@/lib/sales/grid-extras";
import { companyColumns } from "@/lib/sales/rows";
import { dialHref, dialsInBrowser, isDialTemplate, parseCallEvent, phoneKey, secretMatches } from "@/lib/sales/telephony";
import { isFree, occupancyText, summarizeBuckets, summarizeSourceLists, triageInputError, type CompanyOccupancy } from "@/lib/sales/triage";
import { campaignStatusFor, mapCampaignLead } from "@/lib/integrations/instantly";

// ---------------------------------------------------------------------------
// Triage and occupancy
// ---------------------------------------------------------------------------

test("summarizeBuckets counts per bucket and per worker, in bucket order", () => {
  const out = summarizeBuckets([
    { id: "1", bucket: "incoming", source_list: "Scrape week 46", worker: null },
    { id: "2", bucket: "call", source_list: "Scrape week 46", worker: "Webpartners" },
    { id: "3", bucket: "call", source_list: "Partner X", worker: "Webpartners" },
    { id: "4", bucket: "call", source_list: "Partner X", worker: "Own list" },
  ]);
  assert.equal(out[0].bucket, "incoming");
  assert.equal(out[0].count, 1);
  const call = out.find((b) => b.bucket === "call")!;
  assert.equal(call.count, 3);
  assert.deepEqual(call.workers, [
    { name: "Webpartners", count: 2 },
    { name: "Own list", count: 1 },
  ]);
  assert.equal(out.find((b) => b.bucket === "no_go")!.count, 0);
});

test("summarizeSourceLists shows per list how many still have no destination, waiting lists first", () => {
  const out = summarizeSourceLists([
    { id: "1", bucket: "incoming", source_list: "Scrape week 46", worker: null },
    { id: "2", bucket: "call", source_list: "Scrape week 46", worker: null },
    { id: "3", bucket: "find_number", source_list: "Partner X", worker: null },
    { id: "4", bucket: "incoming", source_list: null, worker: null },
    { id: "5", bucket: "incoming", source_list: "Scrape week 46", worker: null },
  ]);
  assert.deepEqual(out[0], { name: "Scrape week 46", total: 3, incoming: 2 });
  assert.deepEqual(out.find((s) => s.name === "No list"), { name: "No list", total: 1, incoming: 1 });
  assert.deepEqual(out.at(-1), { name: "Partner X", total: 1, incoming: 0 });
});

test("a lead is free only in incoming or free and with nothing running", () => {
  const running: CompanyOccupancy = { kind: "campaign", channel: "mail", label: "Q4", since: "2026-11-01", until: null, repliedAt: null, status: "active", active: true };
  const ended: CompanyOccupancy = { ...running, active: false, status: "finished" };
  assert.equal(isFree("incoming", []), true);
  assert.equal(isFree("free", [ended]), true);
  assert.equal(isFree("free", [running]), false);
  assert.equal(isFree("call", []), false);
  assert.equal(occupancyText(running), "Mail: Q4");
  assert.equal(occupancyText(ended), "Mail: Q4 (ended without reply)");
  assert.equal(occupancyText({ ...running, repliedAt: "2026-11-05" }), "Mail: Q4 (replied)");
});

test("triage asks for what a destination needs", () => {
  const today = "2026-11-12";
  assert.equal(triageInputError("call", {}, today), "Pick a call list or a caller.");
  assert.equal(triageInputError("call", { callerId: "x" }, today), null);
  assert.equal(triageInputError("mail_campaign", {}, today), "Pick a campaign.");
  assert.equal(triageInputError("parked", { until: "2026-11-11" }, today), "Pick a date from today.");
  assert.equal(triageInputError("parked", { until: "2026-12-01" }, today), null);
  assert.equal(triageInputError("no_go", { reason: "  " }, today), "Give a reason for no go.");
  assert.equal(triageInputError("find_number", {}, today), null);
});

// ---------------------------------------------------------------------------
// Choice lists
// ---------------------------------------------------------------------------

test("mergeChoices renames, orders, hides and adds prio levels", () => {
  const rows = [
    { list_key: "prio" as const, value: "1", label: "Hot", description: "Three open roles", position: 20, hidden: false, tone: null },
    { list_key: "prio" as const, value: "2", label: "P2", description: null, position: 10, hidden: false, tone: null },
    { list_key: "prio" as const, value: "6", label: "Someday", description: null, position: 70, hidden: false, tone: null },
    { list_key: "prio" as const, value: "5", label: "P5", description: null, position: 50, hidden: true, tone: null },
  ];
  const prio = mergeChoices("prio", rows);
  assert.deepEqual(prio.map((o) => o.value), ["2", "1", "3", "4", "5", "6"]);
  assert.equal(prio[1].label, "Hot");
  assert.equal(prio[1].description, "Three open roles");
  assert.equal(prio.find((o) => o.value === "6")!.builtin, false);
  assert.deepEqual(pickable(prio).map((o) => o.value), ["2", "1", "3", "4", "6"]);
  assert.deepEqual(pickable(prio, "5").map((o) => o.value), ["2", "1", "3", "4", "5", "6"]);
  assert.equal(nextPrioLevel(prio), "7");
  assert.equal(choiceLabel(prio, "1"), "Hot");
  assert.equal(choiceLabel(prio, "9"), "9");
});

test("lists with fixed options never take extra ones", () => {
  const status = mergeChoices("lead_status", [
    { list_key: "lead_status", value: "new", label: "Binnengekomen", description: null, position: 10, hidden: false, tone: null },
    { list_key: "lead_status", value: "custom", label: "Custom", description: null, position: 5, hidden: false, tone: null },
  ]);
  assert.equal(status.length, 8);
  assert.equal(status[0].label, "Binnengekomen");
  assert.equal(choiceValueFromLabel("Data & AI"), "data_ai");
  assert.equal(choiceValueFromLabel("Data & AI", ["data_ai"]), "data_ai_2");
});

test("applyChoiceLists puts the configured options and parser on prio and status columns", () => {
  const lists = {
    prio: mergeChoices("prio", [{ list_key: "prio", value: "6", label: "P6", description: null, position: 60, hidden: false, tone: null }]),
    category: mergeChoices("category", []),
    lead_status: mergeChoices("lead_status", []),
    contact_status: mergeChoices("contact_status", []),
    call_outcome: mergeChoices("call_outcome", []),
  };
  const cols = applyChoiceLists(companyColumns, lists);
  const prio = cols.find((c) => c.key === "prio")!;
  assert.equal(prio.options?.length, 6);
  assert.deepEqual(prio.parse!("P6"), { value: 6 });
  assert.deepEqual(prio.parse!("6"), { value: 6 });
  assert.ok("error" in prio.parse!("P9"));
  const status = cols.find((c) => c.key === "lead_status")!;
  assert.ok("error" in status.parse!(""));
});

// ---------------------------------------------------------------------------
// Own columns
// ---------------------------------------------------------------------------

test("own columns parse their type and live under their own key", () => {
  assert.equal(customKey("company", "tech_stack"), "cf_company__tech_stack");
  assert.equal(isCustomField("cf:tech_stack"), true);
  assert.equal(isCustomField("prio"), false);
  const [col] = customColumnDefs<Record<string, unknown>>([{ entity: "company", key: "stack", label: "Stack", fieldType: "multi_choice", options: ["Java", "Python"] }]);
  assert.equal(col.field, "cf:stack");
  assert.equal(col.type, "multiselect");
  assert.deepEqual(col.parse!("java; python"), { value: ["Java", "Python"] });
  assert.ok("error" in col.parse!("Go"));
  assert.deepEqual(col.get({ cf_company__stack: ["Java"] }), ["Java"]);
  assert.deepEqual(parseCustomInput({ fieldType: "number", options: [], label: "N" }, "1,5"), { value: 1.5 });
  assert.deepEqual(parseCustomInput({ fieldType: "date", options: [], label: "D" }, "3-12-2026"), { value: "2026-12-03" });
  assert.ok("error" in parseCustomInput({ fieldType: "url", options: [], label: "U" }, "acme.nl"));
  assert.deepEqual(parseCustomInput({ fieldType: "boolean", options: [], label: "B" }, "ja"), { value: true });
  const flow = flowColumnDefs<Record<string, unknown>>("contacts");
  assert.ok(flow.some((c) => c.key === "company_prio_reason" && c.field === "prio_reason" && c.entity === "company"));
});

// ---------------------------------------------------------------------------
// Click to call and the phone system webhook
// ---------------------------------------------------------------------------

test("dialHref uses tel: or the person's own phone system", () => {
  assert.equal(phoneKey("06 12 34 56 78"), "31612345678");
  assert.equal(phoneKey("+31 6 1234 5678"), "31612345678");
  assert.equal(phoneKey("0031612345678"), "31612345678");
  assert.equal(dialHref("06-12345678"), "tel:0612345678");
  assert.equal(dialHref("06-12345678", "https://app.example.com/call?to={number}"), "https://app.example.com/call?to=%2B31612345678");
  assert.equal(dialHref("+31 20 123 4567", "sip:{local}@pbx"), "sip:0201234567@pbx");
  assert.equal(dialHref("0612345678", "https://bad.example.com/no-placeholder"), "tel:0612345678");
  assert.equal(isDialTemplate("http://insecure/{number}"), false);
  assert.equal(dialsInBrowser("https://x"), true);
  assert.equal(dialsInBrowser("tel:1"), false);
});

test("parseCallEvent reads common webhook shapes", () => {
  const e = parseCallEvent({
    data: { call_id: "abc", direction: "outgoing", to: "+31612345678", start_time: "2026-11-12T10:00:00Z", billsec: 95, recording_url: "https://rec.example.com/abc.mp3", status: "answered", user_email: "Julius@Nordavo.nl" },
  });
  assert.deepEqual(e, {
    id: "abc",
    phone: "+31612345678",
    direction: "outbound",
    startedAt: "2026-11-12T10:00:00.000Z",
    durationSeconds: 95,
    recordingUrl: "https://rec.example.com/abc.mp3",
    answered: true,
    agentEmail: "julius@nordavo.nl",
    notes: null,
  });
  const inbound = parseCallEvent({ id: 7, direction: "inbound", from: "0201234567", status: "missed", recording_url: "http://insecure" });
  assert.equal(inbound?.phone, "0201234567");
  assert.equal(inbound?.answered, false);
  assert.equal(inbound?.recordingUrl, null);
  assert.equal(parseCallEvent({ id: "x" }), null);
  assert.equal(parseCallEvent("nope"), null);
  assert.equal(secretMatches("abc", "abc"), true);
  assert.equal(secretMatches("abd", "abc"), false);
  assert.equal(secretMatches(null, "abc"), false);
});

// ---------------------------------------------------------------------------
// Call sheet
// ---------------------------------------------------------------------------

test("the call sheet has one row per contact with roles, vacancies, days open and links", () => {
  const now = Date.parse("2026-11-12T12:00:00Z");
  const rows = buildSheetRows(
    [
      { id: "c1", company_id: "a", full_name: "Jane", title: "CTO", phone: null, email: null, linkedin_url: "linkedin.com/in/jane", status: "new", attempts: 1, last_attempt_at: null, callback_at: null },
      { id: "c2", company_id: "missing", full_name: "X", title: null, phone: "1", email: null, linkedin_url: null, status: "new", attempts: 0, last_attempt_at: null, callback_at: null },
    ],
    new Map([["a", { id: "a", name: "Acme", openingLine: "Saw your data roles", redFlags: [], generalPhone: "020 123", website: "acme.nl", linkedinUrl: null }]]),
    new Map([
      [
        "a",
        [
          { title: "Data engineer", url: "https://jobs/1", since: "2026-11-02" },
          { title: "Java developer", url: null, since: "2026-10-13" },
        ],
      ],
    ]),
    new Set(["c1"]),
    now,
  );
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.equal(r.phone, "020 123");
  assert.equal(r.phoneKind, "general");
  assert.deepEqual(r.roles, ["Java developer", "Data engineer"]);
  assert.equal(r.vacancyCount, 2);
  assert.equal(r.daysOpen, 30);
  assert.deepEqual(r.links.map((l) => l.label), ["Data engineer", "Website", "LinkedIn"]);
  assert.equal(r.links[2].url, "https://linkedin.com/in/jane");
  assert.equal(r.callable, true);
  assert.match(sheetToTsv(rows).split("\n")[1], /^Acme\tJane\tCTO\t020 123\tSaw your data roles\tJava developer, Data engineer\t2\t30/);
});

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------

test("parseMemberCsv reads a Seleqt or Instantly export", () => {
  const out = parseMemberCsv(
    [
      "Email;LinkedIn profile URL;Status;Replied;Sentiment",
      "jane@acme.nl;;Active;no;",
      ";https://www.linkedin.com/in/john-doe;Replied;yes;Interested",
      "bob@x.nl;;Bounced;;",
      "nothing here;;;;",
    ].join("\n"),
  );
  assert.equal(out.skipped, 1);
  assert.deepEqual(out.members.map((m) => m.status), ["active", "replied", "bounced"]);
  assert.equal(out.members[1].replyOutcome, "reply_positief");
  assert.equal(out.members[1].linkedinUrl, "https://www.linkedin.com/in/john-doe");
  assert.ok(parseMemberCsv("name\nJane").error);
});

test("Instantly campaign and lead statuses map to ours", () => {
  assert.equal(campaignStatusFor(0), "draft");
  assert.equal(campaignStatusFor(1), "active");
  assert.equal(campaignStatusFor(4), "active");
  assert.equal(campaignStatusFor(3), "finished");
  assert.equal(campaignStatusFor(-2), "paused");
  assert.deepEqual(mapCampaignLead({ id: "l1", email: "Jane@Acme.nl", status: 1, email_reply_count: 1, timestamp_last_reply: "2026-11-10T09:00:00Z", lt_interest_status: 1 }), {
    id: "l1",
    email: "jane@acme.nl",
    repliedAt: "2026-11-10T09:00:00Z",
    replyOutcome: "reply_positief",
    status: "replied",
  });
  assert.equal(mapCampaignLead({ id: "l2", email: "b@x.nl", status: -1 })?.status, "bounced");
  assert.equal(mapCampaignLead({ id: "l3", email: "" }), null);
});

// ---------------------------------------------------------------------------
// Follow and caller results
// ---------------------------------------------------------------------------

test("isDevDataTitle finds dev and data roles in Dutch and English", () => {
  for (const t of ["Senior Java Developer", "Data Engineer", "BI specialist", "Software ontwikkelaar", "Power BI consultant", "DevOps engineer", "Data-analist"]) {
    assert.equal(isDevDataTitle(t), true, t);
  }
  for (const t of ["Office manager", "Accountmanager", "Recruiter", "", null]) assert.equal(isDevDataTitle(t), false, String(t));
});

test("summarizeCallResults counts per external caller and team member, without phone system rows", () => {
  const out = summarizeCallResults(
    [
      { caller_id: "c1", created_by: "p9", outcome: "no_answer" },
      { caller_id: "c1", created_by: "p9", outcome: "reached_interested" },
      { caller_id: "c1", created_by: "p9", outcome: null, source: "telephony" },
      { caller_id: null, created_by: "p1", outcome: "meeting_planned" },
      { caller_id: null, created_by: null, outcome: "no_answer" },
    ],
    [
      { caller_id: "c1", booked_by: "p9", status: "approved" },
      { caller_id: null, booked_by: "p1", status: "cancelled" },
    ],
  );
  assert.deepEqual(out.get("caller:c1"), {
    key: "caller:c1",
    kind: "caller",
    id: "c1",
    called: 2,
    reached: 1,
    outcomes: { no_answer: 1, reached_interested: 1 },
    meetings: 1,
    approved: 1,
  });
  assert.equal(out.get("team:p1")?.called, 1);
  assert.equal(out.get("team:p1")?.meetings, 0);
  assert.equal(out.size, 2);
  assert.equal(rate(1, 3), 33);
  assert.equal(rate(1, 0), null);
});
