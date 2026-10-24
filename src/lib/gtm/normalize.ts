/**
 * Normalisation shared by every import, scrape and sync. Mirrors the SQL
 * functions normalize_domain / normalize_linkedin in the GTM migration, so the
 * app and the database agree on what counts as "the same" record.
 */

/** "https://www.Example.nl/jobs?x=1" -> "example.nl" */
export function normalizeDomain(value: string | null | undefined): string | null {
  if (!value) return null;
  const domain = value
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[/?#:].*$/, "");
  return domain || null;
}

/** "https://nl.linkedin.com/in/Jan-Jansen/?trk=x" -> "linkedin.com/in/jan-jansen" */
export function normalizeLinkedin(value: string | null | undefined): string | null {
  if (!value) return null;
  const url = value
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/^([a-z]{2,3}\.|www\.)?linkedin\.com/, "linkedin.com")
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "");
  return url || null;
}

/** Lowercased, trimmed email or null. */
export function normalizeEmail(value: string | null | undefined): string | null {
  const email = value?.trim().toLowerCase();
  return email && email.includes("@") ? email : null;
}

/**
 * Dutch numbers to E.164: "06 12345678" -> "+31612345678". Other countries are
 * kept with their own + prefix. Returns null when there are too few digits.
 */
export function normalizePhone(value: string | null | undefined): string | null {
  if (!value) return null;
  let digits = value.replace(/[^\d+]/g, "");
  if (digits.startsWith("00")) digits = `+${digits.slice(2)}`;
  if (digits.startsWith("0")) digits = `+31${digits.slice(1)}`;
  if (!digits.startsWith("+")) digits = `+${digits}`;
  return digits.replace(/\D/g, "").length >= 9 ? digits : null;
}

/** Dutch mobile numbers start with +316. */
export function phoneTypeFor(phone: string | null): "mobiel" | "vast" | null {
  if (!phone) return null;
  if (phone.startsWith("+31")) return phone.startsWith("+316") ? "mobiel" : "vast";
  return null;
}

/** Rule 5: eenmanszaak and vof are never called (Dutch telemarketing rules). */
export function isExcludedFromCalling(legalForm: string | null | undefined): boolean {
  const form = (legalForm ?? "").toLowerCase().replace(/\./g, "");
  return /eenmanszaak|\bvof\b|vennootschap onder firma/.test(form);
}

/** "Jan van der Berg" -> { first: "Jan", last: "van der Berg" } */
export function splitName(full: string | null | undefined): { first: string | null; last: string | null } {
  const parts = (full ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: null, last: null };
  return { first: parts[0], last: parts.slice(1).join(" ") || null };
}

/** Stable key for "the same vacancy": the source URL without tracking, else company + title. */
export function signalDedupeKey(input: {
  source: string;
  sourceUrl?: string | null;
  companyDomain: string;
  title?: string | null;
}): string {
  if (input.sourceUrl) {
    const url = input.sourceUrl.trim().toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/[?#].*$/, "").replace(/\/+$/, "");
    if (url) return `${input.source}:${url}`;
  }
  const title = (input.title ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  return `${input.source}:${input.companyDomain}:${title}`;
}
