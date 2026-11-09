// iCalendar (RFC 5545) for the calendar subscription of a placement:
// all-day events for holidays, the moments of the timeline and approved
// leave. Pure, tested in tests/academy-placement.test.ts.

import { addDaysIso } from "@/lib/academy/time";

export type IcsEvent = {
  uid: string;
  /** YYYY-MM-DD, first day. */
  start: string;
  /** YYYY-MM-DD, last day (inclusive). */
  end: string;
  summary: string;
  description?: string | null;
  categories?: string[];
};

/** Escape TEXT values: backslash, semicolon, comma and newlines. */
export function escapeIcsText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Fold a content line at 75 octets (continuation lines start with a space). */
export function foldIcsLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  let size = 0;
  for (const char of line) {
    const bytes = encoder.encode(char).length;
    const limit = parts.length === 0 ? 75 : 74;
    if (size + bytes > limit) {
      parts.push(current);
      current = "";
      size = 0;
    }
    current += char;
    size += bytes;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

const compactDate = (dateIso: string) => dateIso.replace(/-/g, "");

function stamp(now: Date): string {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/** A whole calendar, CRLF line endings, folded lines. */
export function buildIcs(input: { name: string; events: IcsEvent[]; now?: Date; domain?: string }): string {
  const now = input.now ?? new Date();
  const domain = input.domain ?? "nordavo.nl";
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Nordavo//Academy//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(input.name)}`,
    "X-PUBLISHED-TTL:PT12H",
    "REFRESH-INTERVAL;VALUE=DURATION:PT12H",
  ];
  for (const event of input.events) {
    const last = event.end < event.start ? event.start : event.end;
    lines.push(
      "BEGIN:VEVENT",
      `UID:${event.uid}@${domain}`,
      `DTSTAMP:${stamp(now)}`,
      `DTSTART;VALUE=DATE:${compactDate(event.start)}`,
      // DTEND of an all-day event is exclusive: the day after the last day.
      `DTEND;VALUE=DATE:${compactDate(addDaysIso(last, 1))}`,
      `SUMMARY:${escapeIcsText(event.summary)}`,
      "TRANSP:TRANSPARENT",
    );
    if (event.description) lines.push(`DESCRIPTION:${escapeIcsText(event.description)}`);
    if (event.categories?.length) lines.push(`CATEGORIES:${event.categories.map(escapeIcsText).join(",")}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(foldIcsLine).join("\r\n")}\r\n`;
}
