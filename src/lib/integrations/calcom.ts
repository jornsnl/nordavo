import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database, TablesInsert } from "@/lib/database.types";
import { normalizeEmail, splitName } from "@/lib/gtm/normalize";
import { upsertCompany, upsertContact } from "@/lib/gtm/upsert";
import { companyDomainFromEmail, findContactByEmail } from "@/lib/gtm/webpartners";
import { amsterdamDate, promoteContactStatus } from "@/lib/sales/status";

/**
 * Cal.com webhook (S8, realtime): bookings on the sales link become meetings
 * in the register (public.meetings through sales_save_meeting, the booking
 * uid as external id) with a note in the timeline. A booking from the call
 * screen carries metadata[contact_id] and metadata[caller_id] and fills in
 * the planned meeting that "Meeting planned" created.
 *
 * Endpoint: POST /api/webhooks/calcom, configured in Cal.com under
 * Settings, Developer, Webhooks with CALCOM_WEBHOOK_SECRET as secret.
 * Cal.com signs the raw body with HMAC-SHA256 and sends the hex digest in
 * X-Cal-Signature-256.
 *
 * Payload (assumed from the public docs, validated loosely):
 *   { triggerEvent: "BOOKING_CREATED" | "BOOKING_RESCHEDULED" | "BOOKING_CANCELLED" | ...,
 *     createdAt, payload: { uid, title, startTime, endTime, attendees: [{ email, name }],
 *     organizer: { email }, rescheduleUid?, responses?: { company?: { value } },
 *     metadata?: { contact_id?, caller_id? } } }
 * Assumption: on BOOKING_RESCHEDULED, payload.uid is the new booking and
 * payload.rescheduleUid (or fromReschedule) the original one.
 */

type Db = SupabaseClient<Database>;

export const handledTriggers = ["BOOKING_CREATED", "BOOKING_RESCHEDULED", "BOOKING_CANCELLED"] as const;
export type CalTrigger = (typeof handledTriggers)[number];

/** Constant-time check of the hex HMAC-SHA256 of the raw body. */
export function verifyCalSignature(rawBody: string, signature: string | null, secret: string | undefined): boolean {
  if (!secret || !signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  const given = Buffer.from(signature.trim().replace(/^sha256=/, ""), "hex");
  if (given.length !== expected.length) return false;
  return timingSafeEqual(given, expected);
}

const personSchema = z.looseObject({
  email: z.string().nullish(),
  name: z.string().nullish(),
});

const webhookSchema = z.looseObject({
  triggerEvent: z.string(),
  createdAt: z.string().nullish(),
  payload: z
    .looseObject({
      uid: z.string().nullish(),
      title: z.string().nullish(),
      startTime: z.string().nullish(),
      endTime: z.string().nullish(),
      attendees: z.array(personSchema).nullish(),
      organizer: personSchema.nullish(),
      rescheduleUid: z.string().nullish(),
      fromReschedule: z.string().nullish(),
      cancellationReason: z.string().nullish(),
      responses: z.record(z.string(), z.unknown()).nullish(),
      metadata: z.record(z.string(), z.unknown()).nullish(),
    })
    .nullish(),
});

export type CalBooking = {
  trigger: CalTrigger;
  uid: string;
  previousUid: string | null;
  title: string | null;
  startTime: string | null;
  attendeeEmail: string;
  attendeeName: string | null;
  companyName: string | null;
  cancellationReason: string | null;
  /** metadata[contact_id] and metadata[caller_id] of the prefilled sales link (src/lib/sales/booking.ts). */
  contactId: string | null;
  callerId: string | null;
};

const uuid = z.guid();

function uuidOrNull(value: unknown): string | null {
  return typeof value === "string" && uuid.safeParse(value.trim()).success ? value.trim() : null;
}

/** Raw webhook JSON to a booking, or a reason to ignore it. Pure. */
export function parseCalWebhook(json: unknown): { booking: CalBooking } | { ignored: string } {
  const parsed = webhookSchema.safeParse(json);
  if (!parsed.success) return { ignored: "unknown format" };
  const { triggerEvent, payload } = parsed.data;
  if (!(handledTriggers as readonly string[]).includes(triggerEvent)) return { ignored: `event ${triggerEvent}` };
  if (!payload?.uid) return { ignored: "no booking uid" };

  const organizerDomain = normalizeEmail(payload.organizer?.email)?.split("@")[1];
  const attendee = (payload.attendees ?? []).find((a) => {
    const email = normalizeEmail(a.email);
    return email && email.split("@")[1] !== organizerDomain;
  });
  const email = normalizeEmail(attendee?.email);
  if (!email) return { ignored: "no attendee with an e-mail address" };

  return {
    booking: {
      trigger: triggerEvent as CalTrigger,
      uid: payload.uid,
      previousUid: payload.rescheduleUid ?? payload.fromReschedule ?? null,
      title: payload.title ?? null,
      startTime: payload.startTime ?? null,
      attendeeEmail: email,
      attendeeName: attendee?.name?.trim() || null,
      companyName: responseText(payload.responses, ["company", "bedrijf", "companyName", "organisation"]),
      cancellationReason: payload.cancellationReason ?? null,
      contactId: uuidOrNull(payload.metadata?.contact_id),
      callerId: uuidOrNull(payload.metadata?.caller_id),
    },
  };
}

/**
 * What a booking means for the meetings register (feedback Julius, 2.11).
 * The booking uid is the external id, so a second delivery is a no-op:
 *   created      save the meeting (fills the planned one of the call screen)
 *   rescheduled  move the meeting of the original booking to the new uid and time
 *   cancelled    cancel the meeting of this booking
 * Pure.
 */
export type SalesMeetingAction =
  | { kind: "save"; externalId: string; scheduledAt: string | null; reason: string | null; callerId: string | null }
  | { kind: "move"; externalId: string; previousExternalId: string | null; scheduledAt: string | null; reason: string | null; callerId: string | null }
  | { kind: "cancel"; externalId: string };

export function salesMeetingAction(booking: CalBooking): SalesMeetingAction {
  const reason = booking.title?.trim() ? `Booked in Cal.com: ${booking.title.trim()}` : "Booked in Cal.com";
  if (booking.trigger === "BOOKING_CANCELLED") return { kind: "cancel", externalId: booking.uid };
  if (booking.trigger === "BOOKING_RESCHEDULED") {
    return {
      kind: "move",
      externalId: booking.uid,
      previousExternalId: booking.previousUid,
      scheduledAt: booking.startTime,
      reason,
      callerId: booking.callerId,
    };
  }
  return { kind: "save", externalId: booking.uid, scheduledAt: booking.startTime, reason, callerId: booking.callerId };
}

/** Booking question answers are either strings or { value } objects. */
function responseText(responses: Record<string, unknown> | null | undefined, keys: string[]): string | null {
  for (const key of keys) {
    const raw = responses?.[key];
    const value =
      typeof raw === "string" ? raw : raw && typeof raw === "object" && "value" in raw ? (raw as { value: unknown }).value : null;
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export type CalResult =
  | { status: "handled"; activityId: string | null; contactId: string; meetingId: string | null; duplicate: boolean }
  | { status: "ignored"; reason: string };

/**
 * The contact behind the booking: the one on the prefilled sales link, else
 * the attendee by e-mail (created when the domain is a company). Free mail
 * without a known contact cannot be placed.
 */
async function resolveContact(db: Db, booking: CalBooking) {
  if (booking.contactId) {
    const { data } = await db.from("contacts").select("id, company_id").eq("id", booking.contactId).maybeSingle();
    if (data) return data;
  }
  const known = await findContactByEmail(db, booking.attendeeEmail);
  if (known) return known;
  const domain = companyDomainFromEmail(booking.attendeeEmail);
  if (!domain) return null;
  const company = await upsertCompany(db, { domain, name: booking.companyName ?? domain, website: `https://${domain}` }, "calcom");
  const { first, last } = splitName(booking.attendeeName);
  const contact = await upsertContact(
    db,
    { company_id: company.id, first_name: first, last_name: last, email: booking.attendeeEmail },
    "calcom",
  );
  return { id: contact.id, company_id: company.id };
}

/** An existing caller id from the booking metadata, or null. */
async function knownCaller(db: Db, callerId: string | null): Promise<string | null> {
  if (!callerId) return null;
  const { data } = await db.from("callers").select("id").eq("id", callerId).maybeSingle();
  return data?.id ?? null;
}

/**
 * The sales meeting of a booking, through sales_save_meeting with the
 * booking uid as external id (no duplicates). Returns the meeting id and
 * whether the meeting row itself already put the event in the timeline.
 */
async function recordSalesMeeting(
  db: Db,
  booking: CalBooking,
  contact: { id: string; company_id: string },
): Promise<{ meetingId: string | null; logged: boolean }> {
  const action = salesMeetingAction(booking);

  if (action.kind === "cancel") {
    const { data, error } = await db
      .from("meetings")
      .update({ status: "cancelled" })
      .eq("external_id", action.externalId)
      .eq("status", "planned")
      .select("id");
    if (error) throw error;
    // The status change writes "Meeting cancelled" to the timeline.
    return { meetingId: data?.[0]?.id ?? null, logged: Boolean(data?.length) };
  }

  if (action.kind === "move") {
    const uids = [action.previousExternalId, action.externalId].filter((v): v is string => Boolean(v));
    const { data: existing, error } = await db.from("meetings").select("id, status").in("external_id", uids).limit(1);
    if (error) throw error;
    const meeting = existing?.[0];
    if (meeting) {
      const { error: moveError } = await db
        .from("meetings")
        .update({
          external_id: action.externalId,
          scheduled_at: action.scheduledAt,
          ...(meeting.status === "cancelled" ? { status: "planned" as const } : {}),
        })
        .eq("id", meeting.id);
      if (moveError) throw moveError;
      return { meetingId: meeting.id, logged: false };
    }
  }

  const callerId = await knownCaller(db, action.callerId);
  const { data, error } = await db.rpc("sales_save_meeting", {
    p_company: contact.company_id,
    p_contact: contact.id,
    p_caller: callerId,
    p_scheduled_at: action.scheduledAt,
    p_reason: action.reason,
    p_external_id: action.externalId,
    p_source: "calcom",
  });
  if (error) throw error;
  return { meetingId: data ?? null, logged: false };
}

export async function handleCalBooking(db: Db, booking: CalBooking): Promise<CalResult> {
  const contact = await resolveContact(db, booking);
  if (!contact) return { status: "ignored", reason: "personal e-mail address without a known contact" };

  const meetingDate = booking.startTime ? amsterdamDate(booking.startTime) : null;
  const when = booking.startTime
    ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Amsterdam" }).format(
        new Date(booking.startTime),
      )
    : "unknown time";

  const { meetingId, logged } = await recordSalesMeeting(db, booking, contact);

  // The meeting in the register is what counts (it writes "Meeting planned"
  // to the timeline and moves the pipeline); this row only notes the booking,
  // so the report does not count a meeting twice.
  let notes = `Meeting booked through Cal.com for ${when}${booking.title ? `: ${booking.title}` : ""}`;
  if (booking.trigger === "BOOKING_CANCELLED") {
    notes = `Meeting cancelled (${when})${booking.cancellationReason ? `: ${booking.cancellationReason}` : ""}`;
  } else if (booking.trigger === "BOOKING_RESCHEDULED") {
    notes = `Meeting moved to ${when}`;
  }

  let activityId: string | null = null;
  if (!logged) {
    const row: TablesInsert<"activities"> = {
      contact_id: contact.id,
      company_id: contact.company_id,
      channel: "meeting",
      type: "meeting",
      outcome: "notitie",
      notes,
      next_action: booking.trigger === "BOOKING_CANCELLED" ? "Propose a new meeting" : "Sales call",
      next_action_date: booking.trigger === "BOOKING_CANCELLED" ? amsterdamDate() : meetingDate,
      source: "calcom",
      external_id: `calcom:${booking.uid}:${booking.trigger}`,
      meeting_id: meetingId,
    };
    const { data, error } = await db
      .from("activities")
      .upsert(row, { onConflict: "external_id", ignoreDuplicates: true })
      .select("id");
    if (error) throw error;
    activityId = data?.[0]?.id ?? null;
  }
  if (booking.trigger !== "BOOKING_CANCELLED") await promoteContactStatus(db, contact.id, "reached");
  return { status: "handled", activityId, contactId: contact.id, meetingId, duplicate: !logged && activityId === null };
}
