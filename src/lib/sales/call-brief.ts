// What the call screen and the call sheet show about a company, cleaned up
// for the caller (feedback Julius: red flags, What they do, the opening line
// and the prio line). Pure, safe everywhere; tested in tests/call-brief.test.ts.
//
// The import and Claude store everything in companies.red_flags (text[]) as
// loose pieces: "Label: text" items, and sentences that were cut at the
// commas ("Hoe oplossen: Developer werkt alleen met test data", "geen toegang
// tot productie", "Nordavo regelt een verwerkersovereenkomst"). The stored
// data stays as it is; this module reads it back into whole sentences and
// sorts it into what a caller needs.

export type RedFlagBrief = {
  /** Real risks, as whole sentences. */
  redFlags: string[];
  /** What the company does, when it was stored among the flags. */
  whatTheyDo: string | null;
  /** An objection the company may raise, with the answer to give. */
  objections: { objection: string; answer: string | null }[];
  /** Questions to ask in the conversation. */
  questions: string[];
  /** Company facts that are not risks (employee count). */
  facts: string[];
};

type Kind = "doing" | "objection" | "answer" | "question" | "fact" | "hidden" | "flag";

/** Label (lower case) of a "Label: text" item to what it is. Anything else labelled is a real red flag. */
const labelKinds: Record<string, Kind> = {
  "wat doet het bedrijf": "doing",
  "wat doet het bedrijf?": "doing",
  "what they do": "doing",
  "waarom lastiger": "objection",
  bezwaar: "objection",
  "hoe oplossen": "answer",
  oplossing: "answer",
  "vraag in het gesprek": "question",
  "vraag voor het gesprek": "question",
  vraag: "question",
  "medewerkers (linkedin)": "fact",
  medewerkers: "fact",
  fte: "fact",
  // Import bookkeeping, nothing for the caller.
  "toelichting check": "hidden",
  "zekerheid linkedin match": "hidden",
  "staat al op bellijst": "hidden",
};

const factLabels: Record<string, string> = {
  "medewerkers (linkedin)": "Employees (LinkedIn)",
  medewerkers: "Employees",
  fte: "Employees",
};

const SENTENCE_KINDS: Kind[] = ["doing", "objection", "answer", "question"];

/** A range like "150 tot 500 FTE" or "51-200 medewerkers": an employee count, not a risk. */
const employeeRange = /^\d[\d.]*\s*(?:tot|-|–|to)\s*\d[\d.]*\s*(?:fte|medewerkers|employees)\b/i;

const ELLIPSIS = /(?:…|\.{3})\s*$/;

/** A whole sentence: no cut off ending, first letter capital, ends with a full stop. */
export function sentence(text: string): string {
  let t = text.replace(/\s+/g, " ").trim();
  if (!t) return "";
  const cut = ELLIPSIS.test(t);
  if (cut) {
    t = t.replace(ELLIPSIS, "").trim();
    // Cut off in the middle of a sentence: keep what was complete.
    const end = Math.max(t.lastIndexOf(". "), t.lastIndexOf("? "), t.lastIndexOf("! "));
    if (end > 0) t = t.slice(0, end + 1);
  }
  t = t.replace(/[\s,;:]+$/, "");
  t = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

type Group = { kind: Kind; label: string | null; parts: string[] };

function startsLower(text: string): boolean {
  const c = text.charAt(0);
  return c !== "" && c === c.toLowerCase() && c !== c.toUpperCase();
}

/** Puts the loose pieces of companies.red_flags back together and sorts them. */
export function parseRedFlags(flags: readonly string[] | null | undefined): RedFlagBrief {
  const groups: Group[] = [];
  for (const raw of flags ?? []) {
    const item = raw.replace(/\s+/g, " ").trim();
    if (!item) continue;
    const labelled = /^([^:]{2,60}):\s*(.*)$/.exec(item);
    if (labelled) {
      const label = labelled[1].trim();
      const kind = labelKinds[label.toLowerCase()] ?? "flag";
      groups.push({ kind, label, parts: labelled[2] ? [labelled[2].trim()] : [] });
      continue;
    }
    const prev = groups[groups.length - 1];
    // A piece without label that goes on with the sentence before it.
    if (prev && (SENTENCE_KINDS.includes(prev.kind) || (prev.kind === "flag" && startsLower(item)))) {
      prev.parts.push(item);
      continue;
    }
    groups.push({ kind: employeeRange.test(item) ? "fact" : "flag", label: null, parts: [item] });
  }

  const brief: RedFlagBrief = { redFlags: [], whatTheyDo: null, objections: [], questions: [], facts: [] };
  const answers: string[] = [];
  const objections: string[] = [];
  for (const g of groups) {
    const body = g.parts.join(", ");
    switch (g.kind) {
      case "flag": {
        const text = g.label ? `${g.label}: ${body}` : body;
        const s = sentence(text.replace(/:\s*$/, ""));
        if (s && !brief.redFlags.includes(s)) brief.redFlags.push(s);
        break;
      }
      case "doing":
        if (!brief.whatTheyDo && body) brief.whatTheyDo = sentence(body);
        break;
      case "objection":
        if (body) objections.push(sentence(body));
        break;
      case "answer":
        if (body) answers.push(sentence(body));
        break;
      case "question":
        if (body) brief.questions.push(sentence(body));
        break;
      case "fact": {
        const label = g.label ? (factLabels[g.label.toLowerCase()] ?? g.label) : null;
        brief.facts.push(label ? `${label}: ${body}` : body);
        break;
      }
      default:
        break;
    }
  }
  brief.objections = objections.map((objection, i) => ({ objection, answer: answers[i] ?? null }));
  // An answer without an objection stays visible as its own pair.
  for (const a of answers.slice(objections.length)) brief.objections.push({ objection: "", answer: a });
  return brief;
}

const sourceLine = /^(?:bellijst\b|bronnen?\s*:|sources?\s*:|prio\s*\(leadlijst\)|lijst\s*:|scrape\b)/i;

/** What the company does: the description without source and call list lines. Null when nothing real is left. */
export function cleanDescription(description: string | null | undefined): string | null {
  if (!description) return null;
  const kept = description
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !sourceLine.test(l));
  const text = kept.join("\n").trim();
  return text.length > 0 ? text : null;
}

// ---------------------------------------------------------------------------
// Opening line
// ---------------------------------------------------------------------------

export type LineVacancy = { title: string | null; days: number | null };

const dutchNumbers = ["", "een", "twee", "drie", "vier", "vijf", "zes", "zeven", "acht", "negen", "tien", "elf", "twaalf"];

/** "sinds gisteren", "al 22 dagen" or "al ruim drie maanden", for the days a vacancy is open. */
export function durationPhrase(days: number): string {
  if (days <= 0) return "sinds vandaag";
  if (days === 1) return "sinds gisteren";
  if (days >= 60 && days <= 365) {
    const months = Math.floor(days / 30);
    return `al ruim ${dutchNumbers[months] || months} maanden`;
  }
  return `al ${days} dagen`;
}

// The time bound pieces the opening line generator writes.
const timeBound = [
  /\bal (?:ruim |bijna |ongeveer |meer dan )?\d+ dagen\b/i,
  /\bal (?:ruim |bijna |ongeveer |meer dan )?(?:een|twee|drie|vier|vijf|zes|zeven|acht|negen|tien|elf|twaalf|\d+) (?:weken|maanden)\b/i,
  /\bsinds (?:vorige week|afgelopen week|gisteren|vandaag|een paar dagen|enkele dagen|kort)\b/i,
];

export type OpeningLine = {
  text: string;
  /** The days open the line now says, null when the line has no time in it. */
  days: number | null;
  /** The line is about a vacancy that is no longer open. */
  outdated: boolean;
};

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9+#]+/g, " ").trim();
}

/** The open vacancy a line is about: its title is in the line, else the only one, else the oldest. */
export function vacancyForLine(line: string, vacancies: LineVacancy[]): LineVacancy | null {
  const open = vacancies.filter((v) => v.days !== null);
  if (open.length === 0) return null;
  const text = ` ${norm(line)} `;
  const hit = open
    .filter((v) => v.title && text.includes(` ${norm(v.title)} `))
    .sort((a, b) => (b.title?.length ?? 0) - (a.title?.length ?? 0))[0];
  if (hit) return hit;
  if (open.length === 1) return open[0];
  return [...open].sort((a, b) => (b.days ?? 0) - (a.days ?? 0))[0];
}

/**
 * The opening line as it is true today. The stored line says "al 22 dagen"
 * from the day it was written; here the days are counted again from the
 * vacancy (the same date the Vacancies block uses). A line without time in
 * it is returned as it is.
 */
export function currentOpeningLine(stored: string | null | undefined, vacancies: LineVacancy[]): OpeningLine | null {
  const line = stored?.trim();
  if (!line) return null;
  const bound = timeBound.find((re) => re.test(line));
  if (!bound) return { text: line, days: null, outdated: false };
  const vacancy = vacancyForLine(line, vacancies);
  if (!vacancy || vacancy.days === null) return { text: line, days: null, outdated: true };
  return { text: line.replace(bound, durationPhrase(vacancy.days)), days: vacancy.days, outdated: false };
}

// ---------------------------------------------------------------------------
// Prio line
// ---------------------------------------------------------------------------

/**
 * One line that says why a company has its prio: the reason Julius or Claude
 * wrote (companies.prio_reason), else built from the strongest signal and the
 * real red flags, which count against the prio.
 */
export function prioLine(input: {
  reason: string | null | undefined;
  strongestSignal: string | null;
  redFlags: string[];
}): string {
  const reason = input.reason?.replace(/\s+/g, " ").trim();
  const parts: string[] = [];
  if (reason) parts.push(sentence(reason));
  else if (input.strongestSignal) parts.push(sentence(`Strongest signal: ${input.strongestSignal}`));
  else parts.push("No signal known.");
  const n = input.redFlags.length;
  if (n > 0) {
    const names = input.redFlags
      .slice(0, 2)
      .map((f) => f.replace(/[.!?]$/, "").split(/:\s/)[0])
      .join(", ");
    parts.push(`${n} red ${n === 1 ? "flag" : "flags"} count against it (${names}${n > 2 ? ", ..." : ""}).`);
  }
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Numbers to call
// ---------------------------------------------------------------------------

export type CallNumbers = {
  /** The mobile of the contact, else (or when it was marked wrong) the general number. */
  dial: { number: string; kind: "contact" | "general"; href: string } | null;
  /** The general number as a fallback next to the mobile of the contact. */
  generalDial: { number: string; href: string } | null;
};

/**
 * The numbers for the call button of one contact (feedback Julius, 1b9e7af7):
 * the mobile of the contact first, and at every contact the general number of
 * the company as the fallback. A mobile marked as wrong is not offered.
 */
export function callNumbers(
  person: { phone: string | null; phoneWrong: boolean },
  generalPhone: string | null,
  href: (number: string) => string,
): CallNumbers {
  const mobile = person.phone?.trim() && !person.phoneWrong ? person.phone.trim() : null;
  const general = generalPhone?.trim() || null;
  const number = mobile || general;
  return {
    dial: number ? { number, kind: mobile ? "contact" : "general", href: href(number) } : null,
    generalDial: mobile && general && general !== mobile ? { number: general, href: href(general) } : null,
  };
}
