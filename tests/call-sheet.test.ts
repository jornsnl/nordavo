import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildSheetRows,
  groupSheetRows,
  matchesSheetFilter,
  sheetFilters,
  sheetToTsv,
  type SheetCall,
  type SheetCompany,
  type SheetContact,
  type SheetFilter,
} from "@/lib/sales/call-sheet";
import { outcomeName } from "@/lib/sales/timeline";

// The call sheet you work in (feedback Julius, f5d4375a): one row per company,
// last outcome, attempts, call back, last note, who called last, and the filters.

const NOW = Date.parse("2026-11-17T12:00:00Z");
const TODAY = "2026-11-17";

const company = (id: string, extra: Partial<SheetCompany> = {}): SheetCompany => ({
  id,
  name: id.toUpperCase(),
  openingLine: null,
  redFlags: [],
  generalPhone: "020 123 4567",
  website: null,
  linkedinUrl: null,
  ...extra,
});

const contact = (id: string, companyId: string, extra: Partial<SheetContact> = {}): SheetContact => ({
  id,
  company_id: companyId,
  full_name: id,
  title: null,
  phone: "06 1",
  email: null,
  linkedin_url: null,
  status: "new",
  attempts: 0,
  last_attempt_at: null,
  callback_at: null,
  ...extra,
});

const call = (companyId: string, contactId: string | null, outcome: string, at: string, extra: Partial<SheetCall> = {}): SheetCall => ({
  companyId,
  contactId,
  outcome,
  notes: null,
  at,
  by: "Sam",
  ...extra,
});

function rowsFor(contacts: SheetContact[], companies: SheetCompany[], callable: string[], calls: SheetCall[] = []) {
  const rows = buildSheetRows(contacts, new Map(companies.map((c) => [c.id, c])), new Map(), new Set(callable), NOW, calls);
  return groupSheetRows(rows);
}

test("the sheet has one row per company with all its contacts, the callable ones first", () => {
  const rows = rowsFor(
    [contact("a1", "a"), contact("b1", "b"), contact("a2", "a", { attempts: 1 }), contact("a3", "a")],
    [company("a"), company("b")],
    ["a2", "b1"],
  );
  assert.deepEqual(rows.map((r) => r.companyId), ["a", "b"]);
  assert.deepEqual(rows[0].contacts.map((c) => c.contactId), ["a2", "a1", "a3"]);
  // The row opens (and holds) the first contact that can be called.
  assert.equal(rows[0].leadContactId, "a2");
  assert.equal(rows[0].callable, true);
  assert.equal(rows[0].attempts, 1);
});

test("a company without anybody to call now is marked as not callable and leads with its first contact", () => {
  const [row] = rowsFor([contact("a1", "a"), contact("a2", "a")], [company("a")], []);
  assert.equal(row.callable, false);
  assert.equal(row.leadContactId, "a1");
});

test("the row shows the last outcome, the last note, who called last and the earliest call back", () => {
  const [row] = rowsFor(
    [contact("a1", "a", { attempts: 2, callback_at: "2026-11-20" }), contact("a2", "a", { attempts: 1, callback_at: "2026-11-18" })],
    [company("a")],
    ["a1"],
    [
      call("a", "a2", "no_answer", "2026-11-10T09:00:00Z", { notes: "Voicemail", by: "Kim" }),
      call("a", "a1", "call_back", "2026-11-12T09:00:00Z", { notes: "Ask for Eva after 14:00", by: "Sam" }),
      call("a", "a1", "no_answer", "2026-11-11T09:00:00Z", { notes: null }),
    ],
  );
  assert.equal(row.lastOutcome, "call_back");
  assert.equal(row.lastOutcomeAt, "2026-11-12T09:00:00Z");
  assert.equal(row.lastNote, "Ask for Eva after 14:00");
  assert.equal(row.lastBy, "Sam");
  assert.equal(row.callbackAt, "2026-11-18");
  assert.equal(row.attempts, 3);
  // Per contact: the last outcome of that contact.
  const a2 = row.contacts.find((c) => c.contactId === "a2");
  assert.equal(a2?.lastOutcome, "no_answer");
});

test("without a call in the log the note on the contact is the last note", () => {
  const [row] = rowsFor([contact("a1", "a", { caller_note: "  Prefers mail  " })], [company("a")], ["a1"]);
  assert.equal(row.lastNote, "Prefers mail");
  assert.equal(row.lastOutcome, null);
  assert.equal(row.lastBy, null);
});

test("the filters: can call now, call back today, no answer once or twice, interested without a next step", () => {
  const rows = rowsFor(
    [
      contact("a1", "a"),
      contact("b1", "b", { callback_at: "2026-11-17", attempts: 1 }),
      contact("c1", "c", { callback_at: "2026-11-16", attempts: 1 }),
      contact("d1", "d", { callback_at: "2026-11-18", attempts: 1 }),
      contact("e1", "e", { attempts: 2 }),
      contact("f1", "f", { attempts: 3 }),
      contact("g1", "g", { attempts: 1 }),
      contact("h1", "h", { attempts: 1 }),
    ],
    ["a", "b", "c", "d", "e", "f", "g", "h"].map((id) => (id === "h" ? company(id, { nextAction: "Send info by mail" }) : company(id))),
    ["a1"],
    [
      call("b", "b1", "call_back", "2026-11-10T09:00:00Z"),
      call("e", "e1", "no_answer", "2026-11-10T09:00:00Z"),
      call("f", "f1", "no_answer", "2026-11-10T09:00:00Z"),
      call("g", "g1", "reached_interested", "2026-11-10T09:00:00Z"),
      call("h", "h1", "reached_interested", "2026-11-10T09:00:00Z"),
    ],
  );
  const ids = (f: SheetFilter) => rows.filter((r) => matchesSheetFilter(r, f, TODAY)).map((r) => r.companyId);
  assert.deepEqual(ids("all"), ["a", "b", "c", "d", "e", "f", "g", "h"]);
  assert.deepEqual(ids("callable"), ["a"]);
  // A call back of today, and a missed one from before today; tomorrow's is not due.
  assert.deepEqual(ids("callback_today"), ["b", "c"]);
  // Called once or twice, last time without answer: the third time is a different case.
  assert.deepEqual(ids("no_answer"), ["e"]);
  // Interested, but nothing agreed to do next.
  assert.deepEqual(ids("interested"), ["g"]);
  assert.deepEqual(sheetFilters.map((f) => f.value), ["all", "callable", "callback_today", "no_answer", "interested"]);
});

test("a no answer filter looks at the last outcome of the contact, not at an older one", () => {
  const [row] = rowsFor(
    [contact("a1", "a", { attempts: 2 })],
    [company("a")],
    ["a1"],
    [call("a", "a1", "no_answer", "2026-11-09T09:00:00Z"), call("a", "a1", "reached_not_interested", "2026-11-10T09:00:00Z")],
  );
  assert.equal(matchesSheetFilter(row, "no_answer", TODAY), false);
});

test("Copy for Excel gives one line per contact with the new columns", () => {
  const rows = rowsFor(
    [contact("a1", "a", { attempts: 1, callback_at: "2026-11-18" })],
    [company("a")],
    ["a1"],
    [call("a", "a1", "call_back", "2026-11-12T09:00:00Z", { notes: "Ask for\tEva", by: "Sam" })],
  );
  const tsv = sheetToTsv(rows.flatMap((r) => r.contacts)).split("\n");
  assert.equal(tsv.length, 2);
  assert.equal(tsv[0].split("\t").length, tsv[1].split("\t").length);
  assert.ok(tsv[0].endsWith("Last outcome\tAttempts\tCall back\tLast note\tLast called by"));
  assert.ok(tsv[1].endsWith("Call back\t1\t2026-11-18\tAsk for Eva\tSam"));
});

test("outcome names read like the call screen", () => {
  assert.equal(outcomeName("no_answer"), "No answer");
  assert.equal(outcomeName("reached_interested"), "Reached: interested");
  assert.equal(outcomeName(null), null);
});
