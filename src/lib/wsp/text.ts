// Filling in the fixed texts of the Working Style Profile (names, dates,
// file name). Pure, tested in tests/wsp.test.ts.

import {
  CLIENT_INTRO_TEMPLATE,
  CONSENT_TEXT_TEMPLATE,
  PERSON_INTRO,
  PRIVACY_PLACEHOLDER,
  WATERMARK_TEMPLATE,
  WITHDRAWN_MAIL_TEMPLATE,
} from "./content";

export type ReportAudience = "person" | "client" | "staff";

/** First name and last name from a full name: the first word, and the rest. */
export function splitName(fullName: string | null | undefined): { first: string; last: string } {
  const words = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return { first: "", last: "" };
  return { first: words[0], last: words.slice(1).join(" ") };
}

function fill(template: string, values: Record<string, string>): string {
  let out = template;
  for (const [key, value] of Object.entries(values)) out = out.split(`[${key}]`).join(value);
  return out;
}

/** The intro of the report for the role that reads it. Staff sees the client intro. */
export function reportIntro(audience: ReportAudience, firstName: string): { heading: string; body: string } {
  if (audience === "person") return { ...PERSON_INTRO };
  return {
    heading: CLIENT_INTRO_TEMPLATE.heading,
    body: fill(CLIENT_INTRO_TEMPLATE.body, { "first name": firstName }),
  };
}

export function consentText(clientName: string): string {
  return fill(CONSENT_TEXT_TEMPLATE, { "client name": clientName });
}

export function withdrawnMailText(firstName: string): string {
  return fill(WITHDRAWN_MAIL_TEMPLATE, { "first name": firstName });
}

export function watermarkText(clientName: string, fullName: string, consentDate: string): string {
  return fill(WATERMARK_TEMPLATE, { "client name": clientName, "full name": fullName, "date of consent": consentDate });
}

/** "9 November 2026", in Amsterdam time. */
export function formatWspDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Amsterdam" }).format(date);
}

/** yyyy-mm-dd in Amsterdam time. */
export function isoDay(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Europe/Amsterdam" }).format(date);
}

function slug(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** working-style-profile_[firstname]-[lastname]_[yyyy-mm-dd].pdf */
export function pdfFileName(fullName: string, completedAt: string): string {
  const { first, last } = splitName(fullName);
  const name = [slug(first), slug(last)].filter(Boolean).join("-") || "profile";
  return `working-style-profile_${name}_${isoDay(completedAt)}.pdf`;
}

/** The last intro bullet split around the placeholder, so the page can put a link there. */
export function splitPrivacy(text: string): { before: string; after: string } | null {
  const at = text.indexOf(PRIVACY_PLACEHOLDER);
  if (at < 0) return null;
  return { before: text.slice(0, at), after: text.slice(at + PRIVACY_PLACEHOLDER.length) };
}

/** NEXT_PUBLIC_PRIVACY_URL when it is an http(s) address. */
export function privacyUrl(value: string | undefined = process.env.NEXT_PUBLIC_PRIVACY_URL): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** A share checkbox is only ticked for an active share; never by default. */
export function shareChecked(status: ShareStatus): boolean {
  return status === "shared";
}

export type ShareStatus = "shared" | "not_shared" | "withdrawn";

export const SHARE_STATUS_LABELS: Record<ShareStatus, string> = {
  shared: "Shared",
  not_shared: "Not shared",
  withdrawn: "Withdrawn",
};

/** shared / not shared / withdrawn from the share rows of one client (newest first or in any order). */
export function shareStatus(rows: { consented_at: string; revoked_at: string | null }[]): ShareStatus {
  if (rows.some((row) => !row.revoked_at)) return "shared";
  return rows.length > 0 ? "withdrawn" : "not_shared";
}
