import { z } from "zod";
import type { InterviewKind, InterviewStatus } from "@/lib/database.types";
import type { Tone } from "@/lib/labels";
import { mailButton, mailLinkFallback } from "@/lib/notify/layout";

/**
 * Interview scheduling (recruitment brief 2.14), the pure parts: labels,
 * the prefilled Cal.com link, reading interview bookings from the webhook
 * and the mails. Database work is in public.interview_from_booking().
 */

export const interviewKinds: { value: InterviewKind; label: string; description: string }[] = [
  { value: "interview", label: "Interview", description: "With a technical recruiter about everything and anything." },
  { value: "english_interview", label: "English interview", description: "English and communication." },
  { value: "client_interview", label: "Client interview", description: "With the client; moves the candidate to Client interview." },
];

export const interviewStatuses: { value: InterviewStatus; label: string; tone: Tone }[] = [
  { value: "invited", label: "Invited", tone: "neutral" },
  { value: "scheduled", label: "Scheduled", tone: "brand" },
  { value: "rescheduled", label: "Rescheduled", tone: "brand" },
  { value: "cancelled", label: "Cancelled", tone: "danger" },
  { value: "done", label: "Done", tone: "success" },
  { value: "no_show", label: "No show", tone: "warning" },
];

export function interviewKindLabel(kind: InterviewKind) {
  return interviewKinds.find((k) => k.value === kind)?.label ?? kind;
}

export function interviewStatusOption(status: InterviewStatus) {
  return interviewStatuses.find((s) => s.value === status) ?? { value: status, label: status, tone: "neutral" as Tone };
}

/** The interview in a sentence: "an English interview". */
export function interviewPhrase(kind: InterviewKind) {
  if (kind === "english_interview") return { article: "an", noun: "English interview" };
  if (kind === "client_interview") return { article: "a", noun: "client interview" };
  return { article: "an", noun: "interview" };
}

/** The pipeline stage a booked interview of this kind moves the candidate to. */
export function stageForInterview(kind: InterviewKind): "interview" | "client_interview" {
  return kind === "client_interview" ? "client_interview" : "interview";
}

/** Whether a stored booking link is a usable https URL. */
export function isBookingUrl(value: string | null | undefined): value is string {
  if (!value) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * The interviewer's Cal.com link, prefilled for this candidate. Cal.com
 * fills name and email from the query, stores metadata[...] on the booking
 * (and sends it back in the webhook payload) and keeps the utm parameters.
 * The interview id is what the webhook matches on.
 */
export function buildInviteUrl(
  bookingUrl: string,
  { name, email, interviewId, applicationId }: { name: string; email: string; interviewId: string; applicationId: string },
): string {
  const url = new URL(bookingUrl);
  url.searchParams.set("name", name);
  url.searchParams.set("email", email);
  url.searchParams.set("metadata[interview_id]", interviewId);
  url.searchParams.set("metadata[application_id]", applicationId);
  url.searchParams.set("utm_source", "nordavo");
  url.searchParams.set("utm_medium", "interview_invite");
  url.searchParams.set("utm_content", interviewId);
  return url.toString();
}

// ---------------------------------------------------------------------------
// Webhook
// ---------------------------------------------------------------------------

const uuid = z.guid();
const handled = ["BOOKING_CREATED", "BOOKING_RESCHEDULED", "BOOKING_CANCELLED"] as const;

const bookingSchema = z.looseObject({
  triggerEvent: z.string(),
  payload: z
    .looseObject({
      uid: z.string().nullish(),
      startTime: z.string().nullish(),
      endTime: z.string().nullish(),
      rescheduleUid: z.string().nullish(),
      fromReschedule: z.string().nullish(),
      cancellationReason: z.string().nullish(),
      metadata: z.record(z.string(), z.unknown()).nullish(),
      tracking: z.record(z.string(), z.unknown()).nullish(),
      attendees: z.array(z.looseObject({ email: z.string().nullish() })).nullish(),
      organizer: z.looseObject({ email: z.string().nullish() }).nullish(),
    })
    .nullish(),
});

export type InterviewBooking = {
  trigger: (typeof handled)[number];
  uid: string;
  previousUid: string | null;
  interviewId: string | null;
  attendeeEmail: string | null;
  startTime: string | null;
  endTime: string | null;
  reason: string | null;
};

function uuidOrNull(value: unknown): string | null {
  return typeof value === "string" && uuid.safeParse(value.trim()).success ? value.trim() : null;
}

/**
 * The booking fields the interview flow needs, from a raw Cal.com webhook.
 * Null for events it does not handle. Whether the booking is an interview
 * at all is decided by the database (interview id, uid or open invite).
 */
export function parseInterviewBooking(json: unknown): InterviewBooking | null {
  const parsed = bookingSchema.safeParse(json);
  if (!parsed.success) return null;
  const { triggerEvent, payload } = parsed.data;
  if (!(handled as readonly string[]).includes(triggerEvent) || !payload?.uid) return null;

  const organizer = payload.organizer?.email?.trim().toLowerCase();
  const attendee = (payload.attendees ?? [])
    .map((a) => a.email?.trim().toLowerCase())
    .find((email) => email && email !== organizer);

  return {
    trigger: triggerEvent as InterviewBooking["trigger"],
    uid: payload.uid,
    previousUid: payload.rescheduleUid ?? payload.fromReschedule ?? null,
    interviewId: uuidOrNull(payload.metadata?.interview_id) ?? uuidOrNull(payload.tracking?.utm_content),
    attendeeEmail: attendee ?? null,
    startTime: payload.startTime ?? null,
    endTime: payload.endTime ?? null,
    reason: payload.cancellationReason ?? null,
  };
}

// ---------------------------------------------------------------------------
// Mails (English, candidate facing)
// ---------------------------------------------------------------------------

type Escape = (value: string) => string;

export function formatInterviewTime(iso: string, timeZone = "Asia/Kolkata") {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
    timeZoneName: "short",
  }).format(new Date(iso));
}

export function inviteMail(
  escape: Escape,
  { candidateName, vacancyTitle, interviewerName, kind, url }: {
    candidateName: string;
    vacancyTitle: string;
    interviewerName: string;
    kind: InterviewKind;
    url: string;
  },
) {
  const { article, noun: label } = interviewPhrase(kind);
  const first = candidateName.split(" ")[0] || candidateName;
  const subject = `Pick a time for your ${label}: ${vacancyTitle}`;
  const text = [
    `Hi ${first},`,
    "",
    `Thank you for your application for ${vacancyTitle}. We would like to invite you to ${article} ${label} with ${interviewerName} of Nordavo.`,
    "",
    "Please pick a time that suits you here:",
    url,
    "",
    "The meeting is added to your calendar with the link to join. You can reschedule or cancel from the confirmation mail.",
    "",
    "Kind regards,",
    "Nordavo",
  ].join("\n");
  const html = `<p>Hi ${escape(first)},</p>
<p>Thank you for your application for <strong>${escape(vacancyTitle)}</strong>. We would like to invite you to ${article} ${escape(label)} with ${escape(interviewerName)} of Nordavo.</p>
${mailButton(url, "Pick a time")}
${mailLinkFallback(url)}
<p>The meeting is added to your calendar with the link to join. You can reschedule or cancel from the confirmation mail.</p>
<p>Kind regards,<br>Nordavo</p>`;
  return { subject, html, text };
}

export function reminderMail(
  escape: Escape,
  {
    to,
    candidateName,
    vacancyTitle,
    interviewerName,
    kind,
    startsAt,
    timeZone,
    portalUrl,
  }: {
    to: "candidate" | "interviewer";
    candidateName: string;
    vacancyTitle: string;
    interviewerName: string;
    kind: InterviewKind;
    startsAt: string;
    timeZone: string;
    portalUrl?: string;
  },
) {
  const label = interviewKindLabel(kind);
  const noun = interviewPhrase(kind).noun;
  const when = formatInterviewTime(startsAt, timeZone);
  if (to === "candidate") {
    const first = candidateName.split(" ")[0] || candidateName;
    return {
      subject: `Reminder: your ${noun} with Nordavo, ${when}`,
      text: `Hi ${first},\n\nA reminder of your ${noun} for ${vacancyTitle} with ${interviewerName}: ${when}.\nThe link to join is in the calendar invitation.\n\nKind regards,\nNordavo`,
      html: `<p>Hi ${escape(first)},</p><p>A reminder of your ${escape(noun)} for <strong>${escape(vacancyTitle)}</strong> with ${escape(interviewerName)}: <strong>${escape(when)}</strong>.</p><p>The link to join is in the calendar invitation.</p><p>Kind regards,<br>Nordavo</p>`,
    };
  }
  return {
    subject: `Tomorrow: ${noun} with ${candidateName} (${vacancyTitle})`,
    text: `${label} with ${candidateName} for ${vacancyTitle}: ${when}.${portalUrl ? `\nCandidate and feedback form: ${portalUrl}` : ""}`,
    html: `<p>${escape(label)} with <strong>${escape(candidateName)}</strong> for ${escape(vacancyTitle)}: <strong>${escape(when)}</strong>.</p>${
      portalUrl ? `<p><a href="${escape(portalUrl)}">Open the candidate</a> to read the profile and fill in the feedback afterwards.</p>` : ""
    }`,
  };
}

/** Whether a booked interview has started (feedback can be filled in from then on). */
export function hasStarted(startsAt: string | null, now = new Date()): boolean {
  return startsAt !== null && new Date(startsAt).getTime() <= now.getTime();
}

/** Interviews due for the reminder: booked, starting within the window, not reminded yet. */
export function isDueForReminder(
  interview: { status: InterviewStatus; starts_at: string | null; reminder_sent_at: string | null },
  now: Date,
  hours = 24,
): boolean {
  if (interview.status !== "scheduled" && interview.status !== "rescheduled") return false;
  if (!interview.starts_at || interview.reminder_sent_at) return false;
  const start = new Date(interview.starts_at).getTime();
  return start > now.getTime() && start <= now.getTime() + hours * 3_600_000;
}
