import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { parseCalWebhook, verifyCalSignature } from "@/lib/integrations/calcom";

const created = {
  triggerEvent: "BOOKING_CREATED",
  createdAt: "2026-10-24T09:00:00.000Z",
  payload: {
    uid: "bk_123",
    title: "Kennismaking Nordavo",
    startTime: "2026-10-28T13:00:00.000Z",
    endTime: "2026-10-28T13:30:00.000Z",
    organizer: { email: "julius@nordavo.nl", name: "Julius" },
    attendees: [{ email: "Jan@Acme.nl", name: "Jan de Vries", timeZone: "Europe/Amsterdam" }],
    responses: { company: { value: "Acme Software", label: "Bedrijf" } },
    extra: { ignored: true },
  },
};

test("verifyCalSignature accepts the right HMAC and rejects the rest", () => {
  const body = JSON.stringify(created);
  const signature = createHmac("sha256", "geheim").update(body).digest("hex");
  assert.equal(verifyCalSignature(body, signature, "geheim"), true);
  assert.equal(verifyCalSignature(body, signature, "ander"), false);
  assert.equal(verifyCalSignature(`${body} `, signature, "geheim"), false);
  assert.equal(verifyCalSignature(body, "abc", "geheim"), false);
  assert.equal(verifyCalSignature(body, null, "geheim"), false);
  assert.equal(verifyCalSignature(body, signature, undefined), false);
});

test("parseCalWebhook maps a created booking", () => {
  const result = parseCalWebhook(created);
  assert.ok("booking" in result);
  assert.deepEqual(result.booking, {
    trigger: "BOOKING_CREATED",
    uid: "bk_123",
    previousUid: null,
    title: "Kennismaking Nordavo",
    startTime: "2026-10-28T13:00:00.000Z",
    attendeeEmail: "jan@acme.nl",
    attendeeName: "Jan de Vries",
    companyName: "Acme Software",
    cancellationReason: null,
  });
});

test("parseCalWebhook keeps the original uid on a reschedule and skips the organizer", () => {
  const result = parseCalWebhook({
    triggerEvent: "BOOKING_RESCHEDULED",
    payload: {
      ...created.payload,
      uid: "bk_456",
      rescheduleUid: "bk_123",
      attendees: [{ email: "floris@nordavo.nl" }, { email: "jan@acme.nl" }],
    },
  });
  assert.ok("booking" in result);
  assert.equal(result.booking.previousUid, "bk_123");
  assert.equal(result.booking.attendeeEmail, "jan@acme.nl");
});

test("parseCalWebhook ignores other events and incomplete payloads", () => {
  assert.deepEqual(parseCalWebhook({ triggerEvent: "PING", payload: {} }), { ignored: "event PING" });
  assert.deepEqual(parseCalWebhook({ triggerEvent: "BOOKING_CREATED", payload: { attendees: [] } }), { ignored: "geen booking uid" });
  assert.deepEqual(parseCalWebhook({ nope: true }), { ignored: "onbekend formaat" });
  assert.deepEqual(parseCalWebhook({ triggerEvent: "BOOKING_CANCELLED", payload: { uid: "x", attendees: [] } }), {
    ignored: "geen deelnemer met mailadres",
  });
});
