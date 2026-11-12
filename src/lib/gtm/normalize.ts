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

/**
 * The LinkedIn link to store and show: "nl.linkedin.com/in/ACwAAB12Cd/?trk=x"
 * -> "https://www.linkedin.com/in/ACwAAB12Cd". The host and the kind of page
 * (in, company) in lowercase, the rest exactly as given: the ACwAA member ids
 * of Apify are case sensitive and do not open when lowercased. A value that
 * is not a LinkedIn link only gets https:// in front. Mirrors the SQL
 * function linkedin_clean_url. Matching uses normalizeLinkedin (the key).
 */
export function cleanLinkedinUrl(value: string | null | undefined): string | null {
  const v = value?.trim();
  if (!v) return null;
  if (/^([a-z][a-z0-9+.-]*:\/\/)?([a-z]{2,3}\.|www\.)?linkedin\.com(\/|$|\?|#)/i.test(v)) {
    let path = v
      .replace(/^([a-z][a-z0-9+.-]*:\/\/)?[^/?#]*/i, "")
      .replace(/[?#].*$/, "")
      .replace(/\/+$/, "")
      .replace(/\/\/+/g, "/");
    path = path.replace(/^\/([^/]+)/, (_, kind: string) => `/${kind.toLowerCase()}`);
    return `https://www.linkedin.com${path}`;
  }
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : `https://${v}`;
}

const MEMBER_URN = /^AC[a-z]AA[a-z0-9_-]{6,}$/i;

/**
 * The LinkedIn member id in an Apify or Sales Navigator link
 * ("linkedin.com/in/ACwAAB12Cd" -> "ACwAAB12Cd"), or the id itself; null for
 * a normal profile link. Mirrors the SQL function linkedin_member_urn.
 */
export function linkedinMemberUrn(value: string | null | undefined): string | null {
  const v = value?.trim();
  if (!v) return null;
  if (MEMBER_URN.test(v)) return v;
  const m = /linkedin\.com\/(?:in|sales\/lead|sales\/people)\/(AC[a-z]AA[a-z0-9_-]{6,})/i.exec(v);
  return m ? m[1] : null;
}

/** An Apify member id link that was stored in lowercase: it does not open until it is repaired. */
export function isLinkedinLinkBroken(value: string | null | undefined): boolean {
  const urn = linkedinMemberUrn(value);
  return urn !== null && urn === urn.toLowerCase();
}

/**
 * True when `incoming` is the same LinkedIn link as `current` with a better
 * case: the stored one was lowercased (an old Apify link), the new one is not.
 */
export function isLinkedinCaseRepair(current: string | null | undefined, incoming: string | null | undefined): boolean {
  if (!current || !incoming) return false;
  const a = cleanLinkedinUrl(current);
  const b = cleanLinkedinUrl(incoming);
  if (!a || !b || a === b) return false;
  return normalizeLinkedin(a) === normalizeLinkedin(b) && a === a.toLowerCase() && b !== b.toLowerCase();
}

/**
 * A link to a vacancy or a web page as an absolute URL:
 * "nl.indeed.com/viewjob?jk=abc" -> "https://nl.indeed.com/viewjob?jk=abc".
 * Null when it is not a web address.
 */
export function cleanSourceUrl(value: string | null | undefined): string | null {
  const v = value?.trim();
  if (!v || /\s/.test(v)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : `https://${v.replace(/^\/+/, "")}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(url.hostname)) return null;
    return withScheme;
  } catch {
    return null;
  }
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

// Query parameters that say which vacancy a link is, per job board. Every
// other parameter is tracking and is dropped from the key.
const VACANCY_ID_PARAMS: { host: RegExp; params: string[] }[] = [
  { host: /(^|\.)indeed\./, params: ["jk", "vjk"] },
  { host: /(^|\.)linkedin\.com$/, params: ["currentjobid"] },
  { host: /(^|\.)werkzoeken\.nl$/, params: ["id"] },
];
// On other sites only a parameter that looks like a vacancy id is kept, so
// the keys of links saved before stay the same.
const ID_PARAM = /^(id|jobid|job_id|vacancyid|vacancy_id|vacatureid|vacature_id|vacature|gh_jid|jid)$/i;

/** The part of a vacancy link that identifies it, lowercased, without scheme and tracking. */
export function vacancyUrlKey(value: string): string | null {
  const clean = cleanSourceUrl(value);
  if (!clean) return null;
  const url = new URL(clean);
  const host = url.hostname.toLowerCase();
  const path = url.pathname.replace(/\/+$/, "").toLowerCase();
  const params = [...url.searchParams.entries()].map(([k, v]) => [k.toLowerCase(), v.toLowerCase()] as [string, string]);
  const board = VACANCY_ID_PARAMS.find((b) => b.host.test(host));
  let kept: [string, string][];
  if (board) {
    // Indeed: viewjob?jk=abc and ?vjk=abc are the same vacancy.
    const hit = params.find(([k]) => board.params.includes(k));
    kept = hit ? [[board.params[0], hit[1]]] : [];
  } else {
    kept = params.filter(([k]) => ID_PARAM.test(k)).sort(([a], [b]) => a.localeCompare(b));
  }
  const query = kept.map(([k, v]) => `${k}=${v}`).join("&");
  return `${host}${path}${query ? `?${query}` : ""}`;
}

/**
 * Stable key for "the same vacancy": the source URL without tracking (but
 * with the parameter that names the vacancy, such as Indeed's jk), else
 * company + title. Before November 2026 the whole query string was dropped,
 * so every Indeed vacancy (viewjob?jk=...) had the same key and only the
 * first one was saved.
 */
export function signalDedupeKey(input: {
  source: string;
  sourceUrl?: string | null;
  companyDomain: string;
  title?: string | null;
}): string {
  if (input.sourceUrl) {
    const url = vacancyUrlKey(input.sourceUrl);
    if (url) return `${input.source}:${url}`;
  }
  const title = (input.title ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  return `${input.source}:${input.companyDomain}:${title}`;
}
