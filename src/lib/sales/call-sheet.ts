// The call list as a spreadsheet, next to the call screen (feedback Julius,
// 896704e2): one row per contact with company, contact, phone, opening
// line, open roles, number of vacancies, days open and links. Pure, safe for
// client components; tested in tests/call-sheet.test.ts.

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
  openingLine: string | null;
  redFlags: string[];
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
};

function days(since: string | null, now: number): number | null {
  if (!since) return null;
  const t = new Date(since.length === 10 ? `${since}T00:00:00Z` : since).getTime();
  return Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / 86_400_000)) : null;
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
): SheetRow[] {
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
    return [
      {
        contactId: c.id,
        companyId: c.company_id,
        company: company.name,
        contact: c.full_name || c.email || "Unknown contact",
        title: c.title,
        phone,
        phoneKind: c.phone?.trim() ? "contact" : company.generalPhone?.trim() ? "general" : null,
        openingLine: company.openingLine,
        redFlags: company.redFlags,
        roles: open.map((v) => v.title || "Vacancy"),
        vacancyCount: open.length,
        daysOpen: oldest.length ? Math.max(...oldest) : null,
        links,
        status: c.status,
        attempts: c.attempts,
        lastAttemptAt: c.last_attempt_at,
        callbackAt: c.callback_at,
        callable: callable.has(c.id),
      },
    ];
  });
}

/** The sheet as tab separated text, for Excel. */
export function sheetToTsv(rows: SheetRow[]): string {
  const head = ["Company", "Contact", "Job title", "Phone", "Opening line", "Open roles", "Vacancies", "Days open", "Red flags", "Links"];
  const clean = (v: string | number | null) => (v === null ? "" : String(v).replace(/[\t\n\r]+/g, " "));
  return [
    head.join("\t"),
    ...rows.map((r) =>
      [r.company, r.contact, r.title, r.phone, r.openingLine, r.roles.join(", "), r.vacancyCount, r.daysOpen, r.redFlags.join(", "), r.links.map((l) => l.url).join(" ")]
        .map(clean)
        .join("\t"),
    ),
  ].join("\n");
}
