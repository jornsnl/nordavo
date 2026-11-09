// Adding people to the Academy in bulk (Academy: beheer-editor en mensen
// toevoegen): a pasted list or a CSV with name and e-mail, one person per
// line, optionally a start date. Pure, tested in tests/academy-people.test.ts.
// The server action is src/app/dashboard/academy/people/actions.ts.

import Papa from "papaparse";
import type { AcademyRole } from "@/lib/academy/database";

export type BulkPerson = { name: string; email: string; startDate: string | null };
export type BulkParseResult = { people: BulkPerson[]; errors: { line: number; message: string }[] };

const EMAIL = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** At most this many people per bulk add (one server action). */
export const BULK_LIMIT = 200;

export const ACADEMY_ROLES: { value: AcademyRole; label: string; description: string }[] = [
  { value: "candidate", label: "Candidate", description: "Only the open modules of the developer course; nothing of clients or placements." },
  { value: "developer", label: "Developer", description: "The developer course and their own placement." },
  { value: "client_admin", label: "Client admin", description: "Follows the client course, sees own placements and the progress of colleagues." },
  { value: "client_member", label: "Client member", description: "Another manager at the client; follows the client course." },
  { value: "client_reader", label: "Reader", description: "For example the client's board: only progress and scores, never answers or notes." },
];

export function isAcademyRole(value: unknown): value is AcademyRole {
  return typeof value === "string" && ACADEMY_ROLES.some((r) => r.value === value);
}

export function isClientRole(role: AcademyRole): boolean {
  return role === "client_admin" || role === "client_member" || role === "client_reader";
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/** Name from an address when none is given: "asha.rao@x.in" -> "Asha Rao". */
export function nameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "";
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function looksLikeHeader(cells: string[]): boolean {
  const lower = cells.map((c) => c.trim().toLowerCase());
  return lower.some((c) => ["email", "e-mail", "mail", "emailadres", "e-mailadres"].includes(c));
}

/**
 * Parse "Name, email[, start date]" lines, "email" lines, "Name <email>"
 * lines, or a CSV with a header row (name, email, start_date). Separators:
 * comma, semicolon or tab. Duplicates (same address) are reported once.
 */
export function parseBulkPeople(input: string): BulkParseResult {
  const people: BulkPerson[] = [];
  const errors: BulkParseResult["errors"] = [];
  const seen = new Set<string>();
  const text = input.replace(/^﻿/, "").trim();
  if (!text) return { people, errors };

  // A CSV with a header row goes through the CSV parser (quotes, one
  // separator); a pasted list is split per line, any separator per line.
  const lines = text.split(/\r?\n/);
  const firstCells = lines[0].split(/[,;\t]/).map((c) => c.trim());
  const hasHeader = looksLikeHeader(firstCells);
  const rows = hasHeader
    ? Papa.parse<string[]>(text, { delimitersToGuess: [",", ";", "\t"], skipEmptyLines: false }).data.map((row) =>
        row.map((cell) => String(cell ?? "").trim()),
      )
    : lines.map((l) => l.split(/[,;\t]/).map((c) => c.trim()));

  let columns = { name: -1, email: -1, start: -1 };
  let start = 0;
  if (hasHeader && rows.length > 0) {
    const header = rows[0].map((c) => c.toLowerCase());
    columns = {
      name: header.findIndex((c) => ["name", "naam", "full_name", "full name"].includes(c)),
      email: header.findIndex((c) => ["email", "e-mail", "mail", "emailadres", "e-mailadres"].includes(c)),
      start: header.findIndex((c) => ["start_date", "start date", "startdatum", "start"].includes(c)),
    };
    start = 1;
  }

  for (let i = start; i < rows.length; i++) {
    const line = i + 1;
    if (rows[i].every((c) => c === "")) continue;

    let name = "";
    let email = "";
    let startDate: string | null = null;

    if (columns.email >= 0) {
      email = rows[i][columns.email] ?? "";
      name = columns.name >= 0 ? (rows[i][columns.name] ?? "") : "";
      startDate = columns.start >= 0 ? rows[i][columns.start] || null : null;
    } else {
      const joined = rows[i].join(" ");
      const angle = /^(.*)<([^>]+)>\s*$/.exec(joined);
      if (angle) {
        name = angle[1].replace(/[",;]/g, " ").trim();
        email = angle[2];
      } else {
        const emailCell = rows[i].findIndex((c) => EMAIL.test(c));
        if (emailCell >= 0) {
          email = rows[i][emailCell];
          // A cell that starts like a date is the start date (checked below).
          const dateLike = (c: string) => /^\d{4}-\d/.test(c);
          name = rows[i].filter((c, index) => index !== emailCell && !dateLike(c)).join(" ").trim();
          startDate = rows[i].find(dateLike) ?? null;
        } else {
          email = rows[i].join(" ");
        }
      }
    }

    email = normalizeEmail(email);
    if (!EMAIL.test(email)) {
      errors.push({ line, message: `No valid e-mail address on line ${line}.` });
      continue;
    }
    if (startDate && !DATE.test(startDate)) {
      errors.push({ line, message: `Start date on line ${line} is not YYYY-MM-DD.` });
      continue;
    }
    if (seen.has(email)) {
      errors.push({ line, message: `${email} is on the list twice; added once.` });
      continue;
    }
    seen.add(email);
    people.push({ name: name.replace(/\s+/g, " ").slice(0, 120) || nameFromEmail(email), email, startDate });
  }

  if (people.length > BULK_LIMIT) {
    errors.push({ line: 0, message: `At most ${BULK_LIMIT} people at once; split the list.` });
    return { people: people.slice(0, BULK_LIMIT), errors };
  }
  return { people, errors };
}
