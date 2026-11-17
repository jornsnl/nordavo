// The Cal.com sales links, prefilled for the contact on the call screen
// (feedback Julius, section 2.9 and the Cal.com tasks of November 2026). Pure,
// safe for client components.
//
// Cal.com fills name, email, notes and the booking questions from the query
// and stores metadata[...] on the booking; the webhook and the claude-calcom
// job (src/lib/integrations/calcom.ts) read the meeting, contact and caller
// back from it, so the booking fills in the awaiting meeting that "Meeting
// planned" created.

/** One Cal.com link of Settings, General (table sales_booking_links). */
export type BookingLink = {
  id: string;
  /** Who the meeting is with, for example Julius or Floris. */
  label: string;
  url: string;
  /** Identifiers of the Cal.com booking questions for the company and the role. */
  companyField: string;
  roleField: string;
};

export const DEFAULT_COMPANY_FIELD = "bedrijfsnaam";
export const DEFAULT_ROLE_FIELD = "welke-rol-zoek-je";

export type SalesBookingPrefill = {
  name: string | null;
  email: string | null;
  /** "Bedrijfsnaam" in the Cal.com form. */
  company?: string | null;
  /** "Welke rol zoek je?": the open vacancies of the company. */
  role?: string | null;
  notes?: string | null;
  contactId: string;
  companyId: string;
  callerId?: string | null;
  /** The awaiting meeting this booking completes. */
  meetingId?: string | null;
};

/** Whether a value is a usable https link. */
export function isHttpsUrl(value: string | null | undefined): value is string {
  if (!value) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * The links to offer: the ones from Settings, else NEXT_PUBLIC_CALCOM_SALES_URL
 * as the only link. The interview link of a team member is not a sales link.
 */
export function bookingLinksOrEnv(links: BookingLink[], envUrl: string | null | undefined): BookingLink[] {
  if (links.length > 0) return links;
  const url = envUrl?.trim();
  return isHttpsUrl(url)
    ? [{ id: "env", label: "Cal.com", url, companyField: DEFAULT_COMPANY_FIELD, roleField: DEFAULT_ROLE_FIELD }]
    : [];
}

/** The link with this id, else the first one. */
export function pickBookingLink(links: BookingLink[], id?: string | null): BookingLink | null {
  return links.find((l) => l.id === id) ?? links[0] ?? null;
}

export function buildSalesBookingUrl(
  base: string,
  prefill: SalesBookingPrefill,
  fields: { companyField?: string; roleField?: string } = {},
): string {
  const url = new URL(base);
  if (prefill.name?.trim()) url.searchParams.set("name", prefill.name.trim());
  if (prefill.email?.trim()) url.searchParams.set("email", prefill.email.trim());
  if (prefill.company?.trim()) url.searchParams.set(fields.companyField || DEFAULT_COMPANY_FIELD, prefill.company.trim().slice(0, 200));
  if (prefill.role?.trim()) url.searchParams.set(fields.roleField || DEFAULT_ROLE_FIELD, prefill.role.trim().slice(0, 300));
  if (prefill.notes?.trim()) url.searchParams.set("notes", prefill.notes.trim().slice(0, 1000));
  url.searchParams.set("metadata[contact_id]", prefill.contactId);
  url.searchParams.set("metadata[company_id]", prefill.companyId);
  if (prefill.callerId) url.searchParams.set("metadata[caller_id]", prefill.callerId);
  if (prefill.meetingId) url.searchParams.set("metadata[meeting_id]", prefill.meetingId);
  url.searchParams.set("utm_source", "nordavo");
  url.searchParams.set("utm_medium", "call_screen");
  return url.toString();
}
