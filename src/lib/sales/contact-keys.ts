// How the portal recognises the same person (feedback Julius, November 2026):
// the LinkedIn profile link (any case, with or without https://), the
// LinkedIn member id of an Apify link (linkedin.com/in/ACwAA...), the email
// at the company, and as a last resort the name at the company. Pure, unit
// tested; the lookups are in findSalesContact (src/lib/sales/contact-match.ts).

import { cleanLinkedinUrl, isLinkedinCaseRepair, linkedinMemberUrn, normalizeEmail, normalizeLinkedin } from "@/lib/gtm/normalize";
import type { ContactRole } from "@/lib/sales/database";

export type PersonKeys = {
  /** The link to store: https://www.linkedin.com/in/..., case kept. */
  linkedinUrl: string | null;
  /** Lowercase key of the link (contacts.linkedin_key). */
  linkedinKey: string | null;
  /** The member id (ACwAA...), from the link or given separately. */
  memberUrn: string | null;
  email: string | null;
  first: string | null;
  last: string | null;
};

export function personKeys(input: {
  linkedin_url?: string | null;
  linkedin_member_urn?: string | null;
  email?: string | null;
  first?: string | null;
  last?: string | null;
}): PersonKeys {
  const linkedinUrl = cleanLinkedinUrl(input.linkedin_url);
  const fromUrl = linkedinMemberUrn(linkedinUrl);
  return {
    linkedinUrl,
    linkedinKey: normalizeLinkedin(linkedinUrl),
    memberUrn: linkedinMemberUrn(input.linkedin_member_urn) ?? fromUrl,
    email: normalizeEmail(input.email),
    first: input.first?.trim() || null,
    last: input.last?.trim() || null,
  };
}

/** A LinkedIn profile link (linkedin.com/in/...), or a member id link. */
export function isLinkedinProfile(url: string | null): boolean {
  return Boolean(url && /^https:\/\/www\.linkedin\.com\/(in|sales\/lead|sales\/people)\/[^/]+/.test(url));
}

type Stored = { linkedin_url: string | null; linkedin_member_urn?: string | null };

/**
 * A contact found on its name only is the same person unless both have a
 * different normal profile link or a different member id.
 */
export function nameMatchAllowed(found: Stored, keys: PersonKeys): boolean {
  const foundUrn = found.linkedin_member_urn ?? linkedinMemberUrn(found.linkedin_url);
  if (foundUrn && keys.memberUrn && foundUrn.toLowerCase() !== keys.memberUrn.toLowerCase()) return false;
  const foundVanity = found.linkedin_url && !linkedinMemberUrn(found.linkedin_url) ? normalizeLinkedin(found.linkedin_url) : null;
  const incomingVanity = keys.linkedinUrl && !linkedinMemberUrn(keys.linkedinUrl) ? keys.linkedinKey : null;
  return !(foundVanity && incomingVanity && foundVanity !== incomingVanity);
}

/**
 * What to write on a known contact: the link when it has none, the same link
 * with its case back (an old lowercased Apify link), or the normal profile
 * link instead of the Apify one (the member id is kept separately); the
 * member id when it has none or only a lowercased one.
 */
export function linkedinPatch(found: Stored, keys: PersonKeys): { linkedin_url?: string; linkedin_member_urn?: string } {
  const patch: { linkedin_url?: string; linkedin_member_urn?: string } = {};
  const current = found.linkedin_url;
  if (keys.linkedinUrl) {
    if (!current) patch.linkedin_url = keys.linkedinUrl;
    else if (isLinkedinCaseRepair(current, keys.linkedinUrl)) patch.linkedin_url = keys.linkedinUrl;
    else if (linkedinMemberUrn(current) && !linkedinMemberUrn(keys.linkedinUrl) && isLinkedinProfile(keys.linkedinUrl)) {
      patch.linkedin_url = keys.linkedinUrl;
    }
  }
  const urn = keys.memberUrn;
  const stored = found.linkedin_member_urn ?? null;
  if (urn && (!stored || (stored === stored.toLowerCase() && stored.toLowerCase() === urn.toLowerCase() && urn !== stored))) {
    // When the new link is the Apify link itself, the database takes the id from it.
    if (!(patch.linkedin_url && linkedinMemberUrn(patch.linkedin_url) === urn)) patch.linkedin_member_urn = urn;
  }
  return patch;
}

/** "backup" is what the team calls the reserve contact. */
export function contactRoleFrom(value: string | null | undefined): ContactRole | null {
  const v = value?.trim().toLowerCase();
  if (!v) return null;
  if (v === "main" || v === "hoofd" || v === "primary") return "main";
  if (v === "backup" || v === "reserve" || v === "back-up") return "reserve";
  if (v === "extra") return "extra";
  return null;
}
