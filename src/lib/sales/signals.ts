// Signals of a company as the call screen shows them (feedback Julius,
// 306c7214): one fixed place with the kind, the date and the source, the
// strongest first. Pure, safe everywhere; tested in tests/call-brief.test.ts.
//
// A signal is a row of public.signals. Its kind (signals.type) comes from the
// choice list "Signal types" under Settings, Sales lists: the order of that
// list is the strength (first is strongest), and a new kind is a new option
// there plus rows with that type, no code change. A kind the list does not
// know still shows, last, with its own name.

import { daysOnline, onlineSince } from "@/lib/sales/vacancies";

/** Kinds that are a vacancy: they also show under Vacancies. */
export const vacancyKinds = ["vacature", "lang_open", "meerdere_rollen", "remote_extern", "freelance", "overig"] as const;

/** A vacancy open longer than this counts as "open for long" (gtm/signals.ts uses the same 60). */
export const LONG_OPEN_DAYS = 60;

/** The built in kinds, strongest first: the default order of Settings, Sales lists. */
export const defaultSignalKinds: { value: string; label: string; description: string; tone: "neutral" | "brand" | "accent" | "success" }[] = [
  { value: "funding", label: "Funding", description: "The company raised money: budget to grow the team.", tone: "success" },
  { value: "nieuwe_cto", label: "New CTO", description: "A new CTO or head of engineering: a new look at how the team is built.", tone: "success" },
  { value: "employee_growth", label: "Employee growth", description: "The number of employees is growing.", tone: "success" },
  { value: "meerdere_rollen", label: "Multiple roles", description: "Several tech roles open at the same time.", tone: "accent" },
  { value: "lang_open", label: "Open for long", description: "A tech vacancy that stays open for more than 60 days.", tone: "accent" },
  { value: "vacature", label: "New vacancy", description: "A tech vacancy, the newest one.", tone: "brand" },
  { value: "remote_extern", label: "Remote or external team", description: "The vacancy allows a remote or external team.", tone: "accent" },
  { value: "freelance", label: "Freelance assignment", description: "A freelance assignment instead of a hire.", tone: "neutral" },
  { value: "overig", label: "Other", description: "Any other signal.", tone: "neutral" },
];

export type SignalRow = {
  id: string;
  type: string;
  title: string | null;
  source: string | null;
  source_url: string | null;
  posted_at: string | null;
  first_seen_at: string | null;
  closed_at?: string | null;
};

export type SignalKindOption = { value: string; label: string; hidden?: boolean };

export type CallSignal = {
  id: string;
  type: string;
  label: string;
  /** What happened: the vacancy title, the funding round, ... */
  detail: string | null;
  /** YYYY-MM-DD the signal happened (posted, else first seen). */
  date: string | null;
  /** Days since then, for vacancies. */
  days: number | null;
  /** Where it came from: Indeed, LinkedIn, a site, or null. */
  source: string | null;
  url: string | null;
  /** Worked out from the vacancies instead of stored as its own row. */
  derived: boolean;
};

export type SignalSummary = {
  signals: CallSignal[];
  /** The strongest one, or null. */
  strongest: CallSignal | null;
  /** The strongest as one phrase, for the prio line. */
  strongestText: string | null;
};

/** Indeed, LinkedIn or the host of the link; else the source when it says something. */
export function signalSource(url: string | null | undefined, source: string | null | undefined): string | null {
  if (url) {
    try {
      const host = new URL(url).hostname.replace(/^www\./, "");
      if (/indeed\./.test(host)) return "Indeed";
      if (/linkedin\.com$/.test(host)) return "LinkedIn";
      return host;
    } catch {
      // Not a link: use the source below.
    }
  }
  if (source === "linkedin") return "LinkedIn";
  if (source === "indeed") return "Indeed";
  return null;
}

function prettify(type: string): string {
  const t = type.replace(/_/g, " ").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function httpUrl(url: string | null): string | null {
  return url && /^https?:\/\//i.test(url) ? url : null;
}

/**
 * The signals of a company, strongest first. `kinds` is the choice list
 * "Signal types" in its order (strongest first; hidden kinds stay out).
 */
export function buildSignals(rows: SignalRow[], kinds: SignalKindOption[], now = Date.now()): SignalSummary {
  const open = rows.filter((r) => !r.closed_at);
  const labelOf = new Map(kinds.map((k) => [k.value, k.label]));
  const hidden = new Set(kinds.filter((k) => k.hidden).map((k) => k.value));
  const rank = (type: string) => {
    const i = kinds.findIndex((k) => k.value === type);
    return i === -1 ? kinds.length : i;
  };
  const make = (r: SignalRow, extra: Partial<CallSignal> = {}): CallSignal => {
    const date = onlineSince({ posted_at: r.posted_at, first_seen_at: r.first_seen_at });
    return {
      id: r.id,
      type: r.type,
      label: labelOf.get(r.type) ?? prettify(r.type),
      detail: r.title,
      date,
      days: vacancyKindSet.has(r.type) ? daysOnline(date, now) : null,
      source: signalSource(r.source_url, r.source),
      url: httpUrl(r.source_url),
      derived: false,
      ...extra,
    };
  };

  const out: CallSignal[] = [];
  const vacancies = open.filter((r) => r.type === "vacature");
  if (vacancies.length > 0) {
    const since = (r: SignalRow) => onlineSince({ posted_at: r.posted_at, first_seen_at: r.first_seen_at }) ?? "";
    const sorted = [...vacancies].sort((a, b) => since(b).localeCompare(since(a)));
    const newest = sorted[0];
    const more = vacancies.length - 1;
    out.push(make(newest, { detail: more > 0 ? `${newest.title ?? "Vacancy"} (+${more} more)` : newest.title }));
    const oldest = sorted[sorted.length - 1];
    const oldestDays = daysOnline(since(oldest), now);
    if (oldestDays !== null && oldestDays > LONG_OPEN_DAYS && !open.some((r) => r.type === "lang_open")) {
      out.push(make(oldest, { type: "lang_open", label: labelOf.get("lang_open") ?? "Open for long", derived: true, days: oldestDays }));
    }
  }
  for (const r of open) {
    if (r.type !== "vacature") out.push(make(r));
  }

  const signals = out
    .filter((s) => !hidden.has(s.type))
    .sort((a, b) => rank(a.type) - rank(b.type) || (b.date ?? "").localeCompare(a.date ?? ""));
  const strongest = signals[0] ?? null;
  const strongestText = strongest
    ? [strongest.label, strongest.detail, strongest.days !== null ? `${strongest.days} days open` : null].filter(Boolean).join(", ")
    : null;
  return { signals, strongest, strongestText };
}

const vacancyKindSet = new Set<string>(vacancyKinds);
