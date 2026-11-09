// Import of the current call list (Nordavo_bellijst_4.xlsx, feedback Julius
// section 1.2): the tabs Bellen, Vacatures, Overige contacten and Nog
// verrijken. Pure: runs in the browser on the parsed sheets, so the file never
// has to be uploaded. The server action writes the records without
// duplicates (src/app/dashboard/import/call-list-actions.ts).

import type { ContactStatus } from "@/lib/database.types";
import type { CompanyCategory, ContactRole } from "@/lib/sales/database";

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
  route: string | null;
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
  linkedin_url: ["linkedin bedrijf", "bedrijf linkedin", "company linkedin", "linkedin company", "linkedin pagina", "linkedin bedrijfspagina"],
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
  person_linkedin: ["linkedin persoon", "linkedin contact", "persoon linkedin", "linkedin profiel", "linkedin"],
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

/** Which column index holds which field, by the header row. */
function mapHeaders(headers: Cell[], fields: Record<string, string[]>): { map: Record<string, number>; unknown: string[] } {
  const map: Record<string, number> = {};
  const unknown: string[] = [];
  headers.forEach((raw, index) => {
    const h = normalizeHeader(raw);
    if (!h) return;
    const hit = Object.entries(fields).find(([field, aliases]) => map[field] === undefined && aliases.includes(h));
    if (hit) map[hit[0]] = index;
    else unknown.push(String(raw));
  });
  return { map, unknown };
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
  if (/verrijk|enrich|geen nummer/.test(s)) return "enrich";
  if (/bereikt|reached|afspraak|meeting|interesse|interested|klant|doorverwezen|referred/.test(s)) return "reached";
  if (/gebeld|geen gehoor|no answer|terugbellen|call back|voicemail|in outreach|benaderd|gemaild/.test(s)) return "in_outreach";
  if (/gekwalificeerd|qualified/.test(s)) return "qualified";
  if (/verrijkt|enriched/.test(s)) return "enriched";
  if (/nieuw|new/.test(s)) return "new";
  return fallback;
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

function findSheet(sheets: Sheet[], names: readonly string[]): Sheet | null {
  return sheets.find((s) => names.includes(normalizeHeader(s.sheet))) ?? null;
}

/** The first row with at least two known headers is the header row (sheets may start with a title). */
function headerRow(data: Cell[][], fields: Record<string, string[]>): number {
  const known = new Set(Object.values(fields).flat());
  for (let i = 0; i < Math.min(10, data.length); i += 1) {
    const hits = data[i].filter((c) => known.has(normalizeHeader(c))).length;
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

  const readCompany = (row: Cell[], map: Record<string, number>): ImportCompany | null => {
    const get = (f: string) => (map[f] === undefined ? undefined : row[map[f]]);
    const name = text(get("name"));
    const website = text(get("website"));
    const domain = domainFrom(website);
    const linkedin = text(get("linkedin_url"));
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
    const { map, unknown } = mapHeaders(sheet.data[start] ?? [], fields);
    if (unknown.length > 0) unknownColumns[sheet.sheet] = unknown;
    for (let i = start + 1; i < sheet.data.length; i += 1) {
      const row = sheet.data[i];
      if (!row || row.every((c) => text(c) === null)) continue;
      result.rows += 1;
      const company = readCompany(row, map);
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
      const linkedin = text(get("person_linkedin"));
      if (!first && !last && !email && !phone && !linkedin) {
        // A company row without a person still counts for the company.
        continue;
      }
      const personLinkedin = linkedin && /\/in\//i.test(linkedin) ? linkedin : null;
      const parsedStatus = parseContactStatus(get("status"), status);
      contacts.push({
        companyKey: company.key,
        first_name: first,
        last_name: last,
        title: text(get("title")),
        tier: parseTier(get("tier")),
        route: text(get("route")),
        phone,
        email,
        linkedin_url: personLinkedin,
        // A contact without a number cannot be called: Enrich (tab Nog verrijken).
        status: tab === "verrijken" && parsedStatus === "new" ? "enrich" : !phone && parsedStatus === "new" && tab === "bellen" ? "enrich" : parsedStatus,
        attempts: int(get("attempts")) ?? 0,
        last_attempt_at: isoDate(get("last_attempt_at")),
        referred_to: text(get("referred_to")),
        caller_note: text(get("caller_note")),
        role: parseRole(get("role"), role),
        tab,
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
    const { map, unknown } = mapHeaders(vacancies.data[start] ?? [], signalFields);
    if (unknown.length > 0) unknownColumns[vacancies.sheet] = unknown;
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

  return { companies: [...companies.values()], contacts, signals, tabs, unknownColumns };
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
