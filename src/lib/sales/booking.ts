// The Cal.com sales link, prefilled for the contact on the call screen
// (feedback Julius, section 2.9). Pure, safe for client components.
//
// Cal.com fills name, email and notes from the query and stores metadata[...]
// on the booking; the webhook (src/lib/integrations/calcom.ts) reads the
// contact and the caller back from it, so the booking fills in the planned
// meeting that "Meeting planned" created.

export type SalesBookingPrefill = {
  name: string | null;
  email: string | null;
  notes?: string | null;
  contactId: string;
  companyId: string;
  callerId?: string | null;
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

/** NEXT_PUBLIC_CALCOM_SALES_URL, else the booking link of the signed-in team member. */
export function salesBookingBase(envUrl: string | null | undefined, ownBookingUrl: string | null | undefined): string | null {
  if (isHttpsUrl(envUrl?.trim())) return envUrl!.trim();
  if (isHttpsUrl(ownBookingUrl?.trim())) return ownBookingUrl!.trim();
  return null;
}

export function buildSalesBookingUrl(base: string, prefill: SalesBookingPrefill): string {
  const url = new URL(base);
  if (prefill.name?.trim()) url.searchParams.set("name", prefill.name.trim());
  if (prefill.email?.trim()) url.searchParams.set("email", prefill.email.trim());
  if (prefill.notes?.trim()) url.searchParams.set("notes", prefill.notes.trim().slice(0, 1000));
  url.searchParams.set("metadata[contact_id]", prefill.contactId);
  url.searchParams.set("metadata[company_id]", prefill.companyId);
  if (prefill.callerId) url.searchParams.set("metadata[caller_id]", prefill.callerId);
  url.searchParams.set("utm_source", "nordavo");
  url.searchParams.set("utm_medium", "call_screen");
  return url.toString();
}
