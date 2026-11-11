/**
 * One general permission to share the Working Style Profile (feedback
 * Julius, 20261121030000): the shapes of wsp_consent_state and
 * wsp_staff_consent, and what staff may do with them. Pure, so the person,
 * the Academy and staff pages and the tests share it.
 */

export type WspRecipient = {
  id: string;
  assessmentId: string;
  name: string;
  kind: "client" | "prospect";
  clientId: string | null;
  companyId: string | null;
  channel: "portal" | "pdf" | "anonymous_profile";
  sharedAt: string;
  sharedByName: string | null;
  revokedAt: string | null;
};

export type WspConsentState = {
  consented: boolean;
  consentedAt: string | null;
  /** Ask on the last screen, or once more after Not now and the general term. */
  mayAsk: boolean;
  declinedAt: string | null;
  recipients: WspRecipient[];
};

export type WspStaffConsent = WspConsentState & {
  via: string | null;
  withdrawnAt: string | null;
  lastRequestAt: string | null;
  requestDays: number;
};

type Raw = Record<string, unknown>;

const text = (v: unknown) => (typeof v === "string" && v ? v : null);

function recipients(value: unknown): WspRecipient[] {
  if (!Array.isArray(value)) return [];
  return value.map((r: Raw) => ({
    id: String(r.id),
    assessmentId: String(r.assessment_id ?? ""),
    name: text(r.name) ?? "A company",
    kind: r.kind === "client" ? "client" : "prospect",
    clientId: text(r.client_id),
    companyId: text(r.company_id),
    channel: r.channel === "pdf" || r.channel === "anonymous_profile" ? r.channel : "portal",
    sharedAt: String(r.shared_at ?? ""),
    sharedByName: text(r.shared_by_name),
    revokedAt: text(r.revoked_at),
  }));
}

export function parseConsentState(value: unknown): WspConsentState | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Raw;
  return {
    consented: v.consented === true,
    consentedAt: text(v.consented_at),
    mayAsk: v.may_ask === true,
    declinedAt: text(v.declined_at),
    recipients: recipients(v.recipients),
  };
}

export function parseStaffConsent(value: unknown): WspStaffConsent | null {
  const base = parseConsentState(value);
  if (!base) return null;
  const v = value as Raw;
  return {
    ...base,
    mayAsk: false,
    via: text(v.via),
    withdrawnAt: text(v.withdrawn_at),
    lastRequestAt: text(v.last_request_at),
    requestDays: typeof v.request_days === "number" ? v.request_days : 7,
  };
}

/** Why staff cannot share right now, or null when they can (the database checks it again). */
export function shareBlockedReason(consent: Pick<WspConsentState, "consented"> | null, completed: boolean): string | null {
  if (!completed) return "The questionnaire is not completed yet.";
  if (!consent?.consented) return "No permission: the person has not agreed that Nordavo shares their profile.";
  return null;
}

/** Whether staff may ask for permission now: no permission yet, and not asked within the term. */
export function mayRequestPermission(consent: WspStaffConsent | null, now = new Date()): { ok: boolean; reason: string | null } {
  if (!consent) return { ok: false, reason: null };
  if (consent.consented) return { ok: false, reason: "The person already gave permission." };
  if (consent.lastRequestAt && now.getTime() - new Date(consent.lastRequestAt).getTime() < consent.requestDays * 86_400_000) {
    return { ok: false, reason: `Already asked in the last ${consent.requestDays} days.` };
  }
  return { ok: true, reason: null };
}

export const CHANNEL_LABELS: Record<WspRecipient["channel"], string> = {
  portal: "in the client portal",
  pdf: "as a PDF",
  anonymous_profile: "with the anonymous profile",
};
