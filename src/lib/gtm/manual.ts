/**
 * Input handling for leads and contacts added by hand in the portal. Pure
 * functions, so the server actions stay thin and this logic is unit tested.
 * Normalisation itself lives in ./normalize (shared with the flow).
 */

import { normalizeDomain, normalizeEmail, normalizeLinkedin, normalizePhone, phoneTypeFor } from "./normalize";

/** Value of companies.source / contacts.source for records added in the portal. */
export const MANUAL_SOURCE = "manual";

// One or more labels and a TLD of letters (or punycode), e.g. "acme.nl", "app.acme.co.uk".
const HOSTNAME = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;

/**
 * "https://www.Acme.nl/about" -> { domain: "acme.nl", website: "https://www.Acme.nl/about" }
 * "acme.nl" -> { domain: "acme.nl", website: "https://acme.nl" }
 * Returns null when there is no usable domain.
 */
export function parseWebsite(value: string | null | undefined): { domain: string; website: string } | null {
  const input = value?.trim();
  if (!input || /\s/.test(input)) return null;
  const hasScheme = /^[a-z]+:\/\//i.test(input);
  if (hasScheme && !/^https?:\/\//i.test(input)) return null;
  // Someone pastes an email address: the part after @ is the domain.
  const isEmail = !hasScheme && input.includes("@");
  const domain = normalizeDomain(isEmail ? input.split("@").pop() : input);
  if (!domain || !HOSTNAME.test(domain)) return null;
  const website = isEmail ? `https://${domain}` : hasScheme ? input : `https://${input}`;
  return { domain, website };
}

/** A personal LinkedIn profile ("linkedin.com/in/..."), normalised, or null. */
export function parseLinkedinProfile(value: string | null | undefined): string | null {
  const url = normalizeLinkedin(value);
  return url && /^linkedin\.com\/in\/[^/]+/.test(url) ? url : null;
}

/** A LinkedIn company page ("linkedin.com/company/..."), normalised, or null. */
export function parseLinkedinCompany(value: string | null | undefined): string | null {
  const url = normalizeLinkedin(value);
  return url && /^linkedin\.com\/(company|school|showcase)\/[^/]+/.test(url) ? url : null;
}

export type ManualContactFields = {
  first_name?: string;
  last_name?: string;
  title?: string;
  tier?: 1 | 2 | 3;
  email?: string;
  phone?: string;
  linkedin_url?: string;
};

/**
 * Row values for a manual contact, with the source and date on email and
 * phone (hard rule 3). Field errors for values that do not normalise.
 */
export function manualContactRow(
  companyId: string,
  input: ManualContactFields,
  now: string,
):
  | { ok: true; row: ManualContactRow }
  | { ok: false; fieldErrors: Record<string, string> } {
  const fieldErrors: Record<string, string> = {};
  const firstName = input.first_name?.trim() || null;
  const lastName = input.last_name?.trim() || null;
  if (!firstName && !lastName) fieldErrors.first_name = "Enter a first or last name.";

  const email = input.email ? normalizeEmail(input.email) : null;
  if (input.email && !email) fieldErrors.email = "Enter a valid email address.";
  const phone = input.phone ? normalizePhone(input.phone) : null;
  if (input.phone && !phone) fieldErrors.phone = "Enter a valid phone number, for example 06 12345678.";
  const linkedin = input.linkedin_url ? parseLinkedinProfile(input.linkedin_url) : null;
  if (input.linkedin_url && !linkedin) {
    fieldErrors.linkedin_url = "Enter a LinkedIn profile URL, for example linkedin.com/in/jane-doe.";
  }
  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };

  return {
    ok: true,
    row: {
      company_id: companyId,
      first_name: firstName,
      last_name: lastName,
      title: input.title?.trim() || null,
      tier: input.tier ?? null,
      linkedin_url: linkedin,
      email,
      email_source: email ? MANUAL_SOURCE : null,
      email_found_at: email ? now : null,
      email_status: email ? "unknown" : null,
      phone,
      phone_source: phone ? MANUAL_SOURCE : null,
      phone_found_at: phone ? now : null,
      phone_type: phoneTypeFor(phone),
      source: MANUAL_SOURCE,
      sources: [MANUAL_SOURCE],
    },
  };
}

export type ManualContactRow = {
  company_id: string;
  first_name: string | null;
  last_name: string | null;
  title: string | null;
  tier: 1 | 2 | 3 | null;
  linkedin_url: string | null;
  email: string | null;
  email_source: string | null;
  email_found_at: string | null;
  email_status: "unknown" | null;
  phone: string | null;
  phone_source: string | null;
  phone_found_at: string | null;
  phone_type: "mobiel" | "vast" | null;
  source: string;
  sources: string[];
};

/** Escape % and _ so a value matches itself in an ilike filter. */
export function likeExact(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}
