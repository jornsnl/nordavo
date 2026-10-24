import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActivityChannel, ActivityOutcome, Database } from "@/lib/database.types";
import { normalizeDomain, normalizeEmail, normalizeLinkedin, splitName } from "./normalize";
import { parseEmployeeCount } from "./signals";
import { upsertCompany, upsertContact } from "./upsert";

/**
 * Migration of the old Google Sheets lead lists (briefing section 13):
 * normalise domains, deduplicate through upsertCompany / upsertContact,
 * record the sheet as source, and log earlier calls or mails as activities.
 */

/** One CSV row: column name -> cell value. */
export type LeadImportRow = Record<string, string>;

/** Which CSV column holds which field. Values are column names from the file. */
export type LeadImportMapping = {
  domain: string;
  company_name?: string;
  legal_form?: string;
  employees?: string;
  sector?: string;
  city?: string;
  company_linkedin?: string;
  full_name?: string;
  first_name?: string;
  last_name?: string;
  title?: string;
  person_linkedin?: string;
  email?: string;
  phone?: string;
  /** Date the contact was last called or mailed in the old process. */
  last_contacted_at?: string;
  /** "bellen" or "mail"; defaults to "bellen" when last_contacted_at is set. */
  contact_channel?: string;
  /** Free text outcome from the sheet, stored as the activity note. */
  contact_outcome?: string;
};

export type LeadImportResult = {
  rows: number;
  companiesCreated: number;
  companiesUpdated: number;
  contactsCreated: number;
  contactsUpdated: number;
  activitiesCreated: number;
  skipped: { row: number; reason: string }[];
};

// ---------------------------------------------------------------------------
// Mapping guess
// ---------------------------------------------------------------------------

/** "E-mail adres" -> "e mail adres", "Person LinkedIn" -> "person linkedin". */
export function normalizeHeader(header: string): string {
  return header
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9#]+/g, " ")
    .trim();
}

type Field = keyof LeadImportMapping;

/** Exact (normalised) header names per field. Checked before the looser patterns. */
const EXACT: [Field, string[]][] = [
  ["company_linkedin", ["company linkedin", "company linkedin url", "linkedin company", "linkedin bedrijf", "bedrijf linkedin", "bedrijfs linkedin", "linkedin bedrijfspagina", "company linkedin page"]],
  ["person_linkedin", ["person linkedin", "person linkedin url", "linkedin", "linkedin url", "linkedin profiel", "linkedin profile", "profile url", "persoon linkedin", "contact linkedin", "linkedin persoon"]],
  ["domain", ["domein", "domain", "company domain", "bedrijfsdomein", "website", "web", "url", "site", "company website", "website url", "websiteadres", "webadres"]],
  ["company_name", ["bedrijf", "bedrijfsnaam", "company", "company name", "organisatie", "organisation", "organization", "account", "account name", "firma", "naam bedrijf"]],
  ["legal_form", ["rechtsvorm", "legal form", "rechtsvorm bedrijf"]],
  ["employees", ["medewerkers", "aantal medewerkers", "employees", "werknemers", "aantal werknemers", "fte", "company size", "bedrijfsgrootte", "omvang", "headcount", "# employees", "number of employees", "employee count"]],
  ["sector", ["sector", "branche", "industry", "industrie"]],
  ["city", ["plaats", "stad", "city", "vestigingsplaats", "locatie", "location", "woonplaats"]],
  ["first_name", ["voornaam", "first name", "firstname", "given name"]],
  ["last_name", ["achternaam", "last name", "lastname", "surname", "family name"]],
  ["full_name", ["naam", "name", "contactpersoon", "contact", "volledige naam", "full name", "contact name", "naam contactpersoon", "persoon"]],
  ["title", ["functie", "title", "job title", "functietitel", "rol", "role", "position", "functie contactpersoon"]],
  ["email", ["email", "e mail", "mail", "emailadres", "e mailadres", "email adres", "e mail adres", "email address", "mailadres"]],
  ["phone", ["telefoon", "telefoonnummer", "phone", "phone number", "mobiel", "mobiel nummer", "mobile", "mobile phone", "tel", "telnr", "gsm", "nummer"]],
  ["last_contacted_at", ["gebeld op", "laatst benaderd", "last contacted", "laatst gebeld", "datum gebeld", "contact datum", "contactdatum", "benaderd op", "gemaild op", "last contact", "datum contact", "laatste contact"]],
  ["contact_channel", ["kanaal", "channel", "benaderd via", "contact kanaal"]],
  ["contact_outcome", ["uitkomst", "outcome", "resultaat", "result", "reactie", "uitkomst gesprek", "notities", "notes", "opmerking", "opmerkingen"]],
];

/** Looser patterns for headers that are not in EXACT, in priority order. */
const PATTERNS: [Field, RegExp][] = [
  ["company_linkedin", /linkedin.*(company|bedrijf|organisatie)|(company|bedrijf|organisatie).*linkedin/],
  ["person_linkedin", /linkedin/],
  ["email", /\be ?mail/],
  ["phone", /telefoon|phone|mobiel|mobile|\btel\b/],
  ["domain", /domein|domain|website|\burl\b/],
  ["last_contacted_at", /gebeld|benaderd|contacted|laatst|datum/],
  ["contact_outcome", /uitkomst|outcome|resultaat|reactie/],
  ["first_name", /voornaam|first ?name/],
  ["last_name", /achternaam|last ?name|surname/],
  ["company_name", /bedrijf|company|organisatie/],
  ["employees", /medewerkers|employees|werknemers/],
  ["title", /functie|job title/],
];

/** Suggest a mapping from the header row (Dutch and English column names). */
export function guessMapping(headers: string[]): Partial<LeadImportMapping> {
  const mapping: Partial<LeadImportMapping> = {};
  const used = new Set<string>();
  const normalized = headers.map((header) => ({ header, key: normalizeHeader(header) }));

  for (const [field, names] of EXACT) {
    if (mapping[field]) continue;
    // Prefer the order of the names list (domain before website, and so on).
    for (const name of names) {
      const hit = normalized.find(({ header, key }) => key === name && !used.has(header));
      if (hit) {
        mapping[field] = hit.header;
        used.add(hit.header);
        break;
      }
    }
  }
  for (const [field, pattern] of PATTERNS) {
    if (mapping[field]) continue;
    const hit = normalized.find(({ header, key }) => key && pattern.test(key) && !used.has(header));
    if (hit) {
      mapping[field] = hit.header;
      used.add(hit.header);
    }
  }
  return mapping;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * A date in sheet text: "13-03-2025", "2025-03-13", "3-1-25", "13/03/2025",
 * also inside text ("gebeld op 13-03-2025, geen gehoor"). Day-month order, as
 * in Dutch sheets. Returns an ISO timestamp at 12:00 UTC (so the date never
 * shifts by time zone), or null.
 */
export function parseSheetDate(value: string | null | undefined): string | null {
  const text = (value ?? "").trim();
  if (!text) return null;
  let year: number;
  let month: number;
  let day: number;
  const iso = text.match(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  const dutch = text.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})\b/);
  if (iso) {
    [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  } else if (dutch) {
    [day, month, year] = [Number(dutch[1]), Number(dutch[2]), Number(dutch[3])];
    if (dutch[3].length === 2) year += 2000;
  } else {
    return null;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 2000 || year > 2100) return null;
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  // Reject 31-02 and similar.
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString();
}

/** Channel from the sheet text; defaults to bellen. */
export function channelFromText(value: string | null | undefined): ActivityChannel {
  const text = (value ?? "").toLowerCase();
  if (/linkedin/.test(text)) return "linkedin";
  if (/e-?mail|\bmail|gemaild|instantly/.test(text)) return "mail";
  if (/meeting|afspraak gehad|gesprek gehad/.test(text)) return "meeting";
  return "bellen";
}

/**
 * Outcome from the free text in the sheet. Only clear cases get their own
 * outcome; everything else is "bereikt" (a call) or "verstuurd" (a mail or
 * LinkedIn message, where we only know it was sent).
 */
export function outcomeFromText(value: string | null | undefined, channel: ActivityChannel = "bellen"): ActivityOutcome {
  const text = (value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  if (/niet geinteresseerd|geen interesse|not interested|geen behoefte/.test(text)) return "niet_geinteresseerd";
  if (/geen gehoor|niet opgenomen|voicemail|no answer|niet bereikt|geen antwoord/.test(text)) return "geen_gehoor";
  if (/terugbellen|bel(t)? terug|call back|callback/.test(text)) return "terugbellen";
  if (/\bafspraak\b|meeting gepland|ingepland|appointment/.test(text) && !/geen afspraak|no appointment/.test(text)) return "afspraak";
  return channel === "bellen" || channel === "meeting" ? "bereikt" : "verstuurd";
}

const FREE_MAIL = new Set([
  "gmail.com", "googlemail.com", "hotmail.com", "hotmail.nl", "outlook.com", "outlook.nl", "live.nl", "live.com",
  "yahoo.com", "yahoo.nl", "icloud.com", "me.com", "msn.com", "ziggo.nl", "kpnmail.nl", "kpnplanet.nl",
  "planet.nl", "home.nl", "xs4all.nl", "hetnet.nl", "chello.nl", "casema.nl", "upcmail.nl", "telfort.nl", "proton.me", "protonmail.com",
]);

const HOSTNAME = /^([a-z0-9-]+\.)+[a-z]{2,}$/;

/** Domain from the domain or website column, else from a business email address. */
export function domainForRow(domainCell: string | null | undefined, email: string | null | undefined): string | null {
  const fromCell = normalizeDomain(domainCell);
  if (fromCell && HOSTNAME.test(fromCell)) return fromCell;
  const address = normalizeEmail(email);
  const fromEmail = address ? normalizeDomain(address.split("@")[1]) : null;
  if (fromEmail && HOSTNAME.test(fromEmail) && !FREE_MAIL.has(fromEmail)) return fromEmail;
  return null;
}

/** Stable id for an imported activity: the same sheet row imported twice gets the same id. */
export function importActivityId(parts: { source: string; domain: string; person: string; date: string; channel: string }): string {
  const hash = createHash("sha256")
    .update([parts.source.trim().toLowerCase(), parts.domain, parts.person, parts.date.slice(0, 10), parts.channel].join("|"))
    .digest("hex")
    .slice(0, 32);
  return `import:${hash}`;
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

function cell(row: LeadImportRow, column: string | undefined): string | null {
  if (!column) return null;
  const value = row[column];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function importLeadRows(
  db: SupabaseClient<Database>,
  rows: LeadImportRow[],
  mapping: LeadImportMapping,
  source: string,
): Promise<LeadImportResult> {
  const result: LeadImportResult = {
    rows: rows.length,
    companiesCreated: 0,
    companiesUpdated: 0,
    contactsCreated: 0,
    contactsUpdated: 0,
    activitiesCreated: 0,
    skipped: [],
  };
  const sourceName = source.trim() || "import";
  const seenCompanies = new Set<string>();
  const seenContacts = new Set<string>();

  for (const [index, row] of rows.entries()) {
    // Row number as the user sees it in the sheet (row 1 is the header).
    const rowNumber = index + 2;
    try {
      const email = cell(row, mapping.email);
      const domain = domainForRow(cell(row, mapping.domain), email);
      if (!domain) {
        result.skipped.push({ row: rowNumber, reason: "Geen bruikbaar domein of website" });
        continue;
      }

      const company = await upsertCompany(
        db,
        {
          domain,
          name: cell(row, mapping.company_name),
          website: cell(row, mapping.domain),
          legal_form: cell(row, mapping.legal_form),
          employees: parseEmployeeCount(cell(row, mapping.employees)),
          sector: cell(row, mapping.sector),
          city: cell(row, mapping.city),
          linkedin_url: normalizeLinkedin(cell(row, mapping.company_linkedin)),
        },
        sourceName,
      );
      if (company.created) result.companiesCreated += 1;
      else if (!seenCompanies.has(company.id)) result.companiesUpdated += 1;
      seenCompanies.add(company.id);

      let firstName = cell(row, mapping.first_name);
      let lastName = cell(row, mapping.last_name);
      if (!firstName && !lastName) {
        const split = splitName(cell(row, mapping.full_name));
        firstName = split.first;
        lastName = split.last;
      }
      const personLinkedin = normalizeLinkedin(cell(row, mapping.person_linkedin));
      const linkedin = personLinkedin?.startsWith("linkedin.com/in/") ? personLinkedin : null;

      let contactId: string | null = null;
      if (firstName || lastName || linkedin || normalizeEmail(email)) {
        const contact = await upsertContact(
          db,
          {
            company_id: company.id,
            first_name: firstName,
            last_name: lastName,
            title: cell(row, mapping.title),
            linkedin_url: linkedin,
            email,
            phone: cell(row, mapping.phone),
          },
          sourceName,
        );
        contactId = contact.id;
        if (contact.created) result.contactsCreated += 1;
        else if (!seenContacts.has(contact.id)) result.contactsUpdated += 1;
        seenContacts.add(contact.id);
      }

      const contactedText = cell(row, mapping.last_contacted_at);
      const date = parseSheetDate(contactedText);
      if (date) {
        const outcomeText = cell(row, mapping.contact_outcome);
        const channel = channelFromText(cell(row, mapping.contact_channel));
        const notes = [...new Set([contactedText, outcomeText].filter(Boolean))].join("\n");
        const person = linkedin ?? normalizeEmail(email) ?? [firstName, lastName].filter(Boolean).join(" ").toLowerCase();
        const { data, error } = await db
          .from("activities")
          .upsert(
            {
              contact_id: contactId,
              company_id: company.id,
              channel,
              date,
              outcome: outcomeFromText(outcomeText ?? contactedText, channel),
              notes: notes || null,
              source: "import",
              external_id: importActivityId({ source: sourceName, domain, person, date, channel }),
            },
            { onConflict: "external_id", ignoreDuplicates: true },
          )
          .select("id");
        if (error) throw error;
        result.activitiesCreated += data?.length ?? 0;
      }
    } catch (error) {
      result.skipped.push({
        row: rowNumber,
        reason: `Fout: ${error instanceof Error ? error.message : String((error as { message?: string })?.message ?? error)}`.slice(0, 300),
      });
    }
  }

  return result;
}
