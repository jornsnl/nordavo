// Finding the exact piece of text a suggestion is about, for Claude's
// content_suggest_text (src/lib/mcp/content-tools.ts). Claude names the text,
// not an offset; the offset is counted here in characters (code points),
// the way the database counts them. Pure, unit tested in tests/content-mcp.test.ts.

import { toCodePointOffset } from "@/lib/content/diff";

export type MatchResult = { ok: true; start: number; utf16Start: number } | { ok: false; error: string };

/** All UTF-16 positions where needle occurs in text (overlapping occurrences included). */
export function occurrences(text: string, needle: string): number[] {
  if (!needle) return [];
  const found: number[] = [];
  for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + 1)) found.push(at);
  return found;
}

/**
 * Where the original text is in the field. With several matches Claude has
 * to say which one (occurrence, counted from 1); a text that is not there is
 * refused, so a suggestion never lands on the wrong words.
 */
export function locateOriginal(text: string, original: string, occurrence?: number): MatchResult {
  if (!original) {
    if (occurrence !== undefined) return { ok: false, error: "An empty original text has no occurrences." };
    // Adding text: at the end of the field.
    return { ok: true, start: Array.from(text).length, utf16Start: text.length };
  }
  const hits = occurrences(text, original);
  if (hits.length === 0) return { ok: false, error: "The original text is not in this field (any more). Read the post again and copy the text exactly." };
  if (occurrence !== undefined) {
    const at = hits[occurrence - 1];
    if (at === undefined) return { ok: false, error: `The original text occurs ${hits.length} times; occurrence ${occurrence} does not exist.` };
    return { ok: true, start: toCodePointOffset(text, at), utf16Start: at };
  }
  if (hits.length > 1) return { ok: false, error: `The original text occurs ${hits.length} times. Pass occurrence (1 to ${hits.length}) or a longer original text.` };
  return { ok: true, start: toCodePointOffset(text, hits[0]), utf16Start: hits[0] };
}
