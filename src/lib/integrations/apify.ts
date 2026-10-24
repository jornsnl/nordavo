import "server-only";
import { z } from "zod";
import { normalizeDomain, normalizeLinkedin, splitName } from "@/lib/gtm/normalize";
import { parseEmployeeCount, TECH_SEARCH_ROLES } from "@/lib/gtm/signals";

/**
 * Apify: job scraping (LinkedIn, Indeed) for S1 and the people search for S3.
 *
 * Endpoint used:
 *   POST https://api.apify.com/v2/acts/{actorId}/run-sync-get-dataset-items
 *        ?timeout={seconds}&maxItems={n}&format=json
 *   Authorization: Bearer APIFY_TOKEN, body = the actor input (JSON).
 *   Returns the dataset items as a JSON array. Apify stops a synchronous run
 *   after 300 seconds (HTTP 408); lower --limit when that happens.
 *
 * Actors are configurable (APIFY_LINKEDIN_JOBS_ACTOR, APIFY_INDEED_JOBS_ACTOR,
 * APIFY_PEOPLE_ACTOR, in the form user~actor). The input builders and the
 * mappers below assume these popular actors; ASSUMPTIONS TO CHECK with a real
 * token, because input and output shapes differ per actor:
 *
 *   LinkedIn jobs: curious_coder~linkedin-jobs-scraper
 *     input  { urls: [LinkedIn job search URLs], count, scrapeCompany: true }
 *     output title, companyName, companyLinkedinUrl, companyWebsite,
 *            companyEmployeesCount, location, postedAt, descriptionText, link
 *     Also tolerated: bebity~linkedin-jobs-scraper (companyUrl, publishedAt,
 *     description, jobUrl) and similar field names.
 *
 *   Indeed jobs: misceres~indeed-scraper
 *     input  { startUrls: [{ url }], country: "NL", maxItems, parseCompanyDetails: true }
 *     output positionName, company, location, url, postingDateParsed / postedAt,
 *            description, externalApplyLink, companyInfo { companyWebsite?, employees? }
 *     Also tolerated: valig~indeed-jobs-scraper (title, employer { name,
 *     corporateWebsite, employeesCount }, datePublished, description { text }).
 *     Indeed rarely gives the company website; we then try the apply link when
 *     it points at the company's own site (not an ATS or job board).
 *
 *   People: code_crafter~leads-finder (search by company domain and titles)
 *     input  { company_domain: [..], contact_job_title: [..], fetch_count }
 *     output first_name, last_name, full_name, job_title, linkedin, company_domain
 *     The input also carries the keys of harvestapi~linkedin-company-employees
 *     ({ companies: [LinkedIn company URL], jobTitles, maxItems }), whose output
 *     (firstName, lastName, headline, linkedinUrl, currentPosition[]) the
 *     mapper also reads. Apify actors ignore input keys they do not know.
 */

const APIFY_BASE = "https://api.apify.com/v2";

export function hasApify() {
  return Boolean(process.env.APIFY_TOKEN);
}

function requireToken(): string {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error("APIFY_TOKEN ontbreekt. Zet deze in de omgevingsvariabelen.");
  return token;
}

/** Actor id from an env var, with a clear Dutch error when it is not set. */
export function requireActor(envName: "APIFY_LINKEDIN_JOBS_ACTOR" | "APIFY_INDEED_JOBS_ACTOR" | "APIFY_PEOPLE_ACTOR"): string {
  const actor = process.env[envName]?.trim();
  if (!actor) throw new Error(`${envName} ontbreekt. Zet de Apify actor (gebruiker~actor) in de omgevingsvariabelen.`);
  // The API wants user~actor; accept the user/actor form from the Apify console too.
  return actor.replace("/", "~");
}

const datasetSchema = z.array(z.record(z.string(), z.unknown()));

export type ApifyItem = Record<string, unknown>;

/**
 * Run an actor synchronously and return its dataset items.
 * `timeoutSecs` is the actor run timeout (Apify caps sync runs at 300 s).
 */
export async function runActorSync(
  actorId: string,
  input: unknown,
  { timeoutSecs = 290, maxItems = 200 }: { timeoutSecs?: number; maxItems?: number } = {},
): Promise<ApifyItem[]> {
  const token = requireToken();
  const url = new URL(`${APIFY_BASE}/acts/${encodeURIComponent(actorId)}/run-sync-get-dataset-items`);
  url.searchParams.set("timeout", String(timeoutSecs));
  url.searchParams.set("maxItems", String(maxItems));
  url.searchParams.set("format", "json");
  url.searchParams.set("clean", "true");

  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(input ?? {}),
    // A bit more than the run timeout, so Apify can answer with its own error first.
    signal: AbortSignal.timeout((timeoutSecs + 30) * 1000),
  });

  if (!response.ok) {
    const body = (await response.text().catch(() => "")).slice(0, 500);
    if (response.status === 408) {
      throw new Error(`Apify actor ${actorId} duurde langer dan ${timeoutSecs} seconden. Verlaag --limit.`);
    }
    throw new Error(`Apify actor ${actorId} gaf HTTP ${response.status}: ${body}`);
  }

  const parsed = datasetSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error(`Apify actor ${actorId} gaf geen lijst met items terug: ${parsed.error.message.slice(0, 300)}`);
  }
  return parsed.data;
}

// ---------------------------------------------------------------------------
// Tolerant field access
// ---------------------------------------------------------------------------

/** Value at a dotted path ("employer.name"), or undefined. */
function at(item: unknown, path: string): unknown {
  let current: unknown = item;
  for (const key of path.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/** First non-empty string among several possible field names. */
export function pickString(item: unknown, paths: string[]): string | null {
  for (const path of paths) {
    const value = at(item, path);
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function pickValue(item: unknown, paths: string[]): unknown {
  for (const path of paths) {
    const value = at(item, path);
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

/** Hosts that are job boards, ATS systems or link shorteners, never the company's own domain. */
const NOT_COMPANY_HOSTS = [
  "linkedin.com", "lnkd.in", "indeed.com", "indeed.nl", "glassdoor.com", "glassdoor.nl",
  "nationalevacaturebank.nl", "werkzoeken.nl", "monsterboard.nl", "jobbird.com", "werk.nl",
  "recruitee.com", "homerun.co", "teamtailor.com", "greenhouse.io", "lever.co", "workable.com",
  "smartrecruiters.com", "personio.de", "personio.com", "join.com", "myworkdayjobs.com",
  "workdayjobs.com", "successfactors.com", "successfactors.eu", "icims.com", "jobvite.com",
  "bamboohr.com", "breezy.hr", "jobs.ashbyhq.com", "ashbyhq.com", "otys.nl", "carerix.com",
  "werkenbij.nl", "facebook.com", "google.com", "bit.ly",
];

/** Company domain from a website or URL, or null when it is a job board or ATS. */
export function companyDomainFrom(value: string | null | undefined): string | null {
  const domain = normalizeDomain(value);
  if (!domain || !/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(domain)) return null;
  if (NOT_COMPANY_HOSTS.some((host) => domain === host || domain.endsWith(`.${host}`))) return null;
  return domain;
}

/** ISO date from an absolute date or an Indeed style relative one ("30+ dagen geleden", "3 days ago"). */
export function parsePostedDate(value: unknown, now: Date = new Date()): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    // Epoch seconds or milliseconds.
    const ms = value < 1e12 ? value * 1000 : value;
    return new Date(ms).toISOString();
  }
  if (typeof value !== "string" || !value.trim()) return null;
  const text = value.trim().toLowerCase();
  if (/^(just posted|today|vandaag|zojuist|net geplaatst)/.test(text)) return now.toISOString();
  if (/^(yesterday|gisteren)/.test(text)) return new Date(now.getTime() - 86_400_000).toISOString();
  const relative = text.match(/(\d+)\+?\s*(minute|minuut|minuten|hour|uur|day|dag|dagen|week|weken|weeks|month|maand|maanden|months)/);
  if (relative && /(ago|geleden|^\d)/.test(text)) {
    const n = Number(relative[1]);
    const unit = relative[2];
    const day = 86_400_000;
    const ms = /min/.test(unit) ? n * 60_000 : /(hour|uur)/.test(unit) ? n * 3_600_000 : /(day|dag)/.test(unit) ? n * day : /(week|weken)/.test(unit) ? n * 7 * day : n * 30 * day;
    return new Date(now.getTime() - ms).toISOString();
  }
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export type JobSource = "linkedin" | "indeed";

export type ScrapedJob = {
  source: JobSource;
  companyName: string | null;
  /** Normalised company domain, or null when it cannot be resolved. */
  companyDomain: string | null;
  companyWebsite: string | null;
  companyLinkedinUrl: string | null;
  title: string | null;
  description: string | null;
  location: string | null;
  postedAt: string | null;
  jobUrl: string | null;
  employees: number | null;
};

function stripHtml(value: string | null): string | null {
  if (!value) return null;
  const text = value
    .replace(/<(br|\/p|\/li|\/div|\/h\d)\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n[\s]*/g, "\n")
    .trim();
  return text || null;
}

function linkedinCompanyUrl(value: string | null): string | null {
  const url = normalizeLinkedin(value);
  return url && url.startsWith("linkedin.com/company/") ? url : null;
}

/** LinkedIn jobs actor item -> ScrapedJob (see the actor notes at the top). */
export function mapLinkedinJob(item: ApifyItem, now: Date = new Date()): ScrapedJob {
  const companyWebsite = pickString(item, [
    "companyWebsite", "companyUrlWebsite", "company.website", "companyDetails.website", "website", "company_website",
  ]);
  const companyLinkedinUrl = linkedinCompanyUrl(
    pickString(item, ["companyLinkedinUrl", "companyUrl", "company.linkedinUrl", "company.url", "companyLink", "company_url"]),
  );
  return {
    source: "linkedin",
    companyName: pickString(item, ["companyName", "company.name", "company", "company_name"]),
    companyDomain: companyDomainFrom(companyWebsite),
    companyWebsite,
    companyLinkedinUrl,
    title: pickString(item, ["title", "jobTitle", "position", "job_title"]),
    description: stripHtml(pickString(item, ["descriptionText", "description", "jobDescription", "descriptionHtml", "description_text"])),
    location: pickString(item, ["location", "jobLocation", "place", "formattedLocation"]),
    postedAt: parsePostedDate(pickValue(item, ["postedAt", "publishedAt", "postedDate", "listedAt", "datePosted", "posted_at", "postedTime"]), now),
    jobUrl: pickString(item, ["link", "jobUrl", "url", "applyUrl", "job_url"]),
    employees: parseEmployeeCount(pickValue(item, ["companyEmployeesCount", "companySize", "company.employeeCount", "companyDetails.employeeCount", "employeeCount"])),
  };
}

/** Indeed jobs actor item -> ScrapedJob (see the actor notes at the top). */
export function mapIndeedJob(item: ApifyItem, now: Date = new Date()): ScrapedJob {
  const companyWebsite = pickString(item, [
    "companyInfo.companyWebsite", "companyInfo.website", "companyWebsite", "employer.corporateWebsite", "employer.website", "company.website",
  ]);
  const applyLink = pickString(item, ["externalApplyLink", "applyUrl", "jobUrlExternal"]);
  const companyLinkedinUrl = linkedinCompanyUrl(pickString(item, ["companyInfo.linkedinUrl", "companyLinkedinUrl", "employer.linkedinUrl"]));
  const location = pickValue(item, ["location", "jobLocation", "formattedLocation"]);
  const locationText =
    typeof location === "string"
      ? location
      : pickString(item, ["location.formattedAddressShort", "location.city", "location.fullAddress", "jobLocationCity"]);
  return {
    source: "indeed",
    companyName: pickString(item, ["company", "companyName", "employer.name", "companyInfo.name"]),
    companyDomain: companyDomainFrom(companyWebsite) ?? companyDomainFrom(applyLink),
    companyWebsite: companyWebsite ?? null,
    companyLinkedinUrl,
    title: pickString(item, ["positionName", "title", "jobTitle", "displayTitle"]),
    description: stripHtml(pickString(item, ["description", "description.text", "descriptionText", "descriptionHTML", "description.html"])),
    location: locationText,
    postedAt: parsePostedDate(pickValue(item, ["postingDateParsed", "datePublished", "postedAt", "pubDate", "datePosted"]), now),
    jobUrl: pickString(item, ["url", "jobUrl", "link", "jobKeyUrl"]),
    employees: parseEmployeeCount(pickValue(item, ["companyInfo.employees", "companyInfo.companySize", "employer.employeesCount", "employer.employeeCount", "companySize"])),
  };
}

const LINKEDIN_NETHERLANDS_GEO_ID = "102890719";

/**
 * Input for the LinkedIn jobs actor: one LinkedIn job search URL per role in
 * the Netherlands, posted in the last `days` days.
 */
export function buildLinkedinJobsInput({ days, limit, roles = [...TECH_SEARCH_ROLES] }: { days: number; limit: number; roles?: string[] }) {
  const urls = roles.map((role) => {
    const url = new URL("https://www.linkedin.com/jobs/search/");
    url.searchParams.set("keywords", role);
    url.searchParams.set("location", "Netherlands");
    url.searchParams.set("geoId", LINKEDIN_NETHERLANDS_GEO_ID);
    url.searchParams.set("f_TPR", `r${Math.max(1, days) * 86_400}`);
    return url.toString();
  });
  return { urls, count: limit, scrapeCompany: true };
}

/** Input for the Indeed jobs actor: one nl.indeed.com search URL per role. */
export function buildIndeedJobsInput({ days, limit, roles = [...TECH_SEARCH_ROLES] }: { days: number; limit: number; roles?: string[] }) {
  const startUrls = roles.map((role) => {
    const url = new URL("https://nl.indeed.com/jobs");
    url.searchParams.set("q", role);
    url.searchParams.set("l", "Nederland");
    // Indeed only knows 1, 3, 7 and 14 days.
    url.searchParams.set("fromage", String([1, 3, 7, 14].find((d) => d >= days) ?? 14));
    return { url: url.toString() };
  });
  return { startUrls, country: "NL", maxItems: limit, parseCompanyDetails: true, saveOnlyUniqueItems: true, followApplyRedirects: true };
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

export type ScrapedPerson = {
  firstName: string | null;
  lastName: string | null;
  title: string | null;
  linkedinUrl: string | null;
  /** Normalised company domain from the item, or null when the actor does not give one. */
  companyDomain: string | null;
};

/** Input for the people actor: decision makers at one company, by domain and/or LinkedIn page. */
export function buildPeopleSearchInput({
  domain,
  companyLinkedinUrl,
  titles,
  limit,
}: {
  domain: string | null;
  companyLinkedinUrl: string | null;
  titles: string[];
  limit: number;
}) {
  const linkedin = companyLinkedinUrl ? `https://www.${normalizeLinkedin(companyLinkedinUrl)}` : null;
  return {
    // code_crafter~leads-finder
    ...(domain ? { company_domain: [domain] } : {}),
    contact_job_title: titles,
    fetch_count: limit,
    // harvestapi~linkedin-company-employees
    ...(linkedin ? { companies: [linkedin] } : {}),
    jobTitles: titles,
    maxItems: limit,
  };
}

/** People actor item -> ScrapedPerson. */
export function mapPerson(item: ApifyItem): ScrapedPerson {
  let firstName = pickString(item, ["first_name", "firstName", "firstname"]);
  let lastName = pickString(item, ["last_name", "lastName", "lastname"]);
  if (!firstName && !lastName) {
    const split = splitName(pickString(item, ["full_name", "fullName", "name"]));
    firstName = split.first;
    lastName = split.last;
  }
  const profile = normalizeLinkedin(
    pickString(item, ["linkedin", "linkedinUrl", "linkedin_url", "profileUrl", "url", "publicProfileUrl"]),
  );
  return {
    firstName,
    lastName,
    title: pickString(item, ["job_title", "title", "jobTitle", "position", "currentPosition.0.position", "headline"]),
    linkedinUrl: profile && profile.startsWith("linkedin.com/in/") ? profile : null,
    companyDomain: companyDomainFrom(
      pickString(item, ["company_domain", "companyDomain", "company_website", "companyWebsite", "organization.website_url", "currentPosition.0.companyWebsite"]),
    ),
  };
}
