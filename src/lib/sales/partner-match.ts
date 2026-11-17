import { cleanLinkedinUrl, normalizeEmail, normalizeLinkedin, normalizePhone } from "@/lib/gtm/normalize";

/**
 * Partner duplicates and filling in (feedback Julius 68123bae): add_partner
 * checks on the same name, e-mail or LinkedIn page, and a known partner is
 * filled in where a field is empty, never overwritten. Pure, so the tests use it.
 */

export type PartnerFields = {
  name: string;
  company_name: string | null;
  email: string | null;
  phone: string | null;
  linkedin_url: string | null;
  notes: string | null;
};

export type PartnerInput = {
  name: string;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
  linkedin_url?: string | null;
  notes?: string | null;
};

export type PartnerMatchReason = "email" | "linkedin" | "name";

/** "Jöhn  Sportel" and "john sportel" are the same name. */
export function partnerNameKey(name: string | null | undefined): string {
  return (name ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Escapes % and _ so a name matches itself in ilike. */
export function likeExact(value: string): string {
  return value.replace(/[\\%_]/g, (m) => `\\${m}`);
}

/** The partner input as it is stored: normalized e-mail, phone and LinkedIn link, trimmed text. */
export function cleanPartnerInput(input: PartnerInput) {
  const text = (v: string | null | undefined) => v?.trim() || null;
  const email = text(input.email);
  const phone = text(input.phone);
  const linkedin = text(input.linkedin_url);
  return {
    name: input.name.trim(),
    company_name: text(input.company),
    email: email ? (normalizeEmail(email) ?? email) : null,
    phone: phone ? (normalizePhone(phone) ?? phone) : null,
    linkedin_url: linkedin ? (cleanLinkedinUrl(linkedin) ?? linkedin) : null,
    notes: text(input.notes),
  };
}

/** Why an existing partner is the same person as the input, or null. E-mail and LinkedIn are stronger than the name. */
export function partnerMatchReason(existing: PartnerFields, input: PartnerInput): PartnerMatchReason | null {
  const email = normalizeEmail(input.email);
  if (email && normalizeEmail(existing.email) === email) return "email";
  const linkedin = normalizeLinkedin(input.linkedin_url);
  if (linkedin && normalizeLinkedin(existing.linkedin_url) === linkedin) return "linkedin";
  const name = partnerNameKey(input.name);
  if (name && partnerNameKey(existing.name) === name) return "name";
  return null;
}

/** The best match of a few candidates: e-mail, then LinkedIn, then name. */
export function bestPartnerMatch<T extends PartnerFields>(
  candidates: T[],
  input: PartnerInput,
): { partner: T; reason: PartnerMatchReason } | null {
  const rank: PartnerMatchReason[] = ["email", "linkedin", "name"];
  let best: { partner: T; reason: PartnerMatchReason } | null = null;
  for (const partner of candidates) {
    const reason = partnerMatchReason(partner, input);
    if (reason && (!best || rank.indexOf(reason) < rank.indexOf(best.reason))) best = { partner, reason };
  }
  return best;
}

const NOTES_MAX = 5000;

/**
 * What a known partner gets from a second add_partner: only fields that are
 * empty. Notes are never replaced: new text is added below the old one, unless
 * it is already in there or would not fit.
 */
export function partnerFillPatch(
  existing: PartnerFields,
  input: PartnerInput,
  today: string,
): { patch: Partial<Record<keyof Omit<PartnerFields, "name">, string>>; skipped: string[] } {
  const clean = cleanPartnerInput(input);
  const patch: Partial<Record<keyof Omit<PartnerFields, "name">, string>> = {};
  const skipped: string[] = [];
  for (const key of ["company_name", "email", "phone", "linkedin_url"] as const) {
    const value = clean[key];
    if (!value) continue;
    if (!existing[key]?.trim()) patch[key] = value;
    else if (key === "email" ? normalizeEmail(existing[key]) !== value : existing[key]!.trim().toLowerCase() !== value.toLowerCase())
      skipped.push(key);
  }
  if (clean.notes) {
    const old = existing.notes?.trim() ?? "";
    if (!old) patch.notes = clean.notes.slice(0, NOTES_MAX);
    else if (!old.includes(clean.notes)) {
      const next = `${old}\n\n${today}: ${clean.notes}`;
      if (next.length <= NOTES_MAX) patch.notes = next;
      else skipped.push("notes");
    }
  }
  return { patch, skipped };
}
