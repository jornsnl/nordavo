// The cheat sheet on the call screen (feedback Julius, 21637c48): foldable
// sections with the USPs, a price indication, the starter fee, the trade off
// and the days for meetings. The text is Julius's: he edits it under
// Settings, Sales lists (table sales_call_cheatsheet). Until then the call
// screen shows the draft below. Pure, safe everywhere; tested in
// tests/call-brief.test.ts.
//
// The drafts only use what the repository already says (docs/gtm-briefing.md,
// src/lib/ai/prompts/qualify.ts). What is not known is a [placeholder] in
// square brackets: nothing is made up.

import type { CheatsheetRow } from "@/lib/sales/call-screen-database";

export type CheatsheetSection = {
  key: string;
  title: string;
  body: string;
  hidden: boolean;
  /** One of the five built in sections. */
  builtin: boolean;
  /** Still the draft text of the code, nobody saved it yet. */
  draft: boolean;
};

export const defaultCheatsheet: { key: string; title: string; body: string }[] = [
  {
    key: "usps",
    title: "USPs",
    body: [
      "Medior and senior developers and data professionals from Bangalore, fulltime in your team.",
      "Start within 3 weeks.",
      "The developer works as a normal team member: same standups, tools and codebase.",
      "Nordavo does recruitment, technical screening, HR, payroll, laptop and guidance.",
      "Replacement guarantee within 30 days.",
      "[Add or remove USPs here: Settings, Sales lists, Call cheat sheet.]",
    ].join("\n"),
  },
  {
    key: "price",
    title: "Price indication",
    body: [
      "From EUR 2,500 per month all in, usually EUR 3,000 to 3,500 for medior and senior, depending on role and requirements.",
      "About 50% cheaper than a comparable Dutch hire.",
      "Notice period one month, the first month can be cancelled right away.",
      "[Confirm that a caller may quote these numbers, and what to say when asked for more.]",
    ].join("\n"),
  },
  {
    key: "starter_fee",
    title: "Starter fee",
    body: "[Fill in: how much the starter fee is, when it is paid and what it covers.]",
  },
  {
    key: "trade_off",
    title: "Trade-off",
    body: [
      "The developer usually does not speak with your customers.",
      "[Fill in: how to explain this and what to answer when it is a problem for them.]",
    ].join("\n"),
  },
  {
    key: "meetings",
    title: "Meetings",
    body: "Meetings can be planned on Tuesday, Wednesday and Friday, during the day.\n[Fill in the hours, and who the meeting is with.]",
  },
];

/** The built in sections overridden by the stored rows, plus extra stored sections, in order. */
export function mergeCheatsheet(rows: Pick<CheatsheetRow, "key" | "title" | "body" | "position" | "hidden">[]): CheatsheetSection[] {
  const stored = new Map(rows.map((r) => [r.key, r]));
  const merged: (CheatsheetSection & { position: number })[] = defaultCheatsheet.map((d, i) => {
    const r = stored.get(d.key);
    return {
      key: d.key,
      title: r?.title ?? d.title,
      body: r?.body ?? d.body,
      hidden: r?.hidden ?? false,
      builtin: true,
      draft: !r,
      position: r?.position ?? (i + 1) * 10,
    };
  });
  for (const r of rows) {
    if (defaultCheatsheet.some((d) => d.key === r.key)) continue;
    merged.push({ key: r.key, title: r.title, body: r.body, hidden: r.hidden, builtin: false, draft: false, position: r.position });
  }
  return merged.sort((a, b) => a.position - b.position).map((s) => ({ key: s.key, title: s.title, body: s.body, hidden: s.hidden, builtin: s.builtin, draft: s.draft }));
}

/** A key for an extra section from its title: "Objections" to "objections". */
export function cheatsheetKeyFromTitle(title: string, taken: string[]): string {
  const base =
    title
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 36) || "section";
  if (!taken.includes(base)) return base;
  for (let n = 2; n < 100; n++) if (!taken.includes(`${base}_${n}`)) return `${base}_${n}`;
  return `${base}_${Date.now() % 1000}`;
}

/** True when the text still has a [placeholder] to fill in. */
export function hasPlaceholder(body: string): boolean {
  return /\[[^\]]+\]/.test(body);
}
