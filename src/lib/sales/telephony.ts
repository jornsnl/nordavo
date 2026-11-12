// Calling through your own phone system (feedback Julius, b6942cdc). Pure,
// safe everywhere and unit tested in tests/telephony.test.ts.
//
//   * dialHref(): the link a call button opens: tel: by default, or the
//     person's own template with {number} (profiles.dial_template), for
//     example the click to call link of Dubline;
//   * phoneKey(): one form for a number, as public.sales_phone_key() does;
//   * parseCallEvent(): the body of POST /api/webhooks/calls, from any phone
//     system that can send a JSON webhook (docs/calls.md).

/** The digits of a Dutch or international number in one form: 31612345678. */
export function phoneKey(phone: string | null | undefined): string | null {
  const d = String(phone ?? "").replace(/[^0-9]/g, "");
  if (!d) return null;
  if (d.startsWith("00")) return d.slice(2);
  if (d.startsWith("0")) return `31${d.slice(1)}`;
  return d;
}

/** The number as a phone system takes it: +31612345678 (a leading + and digits). */
export function e164(phone: string): string {
  const key = phoneKey(phone);
  return key ? `+${key}` : phone.replace(/[^\d+]/g, "");
}

/** Whether a template is one the portal accepts (the database checks the same). */
export function isDialTemplate(template: string): boolean {
  const t = template.trim();
  return t.length <= 500 && t.includes("{number}") && /^(https:\/\/|tel:|callto:|sip:|dubline:)/i.test(t);
}

/**
 * The link for a call button. {number} is the number as +31612345678,
 * {digits} without the plus, {local} as 0612345678.
 */
export function dialHref(number: string, template?: string | null): string {
  const plain = number.replace(/[^\d+]/g, "");
  if (!template || !isDialTemplate(template)) return `tel:${plain}`;
  const full = e164(number);
  const digits = full.replace(/^\+/, "");
  const local = digits.startsWith("31") ? `0${digits.slice(2)}` : digits;
  return template
    .trim()
    .replaceAll("{number}", encodeURIComponent(full))
    .replaceAll("{digits}", digits)
    .replaceAll("{local}", local);
}

/** Whether the call button opens a web page (new tab) rather than the phone app. */
export function dialsInBrowser(href: string): boolean {
  return /^https:\/\//i.test(href);
}

export type CallEvent = {
  id: string;
  /** The number of the other side: the lead. */
  phone: string;
  direction: "inbound" | "outbound";
  startedAt: string | null;
  durationSeconds: number | null;
  recordingUrl: string | null;
  answered: boolean | null;
  agentEmail: string | null;
  notes: string | null;
};

function str(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

function pick(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== "") return obj[k];
  }
  return undefined;
}

/**
 * Reads a call from a webhook body. Field names vary per phone system, so
 * the common ones are accepted (id, call_id, uuid; to, from, number,
 * remote_number; direction; started_at, start_time, timestamp; duration,
 * duration_seconds, billsec; recording_url, recording; status, answered;
 * agent_email, user_email). Returns null without an id or a number.
 */
export function parseCallEvent(body: unknown): CallEvent | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const raw = body as Record<string, unknown>;
  const data = raw.data && typeof raw.data === "object" && !Array.isArray(raw.data) ? (raw.data as Record<string, unknown>) : raw;
  const id = str(pick(data, ["id", "call_id", "callId", "uuid", "call_uuid"]));
  const directionRaw = (str(pick(data, ["direction", "type"])) ?? "outbound").toLowerCase();
  const direction: CallEvent["direction"] = /^(in|incoming|inbound)/.test(directionRaw) ? "inbound" : "outbound";
  const phone =
    str(pick(data, ["remote_number", "number", "phone", "lead_number"])) ??
    str(direction === "inbound" ? pick(data, ["from", "caller", "caller_id"]) : pick(data, ["to", "callee", "destination"]));
  if (!id || !phone || !phoneKey(phone)) return null;

  const started = str(pick(data, ["started_at", "start_time", "startTime", "timestamp", "date"]));
  const startedAt = started && !Number.isNaN(Date.parse(started)) ? new Date(started).toISOString() : null;
  const durationRaw = Number(pick(data, ["duration_seconds", "duration", "billsec", "talk_time"]));
  const durationSeconds = Number.isFinite(durationRaw) && durationRaw >= 0 ? Math.min(86400, Math.round(durationRaw)) : null;
  const recording = str(pick(data, ["recording_url", "recordingUrl", "recording", "record_url"]));
  const recordingUrl = recording && /^https:\/\//i.test(recording) && recording.length <= 2000 ? recording : null;
  const status = (str(pick(data, ["status", "disposition", "result"])) ?? "").toLowerCase();
  const answeredRaw = pick(data, ["answered"]);
  const answered =
    typeof answeredRaw === "boolean"
      ? answeredRaw
      : status
        ? /^(answered|completed|connected|success|ok|done)$/.test(status)
          ? true
          : /^(no[ _-]?answer|missed|busy|failed|cancel+ed|unanswered|voicemail)$/.test(status)
            ? false
            : null
        : durationSeconds != null
          ? durationSeconds > 0
          : null;
  const agentEmail = str(pick(data, ["agent_email", "user_email", "agentEmail", "userEmail", "email"]));
  const notes = str(pick(data, ["notes", "summary", "transcript_summary"]));

  return {
    id: id.slice(0, 180),
    phone,
    direction,
    startedAt,
    durationSeconds,
    recordingUrl,
    answered,
    agentEmail: agentEmail && agentEmail.includes("@") ? agentEmail.toLowerCase() : null,
    notes: notes ? notes.slice(0, 5000) : null,
  };
}

/** Constant time comparison of the shared secret. */
export function secretMatches(given: string | null | undefined, expected: string | null | undefined): boolean {
  if (!given || !expected) return false;
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}
