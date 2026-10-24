/**
 * Pure helpers for the ingest jobs (S1 to S3): which vacancies count as a
 * tech role, the extra signal rules from S1 (lang_open, meerdere_rollen,
 * remote_extern), employee counts from scraped text and the decision maker
 * tiers from briefing section 3. No I/O here, so everything is unit tested.
 */

/** Days after which an open vacancy becomes a `lang_open` signal (S1). */
export const LONG_OPEN_DAYS = 60;
/** Window in which distinct open tech roles count towards `meerdere_rollen`. */
export const MULTIPLE_ROLES_WINDOW_DAYS = 60;
/** Distinct open tech roles needed for `meerdere_rollen`. */
export const MULTIPLE_ROLES_MIN = 2;

/**
 * The roles Nordavo places (briefing section 1), as search terms for the job
 * scrapers. Dutch and English titles are both common on Dutch job boards.
 */
export const TECH_SEARCH_ROLES = [
  "backend developer",
  "frontend developer",
  "full stack developer",
  "data engineer",
  "BI developer",
  "Power BI",
  "data analyst",
  "data scientist",
  "machine learning engineer",
] as const;

const TECH_PATTERNS: RegExp[] = [
  /\b(back[\s-]?end|front[\s-]?end|full[\s-]?stack)\b/,
  /\b(software|web|app|mobile|ios|android|php|java|python|\.net|dotnet|c#|node(\.?js)?|react|angular|vue|typescript|javascript|golang|go|ruby|rails|laravel|symfony|magento|scala|kotlin|rust|django|cloud|platform|data|ml|ai|machine learning|bi|analytics)\s+(developer|ontwikkelaar|engineer|programmeur|architect)\b/,
  /\b(developer|ontwikkelaar|programmeur|software engineer|softwareontwikkelaar|software ontwikkelaar)\b/,
  /\bdata\s+(engineer|analist|analyst|scientist|architect)\b/,
  /\b(bi|business intelligence)\s+(developer|specialist|consultant|analist|analyst|engineer)\b/,
  /\bpower\s?bi\b/,
  /\b(machine learning|ml|ai)\s+(engineer|specialist|developer)\b/,
  /\bmlops\b/,
  /\banalytics engineer\b/,
];

/** Titles that look technical but are not roles Nordavo places. */
const NOT_TECH_PATTERNS: RegExp[] = [
  /\b(stage|stagiair|stagiaire|intern|internship|afstudeer\w*|werkstudent|bijbaan|vrijwilliger)\b/,
  /\b(sales|account manager|accountmanager|business developer|business development|recruiter|recruitment|marketeer|marketing)\b/,
  /\b(werktuigbouw\w*|mechanical|elektro\w*|electrical|process engineer|procesengineer|field service|service engineer|servicemonteur|monteur|installatie\w*|civil|civiele|constructeur|hardware)\b/,
  /\b(docent|teacher|leraar|trainer)\b/,
];

function clean(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** True when a vacancy title is one of the developer or data roles from briefing section 1. */
export function isTechRole(title: string | null | undefined): boolean {
  const text = clean(title);
  if (!text) return false;
  if (NOT_TECH_PATTERNS.some((pattern) => pattern.test(text))) return false;
  return TECH_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * A stable key for "the same role", so the same vacancy posted on LinkedIn and
 * Indeed, or with a different seniority or gender suffix, counts once:
 * "Senior Backend Developer (m/v/x) - Utrecht" -> "backend developer".
 */
export function techRoleKey(title: string | null | undefined): string {
  return clean(title)
    .replace(/\((m|v|x|f|d|h)(\s*[/|,]\s*(m|v|x|f|d|h))*\)/g, " ")
    .replace(/\b(m|v|x|f|d|h)\s*\/\s*(m|v|x|f|d|h)(\s*\/\s*(m|v|x|f|d|h))?\b/g, " ")
    .replace(/\s[-|–—,:]\s.*$/, " ")
    .replace(/\b(junior|medior|mid[\s-]?level|senior|sr\.?|jr\.?|lead|principal|staff|ervaren|i{1,3}|parttime|part-time|fulltime|full-time|hybride|hybrid|remote)\b/g, " ")
    .replace(/[^a-z0-9#.+ ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Number of distinct open tech roles among the given vacancy titles. */
export function countDistinctTechRoles(titles: (string | null | undefined)[]): number {
  const keys = new Set<string>();
  for (const title of titles) {
    if (!isTechRole(title)) continue;
    const key = techRoleKey(title);
    if (key) keys.add(key);
  }
  return keys.size;
}

const REMOTE_PATTERNS: RegExp[] = [
  /\bremote\b/,
  /\bvolledig op afstand\b/,
  /\bop afstand werken\b/,
  /\bwork from anywhere\b/,
];
const EXTERNAL_TEAM_PATTERNS: RegExp[] = [
  /\bextern(e)?\s+(team|teams|ontwikkelteam|developers|ontwikkelaars|partner|partners|leverancier|bureau)\b/,
  /\bexternal\s+(team|teams|developers|partner|partners|agency|vendor)\b/,
  /\b(offshore|nearshore|outsourc\w*|uitbested\w*)\b/,
  /\bdistributed team\b/,
  /\bteam(s)? (in|across) (india|poland|polen|portugal|oekraïne|ukraine|roemenië|romania)\b/,
];

/** S1 `remote_extern`: the vacancy text mentions remote work or an external team. */
export function mentionsRemoteOrExternal(text: string | null | undefined): boolean {
  const value = clean(text);
  if (!value) return false;
  return REMOTE_PATTERNS.some((p) => p.test(value)) || EXTERNAL_TEAM_PATTERNS.some((p) => p.test(value));
}

/** Days between an ISO date and now, or null when the date does not parse. */
export function daysSince(date: string | null | undefined, now: Date = new Date()): number | null {
  if (!date) return null;
  const time = Date.parse(date);
  if (Number.isNaN(time)) return null;
  return Math.floor((now.getTime() - time) / 86_400_000);
}

/**
 * S1 `lang_open`: open for more than 60 days, by the posted date on the job
 * board or, when that is missing or newer (reposts), our own first_seen_at.
 */
export function isLongOpen(
  input: { postedAt?: string | null; firstSeenAt?: string | null },
  now: Date = new Date(),
  days: number = LONG_OPEN_DAYS,
): boolean {
  const ages = [daysSince(input.postedAt, now), daysSince(input.firstSeenAt, now)].filter(
    (age): age is number => age !== null,
  );
  return ages.some((age) => age > days);
}

/**
 * Employee count from scraped or sheet text: "45" -> 45, "11-50" -> 31 (the
 * middle of a range, so "1-10" does not count as under 5), "201-500 employees"
 * -> 351, "50+" -> 50, "1.200" -> 1200. Null when there is no number.
 */
export function parseEmployeeCount(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
  if (typeof value !== "string") return null;
  const text = value.replace(/(\d)[.,](\d{3})\b/g, "$1$2");
  const numbers = (text.match(/\d+/g) ?? []).map(Number).filter((n) => Number.isFinite(n));
  if (numbers.length === 0) return null;
  if (numbers.length >= 2 && /\d\s*(-|–|tot|to|t\/m)\s*\d/.test(text)) {
    return Math.round((numbers[0] + numbers[1]) / 2);
  }
  return numbers[0];
}

// ---------------------------------------------------------------------------
// Decision makers (S3), briefing section 3
// ---------------------------------------------------------------------------

/** Titles sent to the people search, best tier first. */
export const DECISION_MAKER_TITLES = {
  1: ["CTO", "Chief Technology Officer", "Head of Engineering", "Head of Data", "VP Engineering", "Engineering Manager"],
  2: ["Owner", "Founder", "Co-founder", "Eigenaar", "Directeur", "CEO", "Managing Director"],
  3: ["Recruiter", "HR Manager", "Talent Acquisition"],
} as const;

export const ALL_DECISION_MAKER_TITLES: string[] = [
  ...DECISION_MAKER_TITLES[1],
  ...DECISION_MAKER_TITLES[2],
  ...DECISION_MAKER_TITLES[3],
];

const TIER_1: RegExp[] = [
  /\bcto\b/,
  /\bchief (technology|technical|data) officer\b/,
  /\bhead of (engineering|data|development|software|technology|tech)\b/,
  /\bv\.?p\.? (of )?(engineering|technology)\b/,
  /\bvice president (of )?engineering\b/,
  /\bengineering manager\b/,
  /\b(director|directeur) (of )?(engineering|technology|data)\b/,
  /\btechnisch directeur\b/,
  /\bhoofd (ontwikkeling|engineering|data|software\w*)\b/,
];
const TIER_3: RegExp[] = [/\brecruit\w*/, /\bhr\b/, /\bhuman resources\b/, /\btalent\b/, /\bp&o\b/];
const TIER_2: RegExp[] = [
  /\bowner\b/,
  /\b(co[\s-]?)?founder\b/,
  /\boprichter\b/,
  /\beigenaar\b/,
  /\bdirecteur\b/,
  /\bceo\b/,
  /\bchief executive\b/,
  /\bmanaging director\b/,
  /\bmanaging partner\b/,
];

/** Decision maker tier for a job title, or null when the title is not a decision maker. */
export function tierForTitle(title: string | null | undefined): 1 | 2 | 3 | null {
  const text = clean(title);
  if (!text) return null;
  if (TIER_1.some((p) => p.test(text))) return 1;
  // HR before owner/director, so "HR Directeur" is tier 3 and not tier 2.
  if (TIER_3.some((p) => p.test(text))) return 3;
  if (TIER_2.some((p) => p.test(text))) return 2;
  return null;
}

/** A person from the people search (see ScrapedPerson in integrations/apify). */
export type PersonCandidate = {
  firstName: string | null;
  lastName: string | null;
  title: string | null;
  linkedinUrl: string | null;
  companyDomain: string | null;
};

export type RankedPerson<T extends PersonCandidate = PersonCandidate> = T & { tier: 1 | 2 | 3 };

/**
 * The best `count` people by tier (1 first), only decision makers, only people
 * at this company (an item with another domain is dropped), one per LinkedIn
 * profile or name, and never someone already in `existingLinkedin`.
 */
export function pickDecisionMakers<T extends PersonCandidate>(
  people: T[],
  { count, domain, existingLinkedin = [] }: { count: number; domain: string | null; existingLinkedin?: (string | null)[] },
): RankedPerson<T>[] {
  const seen = new Set(existingLinkedin.filter(Boolean) as string[]);
  const ranked: RankedPerson<T>[] = [];
  for (const person of people) {
    const tier = tierForTitle(person.title);
    if (!tier) continue;
    if (domain && person.companyDomain && person.companyDomain !== domain) continue;
    if (!person.linkedinUrl && !(person.firstName && person.lastName)) continue;
    const key = person.linkedinUrl ?? `${person.firstName} ${person.lastName}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    ranked.push({ ...person, tier });
  }
  // Stable sort: within a tier the actor's own order (usually relevance) is kept.
  return ranked.sort((a, b) => a.tier - b.tier).slice(0, Math.max(0, count));
}
