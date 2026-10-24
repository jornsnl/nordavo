/**
 * Hard rule 12: an anonymous profile contains no name, photo, contact details
 * or traceable employers. Claude only gets the fields it needs, with
 * identifiers redacted, and every generated profile goes through
 * findIdentifierLeaks before it is stored. Pure functions, unit tested.
 */

export type CandidateIdentifiers = {
  nameParts: string[];
  email: string | null;
  phone: string | null;
  employers: string[];
  /** Words that are also skills; never treated as a name part (a first name "Ruby"). */
  skills?: string[];
};

export type IdentifierLeak = {
  kind: "naam" | "e-mail" | "telefoon" | "werkgever" | "link";
  /** The matched text, for staff only. Never log or store it. */
  match: string;
};

const LEGAL_SUFFIXES = new Set([
  "pvt", "private", "ltd", "limited", "llp", "llc", "inc", "incorporated", "corp", "corporation",
  "co", "company", "bv", "b.v.", "nv", "n.v.", "gmbh", "ag", "sa", "plc", "group", "groep",
  "holding", "holdings", "india", "international", "global", "the",
]);

/** Generic words that never identify an employer on their own. */
const GENERIC_WORDS = new Set([
  "technologies", "technology", "tech", "solutions", "services", "software", "systems", "consulting",
  "consultancy", "labs", "digital", "infotech", "it", "data", "analytics", "freelance", "freelancer",
  "self", "employed", "zelfstandig", "startup", "agency", "studio", "bank", "web", "cloud", "ai",
  "media", "networks", "india", "bangalore", "bengaluru", "remote",
]);

/** Lowercase, strip accents, collapse whitespace. */
export function foldText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whole word or phrase match, ignoring case and accents. */
function containsPhrase(foldedText: string, phrase: string) {
  const folded = foldText(phrase);
  if (!folded) return false;
  return new RegExp(`(^|[^a-z0-9])${escapeRegExp(folded)}($|[^a-z0-9])`).test(foldedText);
}

/**
 * Search terms for one employer: the full name, and the distinctive core
 * without legal suffixes ("Infosys Limited" -> "infosys", "Tata Consultancy
 * Services" -> "tata consultancy services" and "tata").
 */
export function employerTerms(employer: string): string[] {
  const words = foldText(employer)
    .replace(/[(),]/g, " ")
    .split(" ")
    .filter(Boolean);
  const core = words.filter((w) => !LEGAL_SUFFIXES.has(w));
  const terms = new Set<string>();
  const full = words.join(" ");
  if (full.length >= 3 && !GENERIC_WORDS.has(full)) terms.add(full);
  const coreText = core.join(" ");
  if (coreText.length >= 3 && !GENERIC_WORDS.has(coreText)) terms.add(coreText);
  const distinctive = core.filter((w) => !GENERIC_WORDS.has(w));
  if (distinctive.length > 0) {
    const first = distinctive[0];
    if (first.length >= 3) terms.add(first);
  }
  return [...terms];
}

function phoneDigits(value: string) {
  return value.replace(/\D/g, "");
}

/** A phone-like run of digits: 9 or more digits and not a year range like "2015 - 2019". */
function looksLikePhone(found: string) {
  if (/^(19|20)\d{2}\s*[-–/]\s*(19|20)\d{2}$/.test(found.trim())) return false;
  return phoneDigits(found).length >= 9;
}

const EMAIL_PATTERN = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const URL_PATTERN = /\b(?:https?:\/\/|www\.)\S+|\blinkedin\.com\/\S+|\bgithub\.com\/\S+/gi;
/** Seven or more digits, optionally separated by spaces, dashes, dots or brackets. */
const PHONE_PATTERN = /\+?\d[\d\s().-]{6,}\d/g;

function nameTerms(ids: CandidateIdentifiers) {
  const skills = new Set((ids.skills ?? []).map(foldText));
  return ids.nameParts
    .map((part) => part.trim())
    .filter((part) => part.length >= 3 && !skills.has(foldText(part)));
}

/** Every identifier that appears in `text`. Empty means the text is clean. */
export function findIdentifierLeaks(text: string, ids: CandidateIdentifiers): IdentifierLeak[] {
  const leaks: IdentifierLeak[] = [];
  const folded = foldText(text);

  for (const part of nameTerms(ids)) {
    if (containsPhrase(folded, part)) leaks.push({ kind: "naam", match: part });
  }

  if (ids.email) {
    const email = foldText(ids.email);
    const local = email.split("@")[0] ?? "";
    if (folded.includes(email) || (local.length >= 4 && containsPhrase(folded, local))) {
      leaks.push({ kind: "e-mail", match: ids.email });
    }
  }
  for (const found of text.match(EMAIL_PATTERN) ?? []) leaks.push({ kind: "e-mail", match: found });

  const digitsInText = phoneDigits(text);
  if (ids.phone) {
    const digits = phoneDigits(ids.phone);
    // Compare the last 8 digits, so +91 98450 12345 matches 9845012345.
    const tail = digits.slice(-8);
    if (tail.length >= 7 && digitsInText.includes(tail)) leaks.push({ kind: "telefoon", match: ids.phone });
  }
  for (const found of text.match(PHONE_PATTERN) ?? []) {
    if (looksLikePhone(found)) leaks.push({ kind: "telefoon", match: found.trim() });
  }

  for (const found of text.match(URL_PATTERN) ?? []) leaks.push({ kind: "link", match: found });

  for (const employer of ids.employers) {
    for (const term of employerTerms(employer)) {
      if (containsPhrase(folded, term)) {
        leaks.push({ kind: "werkgever", match: employer });
        break;
      }
    }
  }

  const seen = new Set<string>();
  return leaks.filter((leak) => {
    const key = `${leak.kind}:${foldText(leak.match)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Remove identifiers from free text (CV text, summary) before it goes to
 * Claude, so the model never sees the name, contact details or employers.
 */
export function redactIdentifiers(text: string, ids: CandidateIdentifiers): string {
  let result = text.replace(EMAIL_PATTERN, "[e-mail]").replace(URL_PATTERN, "[link]");
  result = result.replace(PHONE_PATTERN, (found) => (looksLikePhone(found) ? "[telefoon]" : found));

  const replacePhrase = (phrase: string, label: string) => {
    if (phrase.trim().length < 3) return;
    const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(phrase)}(?=$|[^\\p{L}\\p{N}])`, "giu");
    result = result.replace(pattern, (_m, before: string) => `${before}${label}`);
  };

  // Longest first, so "Tata Consultancy Services" goes before "Tata".
  const employerPhrases = ids.employers
    .flatMap((employer) => [employer, ...employerTerms(employer)])
    .sort((a, b) => b.length - a.length);
  for (const phrase of employerPhrases) replacePhrase(phrase, "[werkgever]");
  for (const part of nameTerms(ids).sort((a, b) => b.length - a.length)) replacePhrase(part, "[naam]");
  if (ids.email) replacePhrase(ids.email.split("@")[0] ?? "", "[e-mail]");
  return result;
}

/** All string values in a JSON-like value, joined, for the leak check. */
export function collectText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(collectText).join("\n");
  if (value && typeof value === "object") return Object.values(value).map(collectText).join("\n");
  return "";
}

/** Dutch, human message for a rejected profile. Mentions kinds only, never the values. */
export function leakMessage(leaks: IdentifierLeak[]) {
  const kinds = [...new Set(leaks.map((l) => l.kind))];
  return `Profiel afgekeurd door de anonimiteitscheck: het bevat nog ${kinds.join(", ")}. Maak het profiel opnieuw.`;
}

/** File and display code for a profile, never derived from candidate data. */
export function profileCode(profileId: string) {
  return `NV-${profileId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
}
