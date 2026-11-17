import { test } from "node:test";
import assert from "node:assert/strict";
import { callerInviteMail } from "@/lib/sales/caller-mail";
import {
  amsterdamLocalToIso,
  amsterdamMidnight,
  goalProgress,
  monthFees,
  monthRange,
  nextMonth,
  parsePeriod,
  pendingCallbacks,
  periodRange,
  previousMonth,
  summarizeCallers,
  weekRange,
  weekStart,
} from "@/lib/sales/caller-stats";

test("summarizeCallers counts called, reached, meetings and approved per caller", () => {
  const stats = summarizeCallers(
    [
      { caller_id: "a", outcome: "no_answer" },
      { caller_id: "a", outcome: "reached_interested" },
      { caller_id: "a", outcome: "meeting_planned" },
      { caller_id: "a", outcome: "wrong_number" },
      { caller_id: "b", outcome: "referred" },
      { caller_id: null, outcome: "reached_interested" },
    ],
    [
      { caller_id: "a", status: "planned" },
      { caller_id: "a", status: "approved" },
      { caller_id: "a", status: "cancelled" },
      { caller_id: "b", status: "rejected" },
    ],
  );
  assert.deepEqual(stats.get("a"), { called: 4, reached: 2, callbacks: 0, interested: 1, meetings: 2, held: 1, approved: 1 });
  assert.deepEqual(stats.get("b"), { called: 1, reached: 1, callbacks: 0, interested: 0, meetings: 1, held: 1, approved: 0 });
  assert.equal(stats.size, 2);
});

test("monthFees adds up approved meetings only, with the fee of each meeting", () => {
  const fees = monthFees([
    { caller_id: "a", status: "approved", fee: 75 },
    { caller_id: "a", status: "approved", fee: "62.50" },
    { caller_id: "a", status: "held", fee: 75 },
    { caller_id: "b", status: "rejected", fee: 50 },
  ]);
  assert.deepEqual(fees.get("a"), { approved: 2, fees: 137.5 });
  assert.equal(fees.has("b"), false);
});

test("month boundaries follow Amsterdam time, also around daylight saving", () => {
  assert.equal(amsterdamMidnight("2026-11-01"), "2026-10-31T23:00:00.000Z");
  assert.equal(amsterdamMidnight("2026-07-01"), "2026-06-30T22:00:00.000Z");
  assert.deepEqual(monthRange("2026-03"), { from: "2026-02-28T23:00:00.000Z", to: "2026-03-31T22:00:00.000Z" });
  assert.equal(nextMonth("2026-12"), "2027-01");
  assert.equal(previousMonth("2026-01"), "2025-12");
  assert.equal(amsterdamLocalToIso("2026-11-12", "14:30"), "2026-11-12T13:30:00.000Z");
  assert.equal(amsterdamLocalToIso("2026-06-12", "09:00"), "2026-06-12T07:00:00.000Z");
  // The night daylight saving ends: 02:30 happens twice, either reading is fine; 04:00 is CET.
  assert.equal(amsterdamLocalToIso("2026-10-25", "04:00"), "2026-10-25T03:00:00.000Z");
});

test("callerInviteMail escapes the name and carries the link and the 2FA notice", () => {
  const mail = callerInviteMail({
    name: "Carla <b>Caller</b>",
    url: "https://portal.nordavo.nl/auth/confirm?token_hash=abc&type=invite&next=/auth/password",
    invitedBy: "Julius",
    existingAccount: false,
  });
  assert.equal(mail.subject, "You are invited to call for Nordavo");
  assert.ok(mail.html.includes("Hi Carla,"));
  assert.ok(!mail.html.includes("<b>Caller</b>"));
  assert.ok(mail.html.includes("token_hash=abc&amp;type=invite"));
  assert.ok(mail.html.includes("authenticator app is required"));
  assert.ok(mail.text.includes("Set your password: https://portal.nordavo.nl/auth/confirm"));
  assert.ok(callerInviteMail({ name: "X", url: "https://x", invitedBy: "J", existingAccount: true }).text.includes("Set a new password"));
});

test("weeks run Monday to Sunday in Amsterdam time", () => {
  assert.equal(weekStart("2026-11-17"), "2026-11-16");
  assert.equal(weekStart("2026-11-16"), "2026-11-16");
  assert.equal(weekStart("2026-11-22"), "2026-11-16");
  assert.deepEqual(weekRange("2026-11-17"), { from: "2026-11-15T23:00:00.000Z", to: "2026-11-22T23:00:00.000Z" });
  // Daylight saving ended on Sunday 25 October: this week starts in winter time.
  assert.deepEqual(weekRange("2026-10-27"), { from: "2026-10-25T23:00:00.000Z", to: "2026-11-01T23:00:00.000Z" });
  assert.equal(periodRange("total"), null);
  assert.deepEqual(periodRange("month", new Date("2026-11-17T12:00:00Z")), monthRange("2026-11"));
  assert.deepEqual(periodRange("week", new Date("2026-11-17T12:00:00Z")), weekRange("2026-11-17"));
  assert.equal(parsePeriod("week"), "week");
  assert.equal(parsePeriod("nonsense"), "month");
  assert.equal(parsePeriod(undefined), "month");
});

test("goalProgress is a whole percentage and zero without a goal", () => {
  assert.equal(goalProgress(50, 100), 50);
  assert.equal(goalProgress(120, 100), 120);
  assert.equal(goalProgress(1, 3), 33);
  assert.equal(goalProgress(10, 0), 0);
});

test("pendingCallbacks keeps the newest call back of a contact that is due, overdue first", () => {
  const contacts = new Map([
    ["c1", { callback_at: "2026-11-16" }],
    ["c2", { callback_at: "2026-11-17" }],
    ["c3", { callback_at: "2026-11-20" }],
    ["c4", { callback_at: null }],
    ["c5", { callback_at: "2026-11-10" }],
  ]);
  const out = pendingCallbacks(
    [
      { id: "a1", contact_id: "c1", date: "2026-11-12T10:00:00Z", outcome: "call_back", next_action_date: "2026-11-16" },
      { id: "a2", contact_id: "c2", date: "2026-11-13T10:00:00Z", outcome: "call_back", next_action_date: "2026-11-17" },
      { id: "a3", contact_id: "c3", date: "2026-11-13T11:00:00Z", outcome: "call_back", next_action_date: "2026-11-20" },
      // Called again after the call back: no longer waiting.
      { id: "a4", contact_id: "c4", date: "2026-11-14T10:00:00Z", outcome: "no_answer", next_action_date: null },
      { id: "a5", contact_id: "c4", date: "2026-11-11T10:00:00Z", outcome: "call_back", next_action_date: "2026-11-12" },
      // A date that no longer matches the contact (moved by the team).
      { id: "a6", contact_id: "c5", date: "2026-11-09T10:00:00Z", outcome: "call_back", next_action_date: "2026-11-09" },
    ],
    contacts,
    "2026-11-17",
  );
  assert.deepEqual(out, [
    { activityId: "a1", contactId: "c1", due: "2026-11-16" },
    { activityId: "a2", contactId: "c2", due: "2026-11-17" },
  ]);
});
