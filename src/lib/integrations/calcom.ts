import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database, TablesInsert } from "@/lib/database.types";
import { normalizeEmail, splitName } from "@/lib/gtm/normalize";
import { upsertCompany, upsertContact } from "@/lib/gtm/upsert";
import { companyDomainFromEmail, findContactByEmail } from "@/lib/gtm/webpartners";
import { amsterdamDate, promoteContactStatus } from "./onepage";

/**
 * Cal.com webhook (S8, realtime): bookings on the sales link become meeting
 * activities.
 *
 * Endpoint: POST /api/webhooks/calcom, configured in Cal.com under
 * Settings, Developer, Webhooks with CALCOM_WEBHOOK_SECRET as secret.
 * Cal.com signs the raw body with HMAC-SHA256 and sends the hex digest in
 * X-Cal-Signature-256.
 *
 * Payload (assumed from the public docs, validated loosely):
 *   { triggerEvent: "BOOKING_CREATED" | "BOOKING_RESCHEDULED" | "BOOKING_CANCELLED" | ...,
 *     createdAt, payload: { uid, title, startTime, endTime, attendees: [{ email, name }],
 *     organizer: { email }, rescheduleUid?, responses?: { company?: { value } } } }
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
};

/** Raw webhook JSON to a booking, or a reason to ignore it. Pure. */
export function parseCalWebhook(json: unknown): { booking: CalBooking } | { ignored: string } {
  const parsed = webhookSchema.safeParse(json);
  if (!parsed.success) return { ignored: "onbekend formaat" };
  const { triggerEvent, payload } = parsed.data;
  if (!(handledTriggers as readonly string[]).includes(triggerEvent)) return { ignored: `event ${triggerEvent}` };
  if (!payload?.uid) return { ignored: "geen booking uid" };

  const organizerDomain = normalizeEmail(payload.organizer?.email)?.split("@")[1];
  const attendee = (payload.attendees ?? []).find((a) => {
    const email = normalizeEmail(a.email);
    return email && email.split("@")[1] !== organizerDomain;
  });
  const email = normalizeEmail(attendee?.email);
  if (!email) return { ignored: "geen deelnemer met mailadres" };

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
    },
  };
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
  | { status: "handled"; activityId: string | null; contactId: string; duplicate: boolean }
  | { status: "ignored"; reason: string };

/** Find or create the contact behind the attendee. Free mail without a known contact cannot be placed. */
async function resolveContact(db: Db, booking: CalBooking) {
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

export async function handleCalBooking(db: Db, booking: CalBooking): Promise<CalResult> {
  const contact = await resolveContact(db, booking);
  if (!contact) return { status: "ignored", reason: "privé mailadres zonder bekend contact" };

  const meetingDate = booking.startTime ? amsterdamDate(booking.startTime) : null;
  const when = booking.startTime
    ? new Intl.DateTimeFormat("nl-NL", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Amsterdam" }).format(
        new Date(booking.startTime),
      )
    : "onbekend moment";

  let outcome: TablesInsert<"activities">["outcome"] = "afspraak";
  let notes = `Afspraak geboekt via Cal.com voor ${when}${booking.title ? `: ${booking.title}` : ""}`;
  if (booking.trigger === "BOOKING_CANCELLED") {
    outcome = "notitie";
    notes = `Afspraak geannuleerd (${when})${booking.cancellationReason ? `: ${booking.cancellationReason}` : ""}`;
  } else if (booking.trigger === "BOOKING_RESCHEDULED") {
    // A reschedule is the same meeting: log it as a note when we already
    // counted the original booking, so the report does not count it twice.
    const previous = booking.previousUid
      ? await db
          .from("activities")
          .select("id")
          .in("external_id", [`calcom:${booking.previousUid}:BOOKING_CREATED`, `calcom:${booking.previousUid}:BOOKING_RESCHEDULED`])
          .eq("outcome", "afspraak")
          .limit(1)
      : { data: [] };
    if (previous.data && previous.data.length > 0) {
      outcome = "notitie";
      notes = `Afspraak verzet naar ${when}`;
    }
  }

  const row: TablesInsert<"activities"> = {
    contact_id: contact.id,
    company_id: contact.company_id,
    channel: "meeting",
    outcome,
    notes,
    next_action: booking.trigger === "BOOKING_CANCELLED" ? "Nieuwe afspraak voorstellen" : "Salesgesprek",
    next_action_date: booking.trigger === "BOOKING_CANCELLED" ? amsterdamDate() : meetingDate,
    source: "calcom",
    external_id: `calcom:${booking.uid}:${booking.trigger}`,
  };
  const { data, error } = await db
    .from("activities")
    .upsert(row, { onConflict: "external_id", ignoreDuplicates: true })
    .select("id");
  if (error) throw error;
  const activityId = data?.[0]?.id ?? null;
  if (booking.trigger !== "BOOKING_CANCELLED") await promoteContactStatus(db, contact.id, "afspraak");
  return { status: "handled", activityId, contactId: contact.id, duplicate: activityId === null };
}
