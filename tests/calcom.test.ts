import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { parseCalWebhook, salesMeetingAction, verifyCalSignature } from "@/lib/integrations/calcom";
import { buildSalesBookingUrl, salesBookingBase } from "@/lib/sales/booking";

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
    contactId: null,
    callerId: null,
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
  assert.deepEqual(parseCalWebhook({ triggerEvent: "BOOKING_CREATED", payload: { attendees: [] } }), { ignored: "no booking uid" });
  assert.deepEqual(parseCalWebhook({ nope: true }), { ignored: "unknown format" });
  assert.deepEqual(parseCalWebhook({ triggerEvent: "BOOKING_CANCELLED", payload: { uid: "x", attendees: [] } }), {
    ignored: "no attendee with an e-mail address",
  });
});

const contactId = "6f1c1b7e-2c64-4f0a-9d7b-0d9f3c1a2b3c";
const callerId = "0a8e0c55-1d1b-4c43-8e8e-3b7c9b2f1d00";

test("parseCalWebhook reads the contact and caller of the prefilled sales link", () => {
  const result = parseCalWebhook({
    ...created,
    payload: { ...created.payload, metadata: { contact_id: contactId, caller_id: callerId, company_id: "x" } },
  });
  assert.ok("booking" in result);
  assert.equal(result.booking.contactId, contactId);
  assert.equal(result.booking.callerId, callerId);

  const bad = parseCalWebhook({ ...created, payload: { ...created.payload, metadata: { contact_id: "1; drop table", caller_id: 5 } } });
  assert.ok("booking" in bad);
  assert.equal(bad.booking.contactId, null);
  assert.equal(bad.booking.callerId, null);
});

test("salesMeetingAction maps bookings to the meetings register with the uid as external id", () => {
  const booking = parseCalWebhook({ ...created, payload: { ...created.payload, metadata: { caller_id: callerId } } });
  assert.ok("booking" in booking);
  assert.deepEqual(salesMeetingAction(booking.booking), {
    kind: "save",
    externalId: "bk_123",
    scheduledAt: "2026-10-28T13:00:00.000Z",
    reason: "Booked in Cal.com: Kennismaking Nordavo",
    callerId,
  });

  const moved = parseCalWebhook({
    triggerEvent: "BOOKING_RESCHEDULED",
    payload: { ...created.payload, uid: "bk_456", rescheduleUid: "bk_123", startTime: "2026-10-30T09:00:00.000Z" },
  });
  assert.ok("booking" in moved);
  assert.deepEqual(salesMeetingAction(moved.booking), {
    kind: "move",
    externalId: "bk_456",
    previousExternalId: "bk_123",
    scheduledAt: "2026-10-30T09:00:00.000Z",
    reason: "Booked in Cal.com: Kennismaking Nordavo",
    callerId: null,
  });

  const cancelled = parseCalWebhook({ triggerEvent: "BOOKING_CANCELLED", payload: { ...created.payload, title: null } });
  assert.ok("booking" in cancelled);
  assert.deepEqual(salesMeetingAction(cancelled.booking), { kind: "cancel", externalId: "bk_123" });
});

test("buildSalesBookingUrl prefills name, mail, note and the metadata the webhook reads back", () => {
  const url = new URL(
    buildSalesBookingUrl("https://cal.com/nordavo/sales?layout=month", {
      name: " Jan de Vries ",
      email: "jan@acme.nl",
      notes: "Wants two Python devs",
      contactId,
      companyId: "c0",
      callerId,
    }),
  );
  assert.equal(url.origin + url.pathname, "https://cal.com/nordavo/sales");
  assert.equal(url.searchParams.get("layout"), "month");
  assert.equal(url.searchParams.get("name"), "Jan de Vries");
  assert.equal(url.searchParams.get("email"), "jan@acme.nl");
  assert.equal(url.searchParams.get("notes"), "Wants two Python devs");
  assert.equal(url.searchParams.get("metadata[contact_id]"), contactId);
  assert.equal(url.searchParams.get("metadata[company_id]"), "c0");
  assert.equal(url.searchParams.get("metadata[caller_id]"), callerId);

  const bare = new URL(buildSalesBookingUrl("https://cal.com/x", { name: null, email: null, contactId, companyId: "c0" }));
  assert.equal(bare.searchParams.has("name"), false);
  assert.equal(bare.searchParams.has("email"), false);
  assert.equal(bare.searchParams.has("metadata[caller_id]"), false);
});

test("salesBookingBase prefers the sales link and falls back to the team member's own link", () => {
  assert.equal(salesBookingBase("https://cal.com/nordavo/sales", "https://cal.com/julius"), "https://cal.com/nordavo/sales");
  assert.equal(salesBookingBase("", "https://cal.com/julius"), "https://cal.com/julius");
  assert.equal(salesBookingBase("http://insecure", null), null);
  assert.equal(salesBookingBase(undefined, undefined), null);
});
