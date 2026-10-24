import "server-only";
import { z } from "zod";

/**
 * Airtable: the talent pool. Airtable stays the only source for candidate data
 * (hard rule 11). We read it live through the REST API and never copy candidate
 * details into Supabase tables, logs or job meta: `matches` only stores the
 * Airtable record id, score, reason, risks, missing must haves and status.
 *
 * Endpoints (read only, personal access token with scope data.records:read):
 *   GET https://api.airtable.com/v0/{AIRTABLE_BASE_ID}/{AIRTABLE_CANDIDATES_TABLE}
 *       ?pageSize=100&offset=...&filterByFormula=...&view=...   list, paginated
 *   GET https://api.airtable.com/v0/{AIRTABLE_BASE_ID}/{AIRTABLE_CANDIDATES_TABLE}/{recordId}
 *
 * Assumptions to check with the real base (briefing open questions 5 and 8):
 *   - Column names: every name we read lives in AIRTABLE_FIELDS below. Change them
 *     there only. A missing column simply reads as empty.
 *   - CV: may be a PDF attachment instead of text fields. We do not parse PDFs;
 *     matching then relies on skills, experience and the summary fields, and the
 *     UI shows that a CV attachment exists.
 *   - Consent to share an anonymous profile may not exist yet in the Fillout form.
 *     Airtable leaves unchecked checkboxes and empty fields out of the response,
 *     so a missing value reads as `null` (unknown) and staff confirm consent by
 *     hand; an explicit "Nee"/false blocks sending.
 *   - "Pool only": AIRTABLE_POOL_FORMULA limits the list to the pool. It is empty
 *     by default (the whole table is the pool), because a formula with a wrong
 *     column name makes Airtable return 422 for every request.
 *   - Rate limit: 5 requests per second per base; on 429 we wait and retry once.
 */

/** Expected column names in the candidates table. The one place to change them. */
export const AIRTABLE_FIELDS = {
  /** Full name; or use firstName/lastName when the base splits them. */
  name: "Naam",
  firstName: "Voornaam",
  lastName: "Achternaam",
  email: "E-mail",
  phone: "Telefoon",
  /** Multiple select, linked records or comma separated text. */
  skills: "Skills",
  yearsExperience: "Jaren ervaring",
  /** Single select, for example Junior, Medior, Senior, Lead. */
  seniority: "Senioriteit",
  currentTitle: "Huidige functie",
  currentEmployer: "Huidige werkgever",
  /** Comma or newline separated, or multiple select. */
  previousEmployers: "Vorige werkgevers",
  projectTypes: "Type projecten",
  sectors: "Sectoren",
  /** Text version of the CV, when the form or a Make scenario fills it. */
  cvText: "CV tekst",
  summary: "Samenvatting",
  /** Attachment field with the CV PDF (open question 5). */
  cvAttachment: "CV",
  englishLevel: "Engels niveau",
  availability: "Beschikbaarheid",
  location: "Locatie",
  /** Checkbox or Ja/Nee select: consent to share an anonymous profile (open question 8). */
  consent: "Toestemming anoniem profiel",
} as const;

/** Formula that limits the list to the talent pool, for example `{Status} = 'Pool'`. Empty: whole table. */
export const AIRTABLE_POOL_FORMULA = "";

const API_BASE = "https://api.airtable.com/v0";

export function hasAirtable() {
  return Boolean(process.env.AIRTABLE_TOKEN && process.env.AIRTABLE_BASE_ID && process.env.AIRTABLE_CANDIDATES_TABLE);
}

function config() {
  const token = process.env.AIRTABLE_TOKEN;
  const baseId = process.env.AIRTABLE_BASE_ID;
  const table = process.env.AIRTABLE_CANDIDATES_TABLE;
  if (!token || !baseId || !table) {
    throw new Error(
      "Airtable is niet gekoppeld: zet AIRTABLE_TOKEN, AIRTABLE_BASE_ID en AIRTABLE_CANDIDATES_TABLE in de omgevingsvariabelen.",
    );
  }
  return { token, baseId, table };
}

// ---------------------------------------------------------------------------
// Response shapes (loose: extra fields are fine, a changed shape fails loudly)
// ---------------------------------------------------------------------------

export const airtableRecordSchema = z.looseObject({
  id: z.string().min(1),
  createdTime: z.string().optional(),
  fields: z.record(z.string(), z.unknown()),
});

export const airtableListSchema = z.looseObject({
  records: z.array(airtableRecordSchema),
  offset: z.string().optional(),
});

export type AirtableRecord = z.infer<typeof airtableRecordSchema>;

// ---------------------------------------------------------------------------
// Pure mapping
// ---------------------------------------------------------------------------

/** A pool candidate as read live from Airtable. Never persist this object. */
export type PoolCandidate = {
  id: string;
  name: string;
  /** Name parts for the anonymisation check. */
  nameParts: string[];
  email: string | null;
  phone: string | null;
  skills: string[];
  yearsExperience: number | null;
  seniority: string | null;
  currentTitle: string | null;
  /** Current and previous employers, for the anonymisation check only. */
  employers: string[];
  projectTypes: string[];
  sectors: string[];
  cvText: string | null;
  summary: string | null;
  hasCvAttachment: boolean;
  englishLevel: string | null;
  availability: string | null;
  location: string | null;
  /** true: consent given, false: explicitly refused, null: unknown (field missing or empty). */
  consent: boolean | null;
};

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Text from a string, number, select, collaborator or lookup array. */
export function fieldText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts = value.map(fieldText).filter((v): v is string => Boolean(v));
    return parts.length > 0 ? parts.join(", ") : null;
  }
  if (isRecordLike(value)) {
    // Collaborator, AI text ({ state, value }) or a named object.
    for (const key of ["value", "name", "text", "email"]) {
      if (typeof value[key] === "string") return fieldText(value[key]);
    }
  }
  return null;
}

/** A list from a multiple select, lookup array or comma, semicolon or newline separated text. */
export function fieldList(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  const raw = Array.isArray(value) ? value.flatMap((v) => fieldList(v)) : (fieldText(value) ?? "").split(/[,;\n•]+/);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of raw) {
    const trimmed = item.trim();
    const key = trimmed.toLowerCase();
    if (trimmed && !seen.has(key)) {
      seen.add(key);
      result.push(trimmed);
    }
  }
  return result;
}

/** A number from a number field or text like "6 jaar" or "4,5". */
export function fieldNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = fieldText(Array.isArray(value) ? value[0] : value);
  if (!text) return null;
  const match = text.replace(",", ".").match(/\d+(\.\d+)?/);
  return match ? Number(match[0]) : null;
}

/** Checkbox, Ja/Nee select or text. Missing or empty: null (unknown). */
export function fieldConsent(value: unknown): boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value;
  const text = fieldText(value)?.toLowerCase();
  if (!text) return null;
  if (/^(ja|yes|true|y|akkoord|toestemming|gegeven|1)\b/.test(text)) return true;
  if (/^(nee|no|false|n|geen|0)\b/.test(text)) return false;
  return null;
}

export function mapAirtableCandidate(record: AirtableRecord): PoolCandidate {
  const f = record.fields;
  const F = AIRTABLE_FIELDS;
  const first = fieldText(f[F.firstName]);
  const last = fieldText(f[F.lastName]);
  const name = fieldText(f[F.name]) ?? [first, last].filter(Boolean).join(" ");
  const nameParts = [name, first, last]
    .filter((v): v is string => Boolean(v))
    .flatMap((v) => v.split(/[\s.,\-]+/))
    .map((part) => part.trim())
    .filter((part, i, all) => part.length >= 2 && all.indexOf(part) === i);
  const employers = [...fieldList(f[F.currentEmployer]), ...fieldList(f[F.previousEmployers])];
  const attachment = f[F.cvAttachment];

  return {
    id: record.id,
    name: name || "Naam onbekend",
    nameParts,
    email: fieldText(f[F.email]),
    phone: fieldText(f[F.phone]),
    skills: fieldList(f[F.skills]),
    yearsExperience: fieldNumber(f[F.yearsExperience]),
    seniority: fieldText(f[F.seniority]),
    currentTitle: fieldText(f[F.currentTitle]),
    employers: employers.filter((e, i) => employers.findIndex((x) => x.toLowerCase() === e.toLowerCase()) === i),
    projectTypes: fieldList(f[F.projectTypes]),
    sectors: fieldList(f[F.sectors]),
    cvText: fieldText(f[F.cvText]),
    summary: fieldText(f[F.summary]),
    hasCvAttachment: Array.isArray(attachment) && attachment.length > 0,
    englishLevel: fieldText(f[F.englishLevel]),
    availability: fieldText(f[F.availability]),
    location: fieldText(f[F.location]),
    consent: fieldConsent(f[F.consent]),
  };
}

/** filterByFormula that selects records by id, for a batch of live lookups. */
export function recordIdFormula(ids: string[]) {
  const safe = ids.filter((id) => /^rec[a-zA-Z0-9]{3,}$/.test(id));
  if (safe.length === 0) return null;
  return `OR(${safe.map((id) => `RECORD_ID()='${id}'`).join(",")})`;
}

// ---------------------------------------------------------------------------
// HTTP client
// ---------------------------------------------------------------------------

export class AirtableNotFoundError extends Error {}

async function airtableFetch(url: string, attempt = 0): Promise<unknown> {
  const { token } = config();
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (response.status === 429 && attempt === 0) {
    // Airtable asks to wait 30 seconds after hitting the rate limit.
    await new Promise((resolve) => setTimeout(resolve, 30_000));
    return airtableFetch(url, attempt + 1);
  }
  if (!response.ok) {
    let type = "";
    try {
      const body = (await response.json()) as { error?: { type?: string } | string };
      type = typeof body.error === "string" ? body.error : (body.error?.type ?? "");
    } catch {
      // Body is not JSON; the status code is enough.
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error(`Airtable weigert de toegang (${response.status}${type ? `, ${type}` : ""}). Controleer AIRTABLE_TOKEN en de rechten op de base.`);
    }
    if (response.status === 404) {
      throw new AirtableNotFoundError("Airtable vindt de base, tabel of het record niet. Controleer AIRTABLE_BASE_ID en AIRTABLE_CANDIDATES_TABLE.");
    }
    if (response.status === 422) {
      throw new Error(`Airtable kon het verzoek niet verwerken (${type || "422"}). Controleer de kolomnamen in AIRTABLE_FIELDS en AIRTABLE_POOL_FORMULA.`);
    }
    throw new Error(`Airtable gaf een fout (${response.status}${type ? `, ${type}` : ""}).`);
  }
  return response.json();
}

function tableUrl() {
  const { baseId, table } = config();
  return `${API_BASE}/${encodeURIComponent(baseId)}/${encodeURIComponent(table)}`;
}

function parseOrThrow<T>(schema: z.ZodType<T>, data: unknown, what: string): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new Error(`Airtable gaf een onverwacht antwoord voor ${what}: ${parsed.error.issues[0]?.message ?? "onbekend"}.`);
  }
  return parsed.data;
}

/**
 * All pool candidates, following Airtable's offset pagination.
 * `maxRecords` caps the total (default 2000) so a runaway table never floods a job.
 */
export async function listPoolCandidates({
  filterByFormula,
  view,
  maxRecords = 2000,
}: { filterByFormula?: string; view?: string; maxRecords?: number } = {}): Promise<PoolCandidate[]> {
  const formulas = [AIRTABLE_POOL_FORMULA, filterByFormula].filter((f): f is string => Boolean(f && f.trim()));
  const formula = formulas.length > 1 ? `AND(${formulas.join(",")})` : formulas[0];

  const candidates: PoolCandidate[] = [];
  let offset: string | undefined;
  do {
    const params = new URLSearchParams({ pageSize: "100" });
    if (formula) params.set("filterByFormula", formula);
    if (view) params.set("view", view);
    if (offset) params.set("offset", offset);
    const page = parseOrThrow(airtableListSchema, await airtableFetch(`${tableUrl()}?${params}`), "de kandidatenlijst");
    candidates.push(...page.records.map(mapAirtableCandidate));
    offset = page.offset;
  } while (offset && candidates.length < maxRecords);

  return candidates.slice(0, maxRecords);
}

/** One candidate by Airtable record id, or null when it no longer exists (for example after AVG deletion). */
export async function getPoolCandidate(recordId: string): Promise<PoolCandidate | null> {
  if (!/^rec[a-zA-Z0-9]{3,}$/.test(recordId)) return null;
  try {
    const record = parseOrThrow(
      airtableRecordSchema,
      await airtableFetch(`${tableUrl()}/${encodeURIComponent(recordId)}`),
      "een kandidaat",
    );
    return mapAirtableCandidate(record);
  } catch (error) {
    if (error instanceof AirtableNotFoundError) return null;
    throw error;
  }
}

/** Several candidates by id in as few requests as possible (formula batches of 50). */
export async function getPoolCandidates(recordIds: string[]): Promise<Map<string, PoolCandidate>> {
  const result = new Map<string, PoolCandidate>();
  const ids = [...new Set(recordIds)];
  for (let i = 0; i < ids.length; i += 50) {
    const formula = recordIdFormula(ids.slice(i, i + 50));
    if (!formula) continue;
    const params = new URLSearchParams({ pageSize: "100", filterByFormula: formula });
    const page = parseOrThrow(airtableListSchema, await airtableFetch(`${tableUrl()}?${params}`), "kandidaten");
    for (const record of page.records) result.set(record.id, mapAirtableCandidate(record));
  }
  return result;
}
