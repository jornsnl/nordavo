// Import of the current call list (Nordavo_bellijst_4.xlsx, feedback Julius
// section 1.2): the tabs Bellen, Vacatures, Overige contacten and Nog
// verrijken. Pure: runs in the browser on the parsed sheets, so the file never
// has to be uploaded. The server action writes the records without
// duplicates (src/app/dashboard/import/call-list-actions.ts).

import type { ContactStatus } from "@/lib/database.types";
import type { CompanyCategory, ContactRole } from "@/lib/sales/database";
import { parseRoute, type ContactRoute } from "@/lib/sales/labels";

export type Cell = string | number | boolean | Date | null | undefined;
export type Sheet = { sheet: string; data: Cell[][] };

export type ImportCompany = {
  /** In-file key: the domain, else the LinkedIn page, else the name. */
  key: string;
  name: string;
  domain: string | null;
  website: string | null;
  prio: number | null;
  category: CompanyCategory | null;
  description: string | null;
  sector: string | null;
  employees: number | null;
  city: string | null;
  linkedin_url: string | null;
  general_phone: string | null;
  red_flags: string[];
  opening_line: string | null;
  source_note: string | null;
};

export type ImportContact = {
  companyKey: string;
  first_name: string | null;
  last_name: string | null;
  title: string | null;
  tier: 1 | 2 | 3 | null;
  route: ContactRoute | null;
  phone: string | null;
  email: string | null;
  linkedin_url: string | null;
  status: ContactStatus;
  attempts: number;
  last_attempt_at: string | null;
  referred_to: string | null;
  caller_note: string | null;
  role: ContactRole;
  tab: "bellen" | "overig" | "verrijken";
  /**
   * The last call from the Excel, for the timeline: the outcome the old
   * status stands for (null when the status says nothing about a call) and
   * the status text itself. Null when the row has no call history.
   */
  history: { outcome: HistoryOutcome | null; statusText: string | null } | null;
};

/** Outcomes an old Excel status can stand for (activities_outcome_check). */
export type HistoryOutcome =
  | "no_answer"
  | "call_back"
  | "reached_interested"
  | "meeting_planned"
  | "reached_not_interested"
  | "referred"
  | "wrong_person"
  | "wrong_number"
  | "bereikt";

/** How the columns of one sheet were read, for the preview before importing. */
export type ColumnMapping = {
  /** Columns that are imported, with the field they go to. */
  recognized: { column: string; field: string; label: string }[];
  /** Columns that are not imported. */
  ignored: string[];
  /** Fields of this tab that no column was found for. */
  missing: string[];
};

export type ImportSignal = {
  companyKey: string;
  title: string | null;
  role_group: string | null;
  posted_at: string | null;
  source: string | null;
  link: string | null;
};

export type ParsedCallList = {
  companies: ImportCompany[];
  contacts: ImportContact[];
  signals: ImportSignal[];
  /** Per tab: rows read and rows skipped with the reason. */
  tabs: { tab: string; sheet: string | null; rows: number; skipped: { row: number; reason: string }[] }[];
  /** Columns that were not recognised, per sheet. */
  unknownColumns: Record<string, string[]>;
  /** Per sheet: which column went where, which were ignored and what was not found. */
  columns: Record<string, ColumnMapping>;
};

export function normalizeHeader(header: unknown): string {
  return String(header ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const companyFields: Record<string, string[]> = {
  name: ["bedrijf", "bedrijfsnaam", "company", "company name", "naam bedrijf", "organisatie"],
  prio: ["prio", "prioriteit", "priority"],
  category: ["categorie", "category", "type", "focus"],
  description: ["wat het bedrijf doet", "wat doet het bedrijf", "omschrijving", "beschrijving", "description", "activiteiten"],
  sector: ["sector", "branche", "industry"],
  employees: ["medewerkers", "aantal medewerkers", "werknemers", "fte", "employees", "grootte"],
  city: ["plaats", "stad", "locatie", "vestigingsplaats", "city", "location"],
  website: ["website", "url", "domein", "domain", "site", "webadres"],
  linkedin_url: [
    "linkedin bedrijf",
    "bedrijf linkedin",
    "company linkedin",
    "linkedin company",
    "linkedin pagina",
    "linkedin bedrijfspagina",
    "linkedin bedrijf url",
    "linkedin url bedrijf",
    "company linkedin url",
    "linkedin company url",
    "bedrijfspagina",
  ],
  general_phone: ["algemeen nummer", "algemeen telefoonnummer", "telefoon bedrijf", "bedrijfsnummer", "algemeen", "general number", "hoofdnummer"],
  red_flags: ["rode vlaggen", "rode vlag", "red flags", "red flag", "risico s", "risicos"],
  opening_line: ["openingszin", "opening", "opening line", "openingsregel", "pitch"],
  source_note: ["opmerking bron", "bron opmerking", "bron notitie", "notitie bron"],
};

const contactFields: Record<string, string[]> = {
  full_name: ["contactpersoon", "naam", "contact", "naam contactpersoon", "persoon", "name"],
  first_name: ["voornaam", "first name"],
  last_name: ["achternaam", "last name", "surname"],
  title: ["functie", "titel", "job title", "rol functie", "functietitel"],
  tier: ["tier"],
  route: ["route"],
  phone: ["mobiel", "mobiel nummer", "mobiele nummer", "06", "telefoon", "telefoonnummer", "mobile", "phone", "nummer"],
  email: ["mailadres", "e mail", "email", "e mailadres", "mail"],
  person_linkedin: [
    "linkedin persoon",
    "linkedin contact",
    "linkedin contactpersoon",
    "persoon linkedin",
    "linkedin profiel",
    "linkedin profile",
    "linkedin url",
    "linkedin link",
    "linkedin",
    "li",
  ],
  status: ["status", "belstatus", "status contact"],
  attempts: ["pogingen", "aantal pogingen", "attempts", "belpogingen"],
  last_attempt_at: ["laatste poging", "laatst gebeld", "datum laatste poging", "last attempt"],
  referred_to: ["doorverwezen naar", "doorverwezen", "referred to"],
  caller_note: ["notitie beller", "notitie", "opmerking beller", "opmerking", "notes", "note"],
  role: ["rol", "role"],
};

const signalFields: Record<string, string[]> = {
  company: ["bedrijf", "bedrijfsnaam", "company", "werkgever"],
  website: ["website", "domein", "url bedrijf", "domain"],
  title: ["vacature", "functie", "titel", "vacaturetitel", "job title", "job"],
  role_group: ["rolgroep", "rol groep", "role group", "groep"],
  posted_at: ["datum online", "online sinds", "geplaatst", "datum", "posted"],
  days_open: ["dagen open", "dagen online", "days open"],
  source: ["bron", "source", "platform"],
  link: ["link", "url", "vacature link", "url vacature", "job link"],
};

/** Readable names of the fields, for the mapping preview. */
export const fieldLabels: Record<string, string> = {
  name: "Company name",
  prio: "Prio",
  category: "Category",
  description: "What the company does",
  sector: "Sector",
  employees: "Employees",
  city: "City",
  website: "Website",
  linkedin_url: "LinkedIn (company page, or a person when the link is /in/)",
  general_phone: "General number",
  red_flags: "Red flags",
  opening_line: "Opening line",
  source_note: "Source note",
  full_name: "Contact person",
  first_name: "First name",
  last_name: "Last name",
  title: "Job title",
  tier: "Tier",
  route: "Route",
  phone: "Mobile",
  email: "Mail",
  person_linkedin: "LinkedIn (person, or the company when the link is /company/)",
  status: "Status (becomes contact status and a call on the timeline)",
  attempts: "Attempts",
  last_attempt_at: "Last attempt",
  referred_to: "Referred to",
  caller_note: "Caller note",
  role: "Role (Main, Extra, Reserve)",
  company: "Company name",
  role_group: "Role group",
  posted_at: "Date online",
  days_open: "Days open",
  source: "Source",
  link: "Link",
};

/**
 * The field a header stands for. Exact aliases first; then tolerant: a
 * header that starts or ends with an alias ("Status (oud)", "Telefoon
 * mobiel", "Datum laatste poging") or equals it without spaces ("E-mail",
 * "Linked In"). The longest alias wins, so "LinkedIn bedrijf" is the company.
 */
export function matchHeader(
  header: unknown,
  fields: Record<string, string[]>,
  taken: Set<string> = new Set(),
  exactOnly = false,
): string | null {
  const h = normalizeHeader(header);
  if (!h) return null;
  const compact = h.replace(/ /g, "");
  let best: { field: string; length: number; exact: boolean } | null = null;
  for (const [field, aliases] of Object.entries(fields)) {
    if (taken.has(field)) continue;
    for (const alias of aliases) {
      const exact = alias === h || alias.replace(/ /g, "") === compact;
      // Very short aliases ("li", "06") only count when exact.
      const loose = !exact && !exactOnly && alias.length >= 4 && (h.startsWith(`${alias} `) || h.endsWith(` ${alias}`));
      if (!exact && !loose) continue;
      const better =
        !best || (exact && !best.exact) || (exact === best.exact && alias.length > best.length);
      if (better) best = { field, length: alias.length, exact };
    }
  }
  return best?.field ?? null;
}

/** Which column index holds which field, by the header row. */
function mapHeaders(headers: Cell[], fields: Record<string, string[]>): { map: Record<string, number>; unknown: string[]; mapping: ColumnMapping } {
  const map: Record<string, number> = {};
  const taken = new Set<string>();
  const assigned = new Map<number, string>();
  // Exact matches first, so a loose match never takes a field from an exact one.
  for (const pass of ["exact", "loose"] as const) {
    headers.forEach((raw, index) => {
      if (assigned.has(index) || !normalizeHeader(raw)) return;
      const field = matchHeader(raw, fields, taken, pass === "exact");
      if (!field) return;
      map[field] = index;
      taken.add(field);
      assigned.set(index, field);
    });
  }
  const unknown: string[] = [];
  const recognized: ColumnMapping["recognized"] = [];
  headers.forEach((raw, index) => {
    if (!normalizeHeader(raw)) return;
    const field = assigned.get(index);
    if (field) recognized.push({ column: String(raw).trim(), field, label: fieldLabels[field] ?? field });
    else unknown.push(String(raw).trim());
  });
  const missing = Object.keys(fields)
    .filter((f) => !taken.has(f))
    .map((f) => fieldLabels[f] ?? f);
  return { map, unknown, mapping: { recognized, ignored: unknown, missing } };
}

function text(value: Cell): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const s = String(value).trim();
  return s === "" ? null : s;
}

function isoDate(value: Cell): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  if (typeof value === "number" && value > 20000 && value < 80000) {
    // Excel serial date.
    const ms = Math.round((value - 25569) * 86_400_000);
    return new Date(ms).toISOString().slice(0, 10);
  }
  const s = String(value).trim();
  const nl = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(s);
  if (nl) {
    const year = nl[3].length === 2 ? `20${nl[3]}` : nl[3];
    return `${year}-${nl[2].padStart(2, "0")}-${nl[1].padStart(2, "0")}`;
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
}

function int(value: Cell): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? Math.round(value) : null;
  const m = /(\d[\d.]*)/.exec(String(value).replace(/\s/g, ""));
  if (!m) return null;
  const n = Number(m[1].replace(/\./g, ""));
  return Number.isFinite(n) ? n : null;
}

export function domainFrom(value: string | null): string | null {
  if (!value) return null;
  const d = value
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[/?#:].*$/, "");
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d) ? d : null;
}

export function parsePrio(value: Cell): number | null {
  const s = text(value);
  if (!s) return null;
  const m = /([1-5])/.exec(s);
  if (m) return Number(m[1]);
  const lower = s.toLowerCase();
  if (/^(a|hoog|high)/.test(lower)) return 1;
  if (/^(b|mid|midden|medium)/.test(lower)) return 2;
  if (/^(c|laag|low)/.test(lower)) return 3;
  return null;
}

export function parseCategory(value: Cell): CompanyCategory | null {
  const s = normalizeHeader(value);
  if (!s) return null;
  const dev = /dev|software|ontwikkel/.test(s);
  const data = /data|bi\b|business intelligence/.test(s);
  if ((dev && data) || /beide|both|allebei/.test(s)) return "both";
  if (data) return "data_bi";
  if (dev) return "development";
  return null;
}

export function parseTier(value: Cell): 1 | 2 | 3 | null {
  const m = /([123])/.exec(String(value ?? ""));
  return m ? (Number(m[1]) as 1 | 2 | 3) : null;
}

/** The status column of the Excel to a cleaned contact status (section 2.6). */
export function parseContactStatus(value: Cell, fallback: ContactStatus): ContactStatus {
  const s = normalizeHeader(value);
  if (!s) return fallback;
  if (/niet benader|do not contact|niet bellen|afgemeld|uitgesloten/.test(s)) return "do_not_contact";
  if (/niet bereikt|3 pogingen|not reached/.test(s)) return "not_reached";
  if (/niet geinteresseerd|geen interesse|not interested|afgewezen|verloren|lost/.test(s)) return "not_interested";
  if (/verrijk|enrich|geen nummer|verkeerd nummer|wrong number|nummer klopt niet|onjuist nummer/.test(s)) return "enrich";
  if (/bereikt|reached|afspraak|meeting|interesse|interested|klant|doorverwezen|referred/.test(s)) return "reached";
  if (/gebeld|geen gehoor|no answer|terugbellen|call back|voicemail|in outreach|benaderd|gemaild/.test(s)) return "in_outreach";
  if (/gekwalificeerd|qualified/.test(s)) return "qualified";
  if (/verrijkt|enriched/.test(s)) return "enriched";
  if (/nieuw|new/.test(s)) return "new";
  return fallback;
}

/**
 * The call an old Excel status stands for, for the timeline (section 2.9
 * buttons). Null when the status says nothing about a call ("Nieuw",
 * "Enrich", "Niet benaderen").
 */
export function parseCallOutcome(value: Cell): HistoryOutcome | null {
  const s = normalizeHeader(value);
  if (!s) return null;
  if (/verkeerd nummer|wrong number|nummer klopt niet|onjuist nummer|nummer onjuist|niet in gebruik|nummer bestaat niet/.test(s)) return "wrong_number";
  if (/verkeerde persoon|wrong person|verkeerd contact|niet de juiste persoon/.test(s)) return "wrong_person";
  if (/doorverwezen|referred|verwezen naar/.test(s)) return "referred";
  if (/afspraak|meeting/.test(s)) return "meeting_planned";
  if (/niet geinteresseerd|geen interesse|not interested|afgewezen|geen behoefte/.test(s)) return "reached_not_interested";
  if (/interesse|interested|geinteresseerd/.test(s)) return "reached_interested";
  if (/terugbellen|terug bellen|call back|callback|bel terug|later bellen/.test(s)) return "call_back";
  if (/geen gehoor|no answer|voicemail|niet opgenomen|niet bereikt|not reached|bezet|in gesprek/.test(s)) return "no_answer";
  if (/bereikt|reached|gesproken/.test(s)) return "bereikt";
  return null;
}

/**
 * The external id of the call from the Excel (activities.external_id). A
 * second import of the same file is a no-op; a later file with a newer
 * status or date adds the newer call.
 */
export function historyExternalId(
  contactId: string,
  history: ImportContact["history"],
  lastAttemptAt: string | null,
): string {
  const what = history?.outcome ?? (normalizeHeader(history?.statusText ?? "").replace(/ /g, "-") || "call");
  return `import:call:${contactId}:${what}:${lastAttemptAt ?? "undated"}`;
}

/** Where a LinkedIn link belongs: a company page or a person's profile. */
export function linkedinKind(url: string | null): "company" | "person" | null {
  if (!url) return null;
  if (/\/(company|school|showcase)\//i.test(url)) return "company";
  if (/\/(in|pub)\//i.test(url)) return "person";
  return null;
}

function parseRole(value: Cell, fallback: ContactRole): ContactRole {
  const s = normalizeHeader(value);
  if (/reserve/.test(s)) return "reserve";
  if (/extra/.test(s)) return "extra";
  if (/main|hoofd|primair/.test(s)) return "main";
  return fallback;
}

function splitName(full: string | null): { first: string | null; last: string | null } {
  if (!full) return { first: null, last: null };
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return { first: parts[0], last: null };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

function list(value: Cell): string[] {
  const s = text(value);
  if (!s) return [];
  return s
    .split(/[;,\n|]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function companyKey(input: { domain: string | null; linkedin: string | null; name: string | null }): string | null {
  if (input.domain) return `d:${input.domain}`;
  if (input.linkedin) return `l:${input.linkedin.toLowerCase().replace(/^https?:\/\/(www\.|[a-z]{2}\.)?/, "").replace(/\/+$/, "")}`;
  if (input.name) return `n:${normalizeHeader(input.name)}`;
  return null;
}

const TAB_NAMES = {
  bellen: ["bellen", "bellijst", "te bellen", "call list"],
  vacatures: ["vacatures", "vacancies", "signalen", "jobs"],
  overig: ["overige contacten", "overig", "overige", "extra contacten", "reserve"],
  verrijken: ["nog verrijken", "verrijken", "enrich", "zonder nummer"],
} as const;

/** A tab by its name; tolerant of extra words or numbers ("Bellen (340)", "Vacatures nov"). */
function findSheet(sheets: Sheet[], names: readonly string[]): Sheet | null {
  const exact = sheets.find((s) => names.includes(normalizeHeader(s.sheet)));
  if (exact) return exact;
  return (
    sheets.find((s) => {
      const n = normalizeHeader(s.sheet);
      return names.some((name) => n.startsWith(`${name} `) || n.endsWith(` ${name}`));
    }) ?? null
  );
}

/** The first row with at least two known headers is the header row (sheets may start with a title). */
function headerRow(data: Cell[][], fields: Record<string, string[]>): number {
  for (let i = 0; i < Math.min(10, data.length); i += 1) {
    const hits = (data[i] ?? []).filter((c) => typeof c === "string" && matchHeader(c, fields) !== null).length;
    if (hits >= 2) return i;
  }
  return 0;
}

/** Reads the four tabs into companies, contacts and vacancies, merged within the file. */
export function parseCallList(sheets: Sheet[]): ParsedCallList {
  const companies = new Map<string, ImportCompany>();
  const contacts: ImportContact[] = [];
  const signals: ImportSignal[] = [];
  const tabs: ParsedCallList["tabs"] = [];
  const unknownColumns: Record<string, string[]> = {};
  const columns: Record<string, ColumnMapping> = {};

  const readCompany = (row: Cell[], map: Record<string, number>, linkedin: string | null): ImportCompany | null => {
    const get = (f: string) => (map[f] === undefined ? undefined : row[map[f]]);
    const name = text(get("name"));
    const website = text(get("website"));
    const domain = domainFrom(website);
    const key = companyKey({ domain, linkedin, name });
    if (!key) return null;
    const incoming: ImportCompany = {
      key,
      name: name ?? domain ?? "Unnamed company",
      domain,
      website,
      prio: parsePrio(get("prio")),
      category: parseCategory(get("category")),
      description: text(get("description")),
      sector: text(get("sector")),
      employees: int(get("employees")),
      city: text(get("city")),
      linkedin_url: linkedin,
      general_phone: text(get("general_phone")),
      red_flags: list(get("red_flags")),
      opening_line: text(get("opening_line")),
      source_note: text(get("source_note")),
    };
    const existing = companies.get(key);
    if (!existing) {
      companies.set(key, incoming);
      return incoming;
    }
    // Same company on several rows: fill in what the first row missed.
    for (const [field, value] of Object.entries(incoming) as [keyof ImportCompany, unknown][]) {
      const current = existing[field];
      const empty = current === null || (Array.isArray(current) && current.length === 0);
      if (empty && value !== null && !(Array.isArray(value) && value.length === 0)) {
        (existing as Record<string, unknown>)[field] = value;
      }
    }
    return existing;
  };

  const contactTab = (tab: "bellen" | "overig" | "verrijken", names: readonly string[], role: ContactRole, status: ContactStatus) => {
    const sheet = findSheet(sheets, names);
    const fields = { ...companyFields, ...contactFields };
    const result = { tab, sheet: sheet?.sheet ?? null, rows: 0, skipped: [] as { row: number; reason: string }[] };
    if (!sheet) {
      tabs.push(result);
      return;
    }
    const start = headerRow(sheet.data, fields);
    const { map, unknown, mapping } = mapHeaders(sheet.data[start] ?? [], fields);
    if (unknown.length > 0) unknownColumns[sheet.sheet] = unknown;
    columns[sheet.sheet] = mapping;
    for (let i = start + 1; i < sheet.data.length; i += 1) {
      const row = sheet.data[i];
      if (!row || row.every((c) => text(c) === null)) continue;
      result.rows += 1;
      const pick = (f: string) => (map[f] === undefined ? null : text(row[map[f]]));
      // A LinkedIn link goes where it points: /company/ to the company, /in/
      // to the person, whichever column it is in. A link of neither kind
      // stays with the company column, or is dropped from the person column.
      const links = [
        { url: pick("linkedin_url"), column: "company" as const },
        { url: pick("person_linkedin"), column: "person" as const },
      ].filter((l): l is { url: string; column: "company" | "person" } => Boolean(l.url));
      const companyLinkedin =
        links.find((l) => linkedinKind(l.url) === "company")?.url ??
        links.find((l) => l.column === "company" && linkedinKind(l.url) === null)?.url ??
        null;
      const linkedin = links.find((l) => linkedinKind(l.url) === "person")?.url ?? null;
      const company = readCompany(row, map, companyLinkedin);
      if (!company) {
        result.skipped.push({ row: i + 1, reason: "No company name, website or LinkedIn page" });
        continue;
      }
      const get = (f: string) => (map[f] === undefined ? undefined : row[map[f]]);
      const full = text(get("full_name"));
      const split = splitName(full);
      const first = text(get("first_name")) ?? split.first;
      const last = text(get("last_name")) ?? split.last;
      const phone = text(get("phone"));
      const email = text(get("email"));
      if (!first && !last && !email && !phone && !linkedin) {
        // A company row without a person still counts for the company.
        continue;
      }
      const parsedStatus = parseContactStatus(get("status"), status);
      const statusText = text(get("status"));
      const attempts = int(get("attempts")) ?? 0;
      const lastAttempt = isoDate(get("last_attempt_at"));
      const outcome = parseCallOutcome(get("status"));
      // A route the pick list does not know is kept in the caller note.
      const routeText = text(get("route"));
      const route = parseRoute(routeText, phone);
      const note = text(get("caller_note"));
      const callerNote = routeText && !route ? [note, `Route: ${routeText}`].filter(Boolean).join("\n") : note;
      contacts.push({
        companyKey: company.key,
        first_name: first,
        last_name: last,
        title: text(get("title")),
        tier: parseTier(get("tier")),
        route,
        phone,
        email,
        linkedin_url: linkedin,
        // A contact without a number cannot be called: Enrich (tab Nog verrijken).
        status: tab === "verrijken" && parsedStatus === "new" ? "enrich" : !phone && parsedStatus === "new" && tab === "bellen" ? "enrich" : parsedStatus,
        attempts,
        last_attempt_at: lastAttempt,
        referred_to: text(get("referred_to")),
        caller_note: callerNote,
        role: parseRole(get("role"), role),
        tab,
        history: outcome || attempts > 0 || lastAttempt ? { outcome, statusText } : null,
      });
    }
    tabs.push(result);
  };

  contactTab("bellen", TAB_NAMES.bellen, "main", "new");
  contactTab("overig", TAB_NAMES.overig, "extra", "new");
  contactTab("verrijken", TAB_NAMES.verrijken, "main", "enrich");

  const vacancies = findSheet(sheets, TAB_NAMES.vacatures);
  const vacancyResult = { tab: "vacatures", sheet: vacancies?.sheet ?? null, rows: 0, skipped: [] as { row: number; reason: string }[] };
  if (vacancies) {
    const start = headerRow(vacancies.data, signalFields);
    const { map, unknown, mapping } = mapHeaders(vacancies.data[start] ?? [], signalFields);
    if (unknown.length > 0) unknownColumns[vacancies.sheet] = unknown;
    columns[vacancies.sheet] = mapping;
    for (let i = start + 1; i < vacancies.data.length; i += 1) {
      const row = vacancies.data[i];
      if (!row || row.every((c) => text(c) === null)) continue;
      vacancyResult.rows += 1;
      const get = (f: string) => (map[f] === undefined ? undefined : row[map[f]]);
      const name = text(get("company"));
      const domain = domainFrom(text(get("website")));
      // Match the company of the call list by domain, else by name.
      const key =
        (domain && companies.has(`d:${domain}`) ? `d:${domain}` : null) ??
        [...companies.values()].find((c) => name && normalizeHeader(c.name) === normalizeHeader(name))?.key ??
        companyKey({ domain, linkedin: null, name });
      if (!key) {
        vacancyResult.skipped.push({ row: i + 1, reason: "No company" });
        continue;
      }
      if (!companies.has(key)) {
        companies.set(key, {
          key,
          name: name ?? domain ?? "Unnamed company",
          domain,
          website: text(get("website")),
          prio: null,
          category: null,
          description: null,
          sector: null,
          employees: null,
          city: null,
          linkedin_url: null,
          general_phone: null,
          red_flags: [],
          opening_line: null,
          source_note: null,
        });
      }
      let posted = isoDate(get("posted_at"));
      const daysOpen = int(get("days_open"));
      if (!posted && daysOpen !== null) {
        posted = new Date(Date.now() - daysOpen * 86_400_000).toISOString().slice(0, 10);
      }
      signals.push({
        companyKey: key,
        title: text(get("title")),
        role_group: text(get("role_group")),
        posted_at: posted,
        source: text(get("source")),
        link: text(get("link")),
      });
    }
  }
  tabs.push(vacancyResult);

  return { companies: [...companies.values()], contacts, signals, tabs, unknownColumns, columns };
}

/** Every key a contact can be recognised by: LinkedIn, mail and name at the company. */
function contactKeys(c: ImportContact): string[] {
  const keys: string[] = [];
  if (c.linkedin_url) keys.push(`l:${c.linkedin_url.toLowerCase().replace(/^https?:\/\/(www\.|[a-z]{2}\.)?/, "").replace(/\/+$/, "")}`);
  if (c.email) keys.push(`e:${c.email.toLowerCase()}`);
  const name = normalizeHeader(`${c.first_name ?? ""} ${c.last_name ?? ""}`);
  if (name) keys.push(`n:${c.companyKey}:${name}`);
  if (keys.length === 0) keys.push(`p:${c.companyKey}:${(c.phone ?? "").replace(/\D/g, "")}`);
  return keys;
}

/** Removes in-file duplicates; a later row only fills in what an earlier one missed. */
export function dedupeContacts(contacts: ImportContact[]): ImportContact[] {
  const byKey = new Map<string, ImportContact>();
  const out: ImportContact[] = [];
  for (const c of contacts) {
    const keys = contactKeys(c);
    const existing = keys.map((k) => byKey.get(k)).find(Boolean);
    if (!existing) {
      const copy = { ...c };
      out.push(copy);
      for (const k of keys) byKey.set(k, copy);
      continue;
    }
    for (const [field, value] of Object.entries(c) as [keyof ImportContact, unknown][]) {
      if ((existing[field] === null || existing[field] === undefined) && value !== null && value !== undefined) {
        (existing as Record<string, unknown>)[field] = value;
      }
    }
    // The call tab wins for role and status.
    if (c.tab === "bellen" && existing.tab !== "bellen") {
      existing.role = c.role;
      existing.status = c.status;
      existing.tab = "bellen";
    }
    existing.attempts = Math.max(existing.attempts, c.attempts);
    for (const k of contactKeys(existing)) byKey.set(k, existing);
  }
  return out;
}
