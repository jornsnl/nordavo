// The call list as a spreadsheet, next to the call screen (feedback Julius,
// 896704e2 and f5d4375a): one row per company that folds out to its contacts,
// with the last outcome, attempts, call back, last note and who called last,
// filters, and the same outcome windows as the call screen. buildSheetRows
// makes the rows per contact, groupSheetRows folds them into company rows.
// Pure, safe for client components; tested in tests/call-brief.test.ts and
// tests/call-sheet.test.ts.

import { cleanDescription, currentOpeningLine, parseRedFlags } from "@/lib/sales/call-brief";
import { outcomeName } from "@/lib/sales/timeline";
import { daysOnline, onlineSince } from "@/lib/sales/vacancies";

export type SheetVacancy = {
  title: string | null;
  url: string | null;
  /** posted_at, else first seen (YYYY-MM-DD or ISO). */
  since: string | null;
};

export type SheetCompany = {
  id: string;
  name: string;
  openingLine: string | null;
  redFlags: string[];
  generalPhone: string | null;
  website: string | null;
  linkedinUrl: string | null;
  /** companies.description: what the company does, mixed with source lines the caller does not need. */
  description?: string | null;
  /** What was agreed to do next (companies.next_action), for "interested without a next step". */
  nextAction?: string | null;
  nextActionDate?: string | null;
};

export type SheetContact = {
  id: string;
  company_id: string;
  full_name: string | null;
  title: string | null;
  phone: string | null;
  email: string | null;
  linkedin_url: string | null;
  status: string;
  attempts: number;
  last_attempt_at: string | null;
  callback_at: string | null;
  first_name?: string | null;
  last_name?: string | null;
  /** The mobile number was marked as wrong by a caller. */
  phone_wrong?: boolean;
  caller_note?: string | null;
};

/** One call of the log (Activities, channel call), newest first when given in a list. */
export type SheetCall = {
  companyId: string;
  contactId: string | null;
  outcome: string | null;
  notes: string | null;
  at: string;
  /** The team member or external caller who called. */
  by: string | null;
};

export type SheetLink = { label: string; url: string };

export type SheetRow = {
  contactId: string;
  companyId: string;
  company: string;
  contact: string;
  title: string | null;
  phone: string | null;
  phoneKind: "contact" | "general" | null;
  /** The general number of the company, at every contact, as a fallback. */
  generalPhone: string | null;
  /** The opening line as it is true today (days open counted again). */
  openingLine: string | null;
  /** Real red flags, as whole sentences. */
  redFlags: string[];
  /** What the company does. */
  whatTheyDo: string | null;
  /** Objection with the answer to give, as one text. */
  objection: string | null;
  /** The question for the conversation. */
  question: string | null;
  /** Titles of the open roles, oldest first. */
  roles: string[];
  vacancyCount: number;
  /** Days the oldest open vacancy is open. */
  daysOpen: number | null;
  links: SheetLink[];
  status: string;
  attempts: number;
  lastAttemptAt: string | null;
  callbackAt: string | null;
  /** In the queue now (not called today, not held by someone else, ...). */
  callable: boolean;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  /** The mobile number of the contact itself (phone above falls back to the general number). */
  ownPhone: string | null;
  phoneWrong: boolean;
  /** Outcome (value) of the last call to this contact and when. */
  lastOutcome: string | null;
  lastOutcomeAt: string | null;
  /** Latest note of a call at this company, else the note on the contact. */
  lastNote: string | null;
  /** Who made the last call at this company. */
  lastBy: string | null;
  nextAction: string | null;
  nextActionDate: string | null;
};

/** Days online, counted like the Vacancies block of the call screen (Amsterdam days, from the posted date or else the day first seen). */
function days(since: string | null, now: number): number | null {
  if (!since) return null;
  return daysOnline(since.length === 10 ? since : onlineSince({ first_seen_at: since }), now);
}

function httpUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const u = url.trim();
  if (/^https?:\/\//i.test(u)) return u;
  if (/^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(u)) return `https://${u}`;
  return null;
}

/** One row per contact, in the order given (the order of the list or the queue). */
export function buildSheetRows(
  contacts: SheetContact[],
  companies: Map<string, SheetCompany>,
  vacancies: Map<string, SheetVacancy[]>,
  callable: Set<string>,
  now = Date.now(),
  calls: SheetCall[] = [],
): SheetRow[] {
  const latest = latestCalls(calls);
  return contacts.flatMap((c) => {
    const company = companies.get(c.company_id);
    if (!company) return [];
    const open = [...(vacancies.get(c.company_id) ?? [])].sort((a, b) => (a.since ?? "9").localeCompare(b.since ?? "9"));
    const phone = c.phone?.trim() || company.generalPhone?.trim() || null;
    const links: SheetLink[] = [];
    for (const v of open) {
      const url = httpUrl(v.url);
      if (url && links.filter((l) => l.label !== "Website" && l.label !== "LinkedIn").length < 5) links.push({ label: v.title || "Vacancy", url });
    }
    const website = httpUrl(company.website);
    if (website) links.push({ label: "Website", url: website });
    const linkedin = httpUrl(c.linkedin_url) ?? httpUrl(company.linkedinUrl);
    if (linkedin) links.push({ label: "LinkedIn", url: linkedin });
    const oldest = open.map((v) => days(v.since, now)).filter((d): d is number => d !== null);
    const brief = parseRedFlags(company.redFlags);
    const opening = currentOpeningLine(
      company.openingLine,
      open.map((v) => ({ title: v.title, days: days(v.since, now) })),
    );
    return [
      {
        contactId: c.id,
        companyId: c.company_id,
        company: company.name,
        contact: c.full_name || c.email || "Unknown contact",
        title: c.title,
        phone,
        phoneKind: c.phone?.trim() ? "contact" : company.generalPhone?.trim() ? "general" : null,
        generalPhone: company.generalPhone?.trim() || null,
        openingLine: opening?.text ?? null,
        redFlags: brief.redFlags,
        whatTheyDo: cleanDescription(company.description) ?? brief.whatTheyDo,
        objection:
          brief.objections
            .map((o) => [o.objection && `Objection: ${o.objection}`, o.answer && `Answer: ${o.answer}`].filter(Boolean).join(" "))
            .join(" ") || null,
        question: brief.questions.join(" ") || null,
        roles: open.map((v) => v.title || "Vacancy"),
        vacancyCount: open.length,
        daysOpen: oldest.length ? Math.max(...oldest) : null,
        links,
        status: c.status,
        attempts: c.attempts,
        lastAttemptAt: c.last_attempt_at,
        callbackAt: c.callback_at,
        callable: callable.has(c.id),
        firstName: c.first_name ?? null,
        lastName: c.last_name ?? null,
        email: c.email,
        ownPhone: c.phone?.trim() || null,
        phoneWrong: Boolean(c.phone_wrong),
        lastOutcome: latest.byContact.get(c.id)?.outcome ?? null,
        lastOutcomeAt: latest.byContact.get(c.id)?.at ?? null,
        lastNote: latest.noteByCompany.get(c.company_id) ?? c.caller_note?.trim() ?? null,
        lastBy: latest.byCompany.get(c.company_id)?.by ?? null,
        nextAction: company.nextAction?.trim() || null,
        nextActionDate: company.nextActionDate ?? null,
      },
    ];
  });
}

function latestCalls(calls: SheetCall[]) {
  const byContact = new Map<string, SheetCall>();
  const byCompany = new Map<string, SheetCall>();
  const noteByCompany = new Map<string, string>();
  // Newest first, whatever the order given.
  for (const c of [...calls].sort((a, b) => b.at.localeCompare(a.at))) {
    if (c.contactId && !byContact.has(c.contactId)) byContact.set(c.contactId, c);
    if (!byCompany.has(c.companyId)) byCompany.set(c.companyId, c);
    const note = c.notes?.trim();
    if (note && !noteByCompany.has(c.companyId)) noteByCompany.set(c.companyId, note);
  }
  return { byContact, byCompany, noteByCompany };
}

/** One row per company: the contacts folded in, with what the sheet shows per company. */
export type SheetCompanyRow = {
  companyId: string;
  company: string;
  openingLine: string | null;
  redFlags: string[];
  whatTheyDo: string | null;
  objection: string | null;
  question: string | null;
  roles: string[];
  vacancyCount: number;
  daysOpen: number | null;
  links: SheetLink[];
  generalPhone: string | null;
  nextAction: string | null;
  nextActionDate: string | null;
  /** All contacts of the company, the ones to call first on top. */
  contacts: SheetRow[];
  /** The contact to open and hold when the row is opened: the first one that can be called, else the first. */
  leadContactId: string;
  /** Attempts of all contacts together. */
  attempts: number;
  lastOutcome: string | null;
  lastOutcomeAt: string | null;
  lastNote: string | null;
  lastBy: string | null;
  /** The earliest call back date of the contacts. */
  callbackAt: string | null;
  /** Somebody at this company can be called now. */
  callable: boolean;
};

/** Folds the contact rows into one row per company, in the order the companies first appear. */
export function groupSheetRows(rows: SheetRow[]): SheetCompanyRow[] {
  const groups = new Map<string, SheetRow[]>();
  for (const r of rows) groups.set(r.companyId, [...(groups.get(r.companyId) ?? []), r]);
  return [...groups.values()].map((contacts) => {
    // Callable contacts first, the rest in the order given.
    const ordered = [...contacts.filter((c) => c.callable), ...contacts.filter((c) => !c.callable)];
    const first = ordered[0];
    const called = contacts.filter((c) => c.lastOutcomeAt).sort((a, b) => b.lastOutcomeAt!.localeCompare(a.lastOutcomeAt!))[0];
    const callbacks = contacts.map((c) => c.callbackAt?.slice(0, 10)).filter((d): d is string => Boolean(d)).sort();
    return {
      companyId: first.companyId,
      company: first.company,
      openingLine: first.openingLine,
      redFlags: first.redFlags,
      whatTheyDo: first.whatTheyDo,
      objection: first.objection,
      question: first.question,
      roles: first.roles,
      vacancyCount: first.vacancyCount,
      daysOpen: first.daysOpen,
      links: first.links,
      generalPhone: first.generalPhone,
      nextAction: first.nextAction,
      nextActionDate: first.nextActionDate,
      contacts: ordered,
      leadContactId: first.contactId,
      attempts: contacts.reduce((n, c) => n + c.attempts, 0),
      lastOutcome: called?.lastOutcome ?? null,
      lastOutcomeAt: called?.lastOutcomeAt ?? null,
      lastNote: first.lastNote,
      lastBy: first.lastBy,
      callbackAt: callbacks[0] ?? null,
      callable: contacts.some((c) => c.callable),
    };
  });
}

// ---------------------------------------------------------------------------
// Filters (feedback Julius, f5d4375a)
// ---------------------------------------------------------------------------

export const sheetFilters = [
  { value: "all", label: "All" },
  { value: "callable", label: "Can call now" },
  { value: "callback_today", label: "Call back today" },
  { value: "no_answer", label: "No answer, 1 or 2 times" },
  { value: "interested", label: "Interested, no next step" },
] as const;

export type SheetFilter = (typeof sheetFilters)[number]["value"];

/**
 * Whether a company row passes a filter. today is YYYY-MM-DD.
 * Call back today: a call back date of today or earlier (a missed one still counts).
 * No answer, 1 or 2 times: a contact whose last call was No answer and who was called once or twice.
 * Interested, no next step: the last outcome is Reached: interested and no next action is set.
 */
export function matchesSheetFilter(row: SheetCompanyRow, filter: SheetFilter, today: string): boolean {
  switch (filter) {
    case "callable":
      return row.callable;
    case "callback_today":
      return row.contacts.some((c) => Boolean(c.callbackAt) && c.callbackAt!.slice(0, 10) <= today);
    case "no_answer":
      return row.contacts.some((c) => c.lastOutcome === "no_answer" && c.attempts >= 1 && c.attempts <= 2);
    case "interested":
      return row.lastOutcome === "reached_interested" && !row.nextAction;
    default:
      return true;
  }
}

/** The sheet as tab separated text, for Excel. */
export function sheetToTsv(rows: SheetRow[]): string {
  const head = [
    "Company",
    "Contact",
    "Job title",
    "Phone",
    "General number",
    "Opening line",
    "Open roles",
    "Vacancies",
    "Days open",
    "Red flags",
    "What they do",
    "Objection and answer",
    "Question",
    "Links",
    "Last outcome",
    "Attempts",
    "Call back",
    "Last note",
    "Last called by",
  ];
  const clean = (v: string | number | null) => (v === null ? "" : String(v).replace(/[\t\n\r]+/g, " "));
  return [
    head.join("\t"),
    ...rows.map((r) =>
      [
        r.company,
        r.contact,
        r.title,
        r.phone,
        r.generalPhone,
        r.openingLine,
        r.roles.join(", "),
        r.vacancyCount,
        r.daysOpen,
        r.redFlags.join(" "),
        r.whatTheyDo,
        r.objection,
        r.question,
        r.links.map((l) => l.url).join(" "),
        outcomeName(r.lastOutcome),
        r.attempts,
        r.callbackAt,
        r.lastNote,
        r.lastBy,
      ]
        .map(clean)
        .join("\t"),
    ),
  ].join("\n");
}
