import { test } from "node:test";
import assert from "node:assert/strict";
import { composeNote, needsFollowUp, outcomeProblem, outcomeScope, type OutcomeFields } from "@/lib/sales/call-outcome";
import { callInputSchema } from "@/lib/sales/call-session";
import { callOutcomes } from "@/lib/sales/labels";
import { mergeChoices } from "@/lib/sales/choices";
import { OWN_WORDS, parseDay, parseWho, summarizeRejections } from "@/lib/sales/caller-stats";

const today = "2026-11-17";
const id = "11111111-1111-4111-8111-111111111111";

test("only No answer saves with one tap, and every outcome has a scope", () => {
  assert.equal(needsFollowUp("no_answer"), false);
  for (const o of callOutcomes) {
    if (o.value !== "no_answer") assert.equal(needsFollowUp(o.value), true, o.value);
    assert.ok(outcomeScope[o.value], o.value);
  }
  // Person outcomes keep the caller at the same company; company outcomes move on.
  assert.deepEqual(
    callOutcomes.filter((o) => outcomeScope[o.value] === "person").map((o) => o.value),
    ["no_answer", "not_interested_person", "referred", "wrong_person", "wrong_number"],
  );
  assert.deepEqual(
    callOutcomes.filter((o) => outcomeScope[o.value] === "company").map((o) => o.value),
    ["call_back", "reached_interested", "meeting_planned", "not_interested_company", "not_now", "do_not_contact", "reached_not_interested"],
  );
});

test("outcomeProblem asks for what each outcome needs", () => {
  const p = (fields: Partial<OutcomeFields> & Pick<OutcomeFields, "outcome">) => outcomeProblem(fields, today);
  assert.equal(p({ outcome: "no_answer" }), null);
  assert.equal(p({ outcome: "wrong_number" }), null);

  assert.equal(p({ outcome: "call_back" }), "Pick a date to call back");
  assert.equal(p({ outcome: "call_back", callbackAt: "2026-11-20" }), "Pick a time to call back");
  assert.equal(p({ outcome: "call_back", callbackAt: "2026-11-20", callbackTime: "25:00" }), "Pick a time to call back");
  assert.equal(p({ outcome: "call_back", callbackAt: "2026-11-20", callbackTime: "14:30" }), null);

  assert.equal(p({ outcome: "reached_interested" }), "Pick the next step");
  assert.equal(p({ outcome: "reached_interested", nextStep: "meeting" }), "Pick when the next step happens");
  assert.equal(p({ outcome: "reached_interested", nextStep: "meeting", nextStepAt: "2026-11-20" }), null);

  assert.equal(p({ outcome: "meeting_planned", meetingReason: "  " }), "Say what the meeting is about");
  assert.equal(p({ outcome: "meeting_planned", meetingReason: "Two Python developers" }), null);

  assert.equal(p({ outcome: "referred" }), "Who were you referred to?");
  assert.equal(p({ outcome: "referred", referredName: "Dirk", referredEmail: "dirk" }), "That mail address does not look right");
  assert.equal(p({ outcome: "referred", referredName: "Dirk", referredEmail: "dirk@example.nl" }), null);
  assert.equal(p({ outcome: "wrong_person", referredEmail: "x" }), "That mail address does not look right");
});

test("Not interested needs a reason or words, and wrong moment needs a date in the future", () => {
  const p = (fields: Partial<OutcomeFields>) => outcomeProblem({ outcome: "reached_not_interested", ...fields }, today);
  assert.equal(p({}), "Pick a reason or write one");
  assert.equal(p({ reasons: [], reasonText: "   " }), "Pick a reason or write one");
  assert.equal(p({ reasons: ["has_agency"] }), null);
  assert.equal(p({ reasonText: "They only work with one big partner" }), null);
  assert.equal(p({ reasons: ["wrong_moment"] }), "Pick a date to get back in touch");
  assert.equal(p({ reasons: ["wrong_moment"], until: today }), "Pick a date in the future");
  assert.equal(p({ reasons: ["wrong_moment"], until: "2026-11-01" }), "Pick a date in the future");
  assert.equal(p({ reasons: ["wrong_moment"], until: "2027-02-01" }), null);
  // "May we get back later" without the wrong moment reason: a date is still checked.
  assert.equal(p({ reasons: ["no_time"], until: "2027-02-01" }), null);
  assert.equal(p({ reasons: ["no_time"], until: "yesterday" }), "Pick a date in the future");
});

test("the server schema applies the same rules and rejects what the window never sends", () => {
  const ok = callInputSchema.safeParse({ contactId: id, outcome: "reached_not_interested", reasons: ["has_agency", "too_small"] });
  assert.equal(ok.success, true);
  const none = callInputSchema.safeParse({ contactId: id, outcome: "reached_not_interested", reasons: [] });
  assert.equal(none.success, false);
  assert.equal(none.error?.issues[0]?.message, "Pick a reason or write one");
  const badReason = callInputSchema.safeParse({ contactId: id, outcome: "reached_not_interested", reasons: ["Has Agency!"] });
  assert.equal(badReason.success, false);
  const noTime = callInputSchema.safeParse({ contactId: id, outcome: "call_back", callbackAt: "2026-12-01" });
  assert.equal(noTime.error?.issues[0]?.message, "Pick a time to call back");
  assert.equal(callInputSchema.safeParse({ contactId: id, outcome: "no_answer", note: "voicemail" }).success, true);
  assert.equal(callInputSchema.safeParse({ contactId: "nope", outcome: "no_answer" }).success, false);
  assert.equal(callInputSchema.safeParse({ contactId: id, outcome: "hang_up" }).success, false);
});

test("composeNote puts what has no column into the call log, meeting reason first", () => {
  assert.equal(composeNote({ outcome: "no_answer", note: "  voicemail  " }), "voicemail");
  assert.equal(composeNote({ outcome: "no_answer" }), null);
  assert.equal(
    composeNote({ outcome: "call_back", callbackAt: "2026-11-20", callbackTime: "14:30", callbackWith: "Jan", note: "after lunch" }),
    "Call back on 20-11-2026 at 14:30 with Jan\nafter lunch",
  );
  assert.equal(
    composeNote({ outcome: "reached_interested", interest: "Two Python developers", nextStep: "send_info", nextStepAt: "2026-11-19" }),
    "Interest: Two Python developers\nNext step: Send info by mail on 19-11-2026",
  );
  // The first line of a planned meeting is its reason in the register.
  assert.equal(composeNote({ outcome: "meeting_planned", meetingReason: "Needs a data team", note: "Thursday works" }), "Needs a data team\nThursday works");
  assert.equal(
    composeNote({ outcome: "reached_not_interested", reasons: ["has_agency"], reasonText: "Fixed partner", until: "2027-02-01" }, "Already has an agency or partner"),
    "Reasons: Already has an agency or partner\nIn their words: Fixed partner\nMay be approached again from 01-02-2027",
  );
  assert.equal(composeNote({ outcome: "wrong_number", newPhone: "+31612345678" }), "Right number: +31612345678");
  assert.equal(composeNote({ outcome: "wrong_person", wrongReason: "left" }), "No longer works here");
});

test("the rejection reasons are a managed list: built in reasons can be hidden, extras added", () => {
  const list = mergeChoices("reject_reason", [
    { list_key: "reject_reason", value: "too_small", label: "Too small for us", description: null, position: 5, hidden: false, tone: null },
    { list_key: "reject_reason", value: "has_agency", label: "Has an agency", description: null, position: 20, hidden: true, tone: null },
    { list_key: "reject_reason", value: "no_budget", label: "No budget", description: null, position: 1000, hidden: false, tone: null },
  ]);
  assert.equal(list.length, 9);
  assert.equal(list[0].value, "too_small");
  assert.equal(list[0].label, "Too small for us");
  assert.equal(list.find((o) => o.value === "has_agency")?.hidden, true);
  assert.equal(list.find((o) => o.value === "no_budget")?.builtin, false);
  assert.ok(list.some((o) => o.value === "wrong_moment" && o.builtin));
});

test("summarizeRejections counts per reason and per person, with the own words apart", () => {
  const rows = [
    { caller_id: "c1", created_by: "p1", reasons: ["has_agency", "too_small"], reason_text: null },
    { caller_id: "c1", created_by: "p1", reasons: ["has_agency"], reason_text: "Fixed partner" },
    { caller_id: null, created_by: "p2", reasons: ["wrong_moment"], reason_text: null },
    { caller_id: "c2", created_by: "p3", reasons: [], reason_text: "Merger going on" },
    { caller_id: "c2", created_by: "p3", reasons: ["custom_one"], reason_text: null },
  ];
  const summary = summarizeRejections(rows, ["too_small", "has_agency", "wrong_moment"]);
  assert.deepEqual(
    summary.map((s) => [s.reason, s.total]),
    [
      ["too_small", 1],
      ["has_agency", 2],
      ["wrong_moment", 1],
      ["custom_one", 1],
      [OWN_WORDS, 1],
    ],
  );
  const agency = summary.find((s) => s.reason === "has_agency")!;
  assert.equal(agency.byWho.get("caller:c1"), 2);
  assert.equal(summary.find((s) => s.reason === "wrong_moment")!.byWho.get("team:p2"), 1);
  assert.deepEqual(summarizeRejections([]), []);
});

test("filters from the address bar are parsed strictly", () => {
  assert.deepEqual(parseWho(`caller:${id}`), { kind: "caller", id });
  assert.deepEqual(parseWho(`team:${id}`), { kind: "team", id });
  assert.equal(parseWho("caller:nope"), null);
  assert.equal(parseWho(undefined), null);
  assert.equal(parseDay("2026-11-01"), "2026-11-01");
  assert.equal(parseDay("1 november"), undefined);
});
