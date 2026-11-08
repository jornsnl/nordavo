import type { CandidateSource } from "@/lib/database.types";
import { normalizeLinkedin } from "@/lib/gtm/normalize";

/**
 * Candidate import (recruitment brief 2.6.1 and 2.18): CSV exports from
 * LinkedIn, Naukri, Manatal or an existing hiring sheet. Header detection
 * with a preset per source, a suggested column mapping the user can change,
 * row normalisation and the dedupe keys (email, phone, LinkedIn URL).
 * Pure functions, shared by the wizard (preview) and the server import.
 */

/** One CSV row: column name -> cell value. */
export type CandidateCsvRow = Record<string, string>;

export const candidateImportFields = [
  "full_name",
  "first_name",
  "last_name",
  "email",
  "phone",
  "linkedin_url",
  "location",
  "current_title",
  "current_company",
  "years_experience",
  "skills",
  "summary",
  "video_url",
] as const;

export type CandidateImportField = (typeof candidateImportFields)[number];

/** Which CSV column holds which field. Values are column names from the file. */
export type CandidateImportMapping = Partial<Record<CandidateImportField, string>>;

export const candidateFieldLabels: Record<CandidateImportField, string> = {
  full_name: "Full name",
  first_name: "First name",
  last_name: "Last name",
  email: "Email",
  phone: "Phone",
  linkedin_url: "LinkedIn URL",
  location: "Location",
  current_title: "Current title",
  current_company: "Current company",
  years_experience: "Years of experience",
  skills: "Skills",
  summary: "Summary or headline",
  video_url: "Video link",
};

export type ImportPresetId = "linkedin" | "naukri" | "manatal" | "sheet";

type Preset = {
  id: ImportPresetId;
  label: string;
  /** The source the batch gets by default. */
  source: CandidateSource;
  /** Headers typical for this export, normalised (see normalizeHeader). */
  signature: string[];
  /** Exact (normalised) header names per field for this export. */
  fields: Partial<Record<CandidateImportField, string[]>>;
};

export const importPresets: Preset[] = [
  {
    id: "linkedin",
    label: "LinkedIn export",
    source: "linkedin",
    signature: ["first name", "last name", "headline", "profile url", "linkedin profile", "public profile url", "current company", "current title", "linkedin url"],
    fields: {
      first_name: ["first name"],
      last_name: ["last name"],
      full_name: ["name", "full name", "candidate name"],
      email: ["email", "email address", "e mail address", "emails"],
      phone: ["phone", "phone number", "phones", "mobile"],
      linkedin_url: ["profile url", "public profile url", "linkedin profile", "linkedin url", "profile link", "linkedin"],
      location: ["location", "geo location", "city"],
      current_title: ["current title", "title", "job title", "current position"],
      current_company: ["current company", "company", "company name"],
      summary: ["headline", "summary"],
      skills: ["skills", "top skills"],
      years_experience: ["years of experience", "total experience"],
    },
  },
  {
    id: "naukri",
    label: "Naukri export",
    source: "naukri",
    signature: ["email id", "phone no", "mobile no", "total experience", "current designation", "key skills", "resume headline", "current location", "notice period", "annual salary", "preferred locations"],
    fields: {
      full_name: ["name", "candidate name", "full name"],
      email: ["email id", "email", "email address"],
      phone: ["phone no", "mobile no", "mobile number", "phone number", "contact number", "phone"],
      location: ["current location", "location", "city"],
      current_title: ["current designation", "designation", "current role"],
      current_company: ["current company", "current employer", "company"],
      years_experience: ["total experience", "experience", "work experience", "total experience years"],
      skills: ["key skills", "skills", "it skills"],
      summary: ["resume headline", "headline", "summary", "profile summary"],
      linkedin_url: ["linkedin", "linkedin url", "linkedin profile"],
    },
  },
  {
    id: "manatal",
    label: "Manatal export",
    source: "manatal",
    signature: ["full name", "current position", "current company", "phone number", "years of experience", "candidate id", "source", "owner", "tags"],
    fields: {
      full_name: ["full name", "name", "candidate name"],
      first_name: ["first name"],
      last_name: ["last name"],
      email: ["email", "email address"],
      phone: ["phone number", "phone", "mobile"],
      linkedin_url: ["linkedin", "linkedin url", "linkedin profile", "social media linkedin"],
      location: ["location", "address", "city"],
      current_title: ["current position", "position", "job title", "title"],
      current_company: ["current company", "company"],
      years_experience: ["years of experience", "experience", "total experience"],
      skills: ["skills", "tags"],
      summary: ["description", "summary", "headline"],
    },
  },
  {
    id: "sheet",
    label: "Hiring sheet (Google Sheets or Excel as CSV)",
    source: "other",
    signature: [],
    fields: {
      full_name: ["candidate name", "name", "full name", "naam", "candidate"],
      first_name: ["first name", "voornaam"],
      last_name: ["last name", "achternaam", "surname"],
      email: ["email id", "email", "email address", "e mail", "mail", "emailadres"],
      phone: ["phone number", "phone", "mobile", "mobile number", "contact number", "telefoon", "whatsapp"],
      linkedin_url: ["linkedin url", "linkedin", "linkedin profile", "linkedin link"],
      location: ["location", "current location", "city", "woonplaats"],
      current_title: ["current title", "current designation", "designation", "role", "title", "job title"],
      current_company: ["current company", "company", "current employer", "employer"],
      years_experience: ["total experience years", "total experience", "years of experience", "experience", "years", "experience years"],
      skills: ["skills", "technologies worked with professional", "technologies", "tech stack", "stack", "tools"],
      summary: ["summary", "notes", "remarks", "comments", "headline"],
      video_url: ["video", "video link", "video url", "intro video", "video introduction"],
    },
  },
];

export function presetById(id: string | null | undefined): Preset {
  return importPresets.find((p) => p.id === id) ?? importPresets[importPresets.length - 1];
}

/** "Email ID" -> "email id", "Total Experience (Years)" -> "total experience years". */
export function normalizeHeader(header: string): string {
  return header
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** The export the headers most look like; a hiring sheet when nothing stands out. */
export function detectPreset(headers: string[]): ImportPresetId {
  const keys = new Set(headers.map(normalizeHeader));
  let best: { id: ImportPresetId; hits: number } = { id: "sheet", hits: 0 };
  for (const preset of importPresets) {
    const hits = preset.signature.filter((s) => keys.has(s)).length;
    if (hits > best.hits) best = { id: preset.id, hits };
  }
  return best.hits >= 2 ? best.id : "sheet";
}

/** Looser patterns, used after the exact names of the preset. */
const PATTERNS: [CandidateImportField, RegExp][] = [
  ["linkedin_url", /linkedin|profile url/],
  ["email", /\be ?mail/],
  ["phone", /phone|mobile|contact (no|number)|whatsapp|\btel\b/],
  ["video_url", /video/],
  ["years_experience", /experience|\byears?\b|\byrs\b/],
  ["skills", /skill|technolog|stack|tools/],
  ["first_name", /first ?name|given name/],
  ["last_name", /last ?name|surname|family name/],
  ["current_company", /company|employer|organi[sz]ation/],
  ["current_title", /designation|title|position|role/],
  ["location", /location|city/],
  ["full_name", /\bname\b/],
];

/** Suggested mapping: the preset's names first, then any preset, then patterns. */
export function guessCandidateMapping(headers: string[], presetId: ImportPresetId = detectPreset(headers)): CandidateImportMapping {
  const mapping: CandidateImportMapping = {};
  const used = new Set<string>();
  const normalized = headers.map((header) => ({ header, key: normalizeHeader(header) }));
  const order = [presetById(presetId), ...importPresets.filter((p) => p.id !== presetId)];

  for (const preset of order) {
    for (const field of candidateImportFields) {
      if (mapping[field]) continue;
      for (const name of preset.fields[field] ?? []) {
        const hit = normalized.find(({ header, key }) => key === name && !used.has(header));
        if (hit) {
          mapping[field] = hit.header;
          used.add(hit.header);
          break;
        }
      }
    }
  }
  for (const [field, pattern] of PATTERNS) {
    if (mapping[field]) continue;
    const hit = normalized.find(({ header, key }) => pattern.test(key) && !used.has(header));
    if (hit) {
      mapping[field] = hit.header;
      used.add(hit.header);
    }
  }
  // A full name column makes separate first/last guesses from patterns unlikely to help.
  return mapping;
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export type CandidateDraft = {
  full_name: string;
  email: string | null;
  phone: string | null;
  linkedin_url: string | null;
  location: string | null;
  current_title: string | null;
  employers: string[];
  years_experience: number | null;
  skills: string[];
  summary: string | null;
  video_url: string | null;
};

export type DraftResult = { ok: true; draft: CandidateDraft } | { ok: false; reason: string };

function cellOf(row: CandidateCsvRow, mapping: CandidateImportMapping, field: CandidateImportField) {
  const column = mapping[field];
  return column ? (row[column] ?? "").replace(/\s+/g, " ").trim() : "";
}

/** Lowercased email, the first one when a cell holds several. */
export function cleanEmail(value: string | null | undefined): string | null {
  const match = (value ?? "").toLowerCase().match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/);
  return match ? match[0] : null;
}

/** The first phone number in a cell, digits and a leading + kept. Null below 8 digits. */
export function cleanPhone(value: string | null | undefined): string | null {
  const first = (value ?? "").split(/[,;/|]/)[0] ?? "";
  const plus = first.trim().startsWith("+");
  const digits = first.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return null;
  return `${plus ? "+" : ""}${digits}`;
}

/** Dedupe key for a phone number: the last 10 digits (so +91 98450 12345 equals 09845012345). */
export function phoneKey(value: string | null | undefined): string | null {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits.length >= 8 ? digits.slice(-10) : null;
}

/** linkedin.com/in/... only; anything else is not a LinkedIn profile. */
export function cleanLinkedin(value: string | null | undefined): string | null {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  const normalized = normalizeLinkedin(raw);
  if (!normalized || !normalized.startsWith("linkedin.com/")) return null;
  return `https://www.${normalized}`;
}

function cleanUrl(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v.slice(0, 500);
  if (/^[a-z0-9.-]+\.[a-z]{2,}\//i.test(v)) return `https://${v}`.slice(0, 500);
  return null;
}

/**
 * "4 Year(s) 6 Month(s)" -> 4, "4.5" -> 4, "6+ yrs" -> 6, "18 months" -> 1.
 * Whole years, rounded down; null when there is no number.
 */
export function parseYears(value: string | null | undefined): number | null {
  const text = (value ?? "").toLowerCase().replace(",", ".");
  if (!text.trim()) return null;
  const years = text.match(/(\d+(?:\.\d+)?)\s*(?:\+\s*)?(?:years?|yrs?|y\b|year\(s\))/);
  const months = text.match(/(\d+(?:\.\d+)?)\s*(?:months?|mos?|month\(s\))/);
  let total: number | null = null;
  if (years) total = Number(years[1]);
  if (months) total = (total ?? 0) + Number(months[1]) / 12;
  if (total === null) {
    const plain = text.match(/^\s*(\d+(?:\.\d+)?)\s*\+?\s*$/);
    if (plain) total = Number(plain[1]);
  }
  if (total === null || !Number.isFinite(total) || total < 0 || total > 60) return null;
  return Math.floor(total);
}

/** "Python, SQL; dbt | Airflow" -> ["Python", "SQL", "dbt", "Airflow"], without duplicates. */
export function splitSkills(value: string | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of (value ?? "").split(/[,;|\n•·]+/)) {
    const skill = raw.trim().replace(/^[-*]\s*/, "").slice(0, 60);
    if (!skill || seen.has(skill.toLowerCase())) continue;
    seen.add(skill.toLowerCase());
    out.push(skill);
    if (out.length >= 60) break;
  }
  return out;
}

function titleCaseIfShouting(name: string) {
  if (name !== name.toUpperCase()) return name;
  return name.toLowerCase().replace(/(^|[\s'-])\p{L}/gu, (m) => m.toUpperCase());
}

/** One CSV row as a candidate, or the reason it is skipped. */
export function draftFromRow(row: CandidateCsvRow, mapping: CandidateImportMapping): DraftResult {
  const first = cellOf(row, mapping, "first_name");
  const last = cellOf(row, mapping, "last_name");
  const name = titleCaseIfShouting(cellOf(row, mapping, "full_name") || [first, last].filter(Boolean).join(" ")).slice(0, 200);
  const email = cleanEmail(cellOf(row, mapping, "email"));
  const phone = cleanPhone(cellOf(row, mapping, "phone"));
  const linkedin = cleanLinkedin(cellOf(row, mapping, "linkedin_url"));

  if (name.length < 2) {
    if (!email && !phone && !linkedin) return { ok: false, reason: "Empty row: no name, email, phone or LinkedIn" };
    return { ok: false, reason: "No name" };
  }
  const company = cellOf(row, mapping, "current_company").slice(0, 200);
  return {
    ok: true,
    draft: {
      full_name: name,
      email,
      phone,
      linkedin_url: linkedin,
      location: cellOf(row, mapping, "location").slice(0, 120) || null,
      current_title: cellOf(row, mapping, "current_title").slice(0, 200) || null,
      employers: company ? [company] : [],
      years_experience: parseYears(cellOf(row, mapping, "years_experience")),
      skills: splitSkills(mapping.skills ? (row[mapping.skills] ?? "") : ""),
      summary: (mapping.summary ? (row[mapping.summary] ?? "").trim() : "").slice(0, 5000) || null,
      video_url: cleanUrl(cellOf(row, mapping, "video_url")),
    },
  };
}

// ---------------------------------------------------------------------------
// Dedupe
// ---------------------------------------------------------------------------

export type DedupeKeys = { email: string | null; phone: string | null; linkedin: string | null };

export function dedupeKeys(c: { email: string | null; phone: string | null; linkedin_url: string | null }): DedupeKeys {
  return {
    email: cleanEmail(c.email),
    phone: phoneKey(c.phone),
    linkedin: c.linkedin_url ? normalizeLinkedin(c.linkedin_url) : null,
  };
}

export type ExistingCandidate = { id: string; email: string | null; phone: string | null; linkedin_url: string | null };

/** Lookup of existing candidates by email, phone key and LinkedIn. */
export class CandidateIndex {
  private byEmail = new Map<string, string>();
  private byPhone = new Map<string, string>();
  private byLinkedin = new Map<string, string>();

  constructor(existing: ExistingCandidate[] = []) {
    for (const c of existing) this.add(c.id, dedupeKeys(c));
  }

  add(id: string, keys: DedupeKeys) {
    if (keys.email && !this.byEmail.has(keys.email)) this.byEmail.set(keys.email, id);
    if (keys.phone && !this.byPhone.has(keys.phone)) this.byPhone.set(keys.phone, id);
    if (keys.linkedin && !this.byLinkedin.has(keys.linkedin)) this.byLinkedin.set(keys.linkedin, id);
  }

  /** The matching candidate id and on what it matched; email first, then LinkedIn, then phone. */
  find(keys: DedupeKeys): { id: string; on: "email" | "linkedin" | "phone" } | null {
    if (keys.email && this.byEmail.has(keys.email)) return { id: this.byEmail.get(keys.email)!, on: "email" };
    if (keys.linkedin && this.byLinkedin.has(keys.linkedin)) return { id: this.byLinkedin.get(keys.linkedin)!, on: "linkedin" };
    if (keys.phone && this.byPhone.has(keys.phone)) return { id: this.byPhone.get(keys.phone)!, on: "phone" };
    return null;
  }
}

type FillSource = {
  email?: string | null;
  phone?: string | null;
  linkedin_url?: string | null;
  current_title?: string | null;
  years_experience?: number | null;
  skills?: string[];
  summary?: string | null;
  video_url?: string | null;
  employers?: string[];
};

export type FillUpdate = {
  email?: string;
  phone?: string;
  linkedin_url?: string;
  current_title?: string;
  years_experience?: number;
  skills?: string[];
  summary?: string;
  video_url?: string;
  employers?: string[];
};

/** Fields of an existing candidate that are still empty and the import can fill (never overwrite). */
export function fillEmpty(
  existing: {
    email: string | null;
    phone: string | null;
    linkedin_url: string | null;
    current_title: string | null;
    years_experience: number | null;
    skills: string[];
    summary: string | null;
    video_url: string | null;
    employers: string[];
  },
  draft: FillSource,
) {
  const update: FillUpdate = {};
  if (!existing.email && draft.email) update.email = draft.email;
  if (!existing.phone && draft.phone) update.phone = draft.phone;
  if (!existing.linkedin_url && draft.linkedin_url) update.linkedin_url = draft.linkedin_url;
  if (!existing.current_title && draft.current_title) update.current_title = draft.current_title;
  if (existing.years_experience === null && draft.years_experience != null) update.years_experience = draft.years_experience;
  if (existing.skills.length === 0 && draft.skills && draft.skills.length > 0) update.skills = draft.skills;
  if (!existing.summary && draft.summary) update.summary = draft.summary;
  if (!existing.video_url && draft.video_url) update.video_url = draft.video_url;
  if (existing.employers.length === 0 && draft.employers && draft.employers.length > 0) update.employers = draft.employers;
  return update;
}
