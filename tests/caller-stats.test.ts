import { test } from "node:test";
import assert from "node:assert/strict";
import { callerInviteMail } from "@/lib/sales/caller-mail";
import {
  amsterdamLocalToIso,
  amsterdamMidnight,
  monthFees,
  monthRange,
  nextMonth,
  previousMonth,
  summarizeCallers,
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
  assert.deepEqual(stats.get("a"), { called: 4, reached: 2, meetings: 2, approved: 1 });
  assert.deepEqual(stats.get("b"), { called: 1, reached: 1, meetings: 1, approved: 0 });
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
