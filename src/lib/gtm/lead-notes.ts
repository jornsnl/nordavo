/**
 * Opening line, red flags and general number written into "What they do"
 * ("OPENING LINE: ...", "Red flags: a; b", "General number: 030 ...") taken
 * out into their own fields. Claude did this when the add tools had no such
 * fields; the MCP still accepts it. Pure; mirrors the SQL function
 * sales_extract_lead_notes (migration 20261123310000_leads_links_roles.sql).
 */

const MARKERS = "(opening ?line|openingszin|opener|red ?flags?|rode vlaggen|general (?:phone )?number|algemeen (?:telefoon)?nummer|hoofdnummer|main number)";
const HAS_MARKER = new RegExp(`${MARKERS}\\s*\\**\\s*:`, "i");
const SPLIT_MARKER = new RegExp(`(\\*\\*|__)?\\b${MARKERS}(\\*\\*|__)?\\s*:`, "gi");
const LINE_MARKER = new RegExp(`^[\\s*#>_-]*${MARKERS}[\\s*_]*:[\\s*_]*`, "i");

export type LeadNotes = {
  /** The description without the marked parts (null when nothing is left). */
  description: string | null;
  opening_line: string | null;
  red_flags: string[];
  general_phone: string | null;
};

/** Null when the text has none of the markers. */
export function extractLeadNotes(text: string | null | undefined): LeadNotes | null {
  if (!text || !HAS_MARKER.test(text)) return null;
  const parts: Record<"description" | "opening_line" | "red_flags" | "general_phone", string[]> = {
    description: [],
    opening_line: [],
    red_flags: [],
    general_phone: [],
  };
  let section: keyof typeof parts = "description";
  for (let line of text.replace(SPLIT_MARKER, (m) => `\n${m}`).split("\n")) {
    const hit = LINE_MARKER.exec(line);
    if (hit) {
      const label = hit[1].toLowerCase();
      section = /^(opening|opener)/.test(label) ? "opening_line" : /^(red|rode)/.test(label) ? "red_flags" : "general_phone";
      line = line.slice(hit[0].length);
    }
    parts[section].push(line);
  }
  const flags = parts.red_flags
    .join("\n")
    .split(/\s*[;,\n]\s*/)
    .map((f) => f.replace(/^[\s\-*•.]+|[\s\-*•.]+$/g, ""))
    .filter((f) => f !== "" && !["none", "geen", "n/a", "-"].includes(f.toLowerCase()));
  const joined = (list: string[], sep: string) => list.join(sep).replace(/^[\s\n]+|[\s\n]+$/g, "") || null;
  return {
    description: joined(parts.description, "\n")?.replace(/\n{3,}/g, "\n\n") ?? null,
    opening_line: joined(parts.opening_line, " "),
    red_flags: flags,
    general_phone: joined(parts.general_phone, " ")?.replace(/[.\s]+$/, "") ?? null,
  };
}
