import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * BCC logging (docs/mail.md): pure helpers for the inbound mail webhook
 * (src/app/api/webhooks/inbound-mail/route.ts). Parsing the provider JSON,
 * finding the BCC token, checking the sender, choosing the recipients and
 * grouping them per company. Unit tested in tests/bcc-mail.test.ts.
 *
 * Formats read by parseInboundMail():
 *   Postmark inbound:  { FromFull, ToFull, CcFull, BccFull, OriginalRecipient,
 *                        Subject, Date, MessageID, Headers: [{ Name, Value }],
 *                        Attachments: [{ Name }] }
 *   Resend inbound:    { type: "email.received", data: { from, to, cc, bcc,
 *                        subject, created_at, message_id, attachments: [{ filename }] } }
 *   Generic (Cloudflare Email Worker, Mailgun style or your own):
 *                      { from, to, cc, bcc, envelope: { from, to } | envelope_to,
 *                        subject, date, message_id | messageId,
 *                        headers: { name: value } | [{ name, value }],
 *                        attachments: [{ filename | name }] | ["name"] }
 * Addresses may be a string ("Name <a@b.nl>, c@d.nl"), an array of strings
 * or an array of objects with email/address/Email and name/Name.
 */

export type InboundProvider = "postmark" | "resend" | "generic";

export type InboundMail = {
  provider: InboundProvider;
  from: string | null;
  to: string[];
  cc: string[];
  bcc: string[];
  /** Envelope recipients and headers like Delivered-To: where a BCC address shows up. */
  envelopeTo: string[];
  subject: string;
  date: string | null;
  messageId: string | null;
  attachments: string[];
};

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;

/** One address, lowercased, from "Name <a@b.nl>", "a@b.nl" or "<a@b.nl>"; null when there is none. */
export function cleanAddress(value: string | null | undefined): string | null {
  if (!value) return null;
  const angle = value.match(/<([^<>]+)>/);
  const candidate = (angle ? angle[1] : value).trim().replace(/^mailto:/i, "").toLowerCase();
  return EMAIL_RE.test(candidate) ? candidate : null;
}

/** Split a header value on commas and semicolons that are not inside quotes or angle brackets. */
function splitAddressHeader(value: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quoted = false;
  let angle = 0;
  for (const ch of value) {
    if (ch === '"') quoted = !quoted;
    else if (ch === "<" && !quoted) angle++;
    else if (ch === ">" && !quoted && angle > 0) angle--;
    if ((ch === "," || ch === ";") && !quoted && angle === 0) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts;
}

/** Every address in a field: a header string, an array of strings or of { email | address | Email } objects. */
export function parseAddressList(value: unknown): string[] {
  const out: string[] = [];
  const add = (v: string | null) => {
    if (v && !out.includes(v)) out.push(v);
  };
  const visit = (v: unknown) => {
    if (!v) return;
    if (typeof v === "string") {
      for (const part of splitAddressHeader(v)) add(cleanAddress(part));
    } else if (Array.isArray(v)) {
      for (const item of v) visit(item);
    } else if (typeof v === "object") {
      const o = v as Record<string, unknown>;
      const address = o.Email ?? o.email ?? o.address ?? o.Address ?? o.value;
      if (typeof address === "string") add(cleanAddress(address));
      else if (Array.isArray(address)) visit(address);
    }
  };
  visit(value);
  return out;
}

export function domainOf(address: string): string {
  return address.slice(address.lastIndexOf("@") + 1).toLowerCase();
}

/** Same domain or a subdomain of it. */
export function isOnDomain(address: string, domains: string[]): boolean {
  const domain = domainOf(address);
  return domains.some((d) => {
    const clean = d.trim().toLowerCase().replace(/^@/, "");
    return clean !== "" && (domain === clean || domain.endsWith(`.${clean}`));
  });
}

/** "nordavo.nl, nordavo.com" -> ["nordavo.nl", "nordavo.com"]. */
export function parseDomainList(value: string | null | undefined, fallback: string[] = []): string[] {
  const list = (value ?? "")
    .split(/[\s,;]+/)
    .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
  return list.length > 0 ? list : fallback;
}

// ---------------------------------------------------------------------------
// Parsing the webhook JSON
// ---------------------------------------------------------------------------

type Obj = Record<string, unknown>;

function isObj(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function firstStr(o: Obj, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = str(o[key]);
    if (value) return value;
  }
  return null;
}

/** Headers as a lowercased map with every value: object, [{ Name, Value }], [{ name, value }] or [[name, value]]. */
export function headerMap(headers: unknown): Map<string, string[]> {
  const map = new Map<string, string[]>();
  const add = (name: unknown, value: unknown) => {
    if (typeof name !== "string") return;
    const values = Array.isArray(value) ? value : [value];
    for (const v of values) {
      if (typeof v !== "string") continue;
      const key = name.toLowerCase();
      map.set(key, [...(map.get(key) ?? []), v]);
    }
  };
  if (Array.isArray(headers)) {
    for (const h of headers) {
      if (Array.isArray(h)) add(h[0], h[1]);
      else if (isObj(h)) add(h.Name ?? h.name ?? h.key, h.Value ?? h.value);
    }
  } else if (isObj(headers)) {
    for (const [name, value] of Object.entries(headers)) add(name, value);
  }
  return map;
}

function attachmentNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const names: string[] = [];
  for (const a of value) {
    const name = typeof a === "string" ? a : isObj(a) ? str(a.Name ?? a.filename ?? a.fileName ?? a.name) : null;
    if (name) names.push(name.slice(0, 255));
  }
  return names.slice(0, 50);
}

/** "<abc@mail.gmail.com>" -> "abc@mail.gmail.com". Message-IDs are kept as they are otherwise. */
export function normalizeMessageId(value: string | null | undefined): string | null {
  const clean = value?.trim().replace(/^<+|>+$/g, "").trim();
  return clean ? clean.slice(0, 500) : null;
}

/** An ISO date from an RFC 2822 or ISO string; null when it cannot be read. */
export function parseMailDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value.replace(/\s*\([^)]*\)\s*$/, ""));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

const ENVELOPE_HEADERS = ["delivered-to", "x-original-to", "x-forwarded-to", "envelope-to", "x-envelope-to", "x-rcpt-to"];

/** Read the webhook body of Postmark, Resend or the generic format; null when it is no mail. */
export function parseInboundMail(json: unknown): InboundMail | null {
  if (!isObj(json)) return null;

  // Postmark inbound webhook.
  if ("FromFull" in json || "MessageID" in json || "OriginalRecipient" in json) {
    const headers = headerMap(json.Headers);
    const envelope = [
      ...parseAddressList(json.OriginalRecipient),
      ...ENVELOPE_HEADERS.flatMap((h) => parseAddressList(headers.get(h) ?? [])),
    ];
    return {
      provider: "postmark",
      from: parseAddressList(json.FromFull)[0] ?? parseAddressList(json.From)[0] ?? null,
      to: parseAddressList(json.ToFull ?? json.To),
      cc: parseAddressList(json.CcFull ?? json.Cc),
      bcc: parseAddressList(json.BccFull ?? json.Bcc),
      envelopeTo: dedupe(envelope),
      subject: str(json.Subject) ?? "",
      date: parseMailDate(str(json.Date) ?? headers.get("date")?.[0]),
      // Postmark's MessageID is its own id; the real one is in the headers.
      messageId: normalizeMessageId(headers.get("message-id")?.[0] ?? str(json.MessageID)),
      attachments: attachmentNames(json.Attachments),
    };
  }

  // Resend (and other webhooks that wrap the mail as { type, data }).
  let provider: InboundProvider = "generic";
  let mail: Obj = json;
  if (isObj(json.data) && (typeof json.type === "string" || "email_id" in json.data)) {
    mail = json.data;
    if (typeof json.type === "string" && json.type.startsWith("email.")) provider = "resend";
  }
  if (isObj(mail.email) && !("from" in mail)) mail = mail.email as Obj;

  const headers = headerMap(mail.headers);
  const envelope = isObj(mail.envelope) ? mail.envelope : {};
  const envelopeTo = [
    ...parseAddressList(envelope.to ?? envelope.rcpt_to),
    ...parseAddressList(mail.envelope_to ?? mail.envelopeTo ?? mail.recipient ?? mail.rcpt_to ?? mail.rcptTo ?? mail.original_recipient),
    ...ENVELOPE_HEADERS.flatMap((h) => parseAddressList(headers.get(h) ?? [])),
  ];
  const from = parseAddressList(mail.from ?? headers.get("from") ?? envelope.from)[0] ?? null;
  const subject = firstStr(mail, "subject") ?? headers.get("subject")?.[0] ?? "";
  if (!from && envelopeTo.length === 0 && !("to" in mail)) return null;

  return {
    provider,
    from,
    to: parseAddressList(mail.to ?? headers.get("to")),
    cc: parseAddressList(mail.cc ?? headers.get("cc")),
    bcc: parseAddressList(mail.bcc ?? headers.get("bcc")),
    envelopeTo: dedupe(envelopeTo),
    subject,
    date: parseMailDate(firstStr(mail, "date", "sent_at", "created_at", "timestamp") ?? headers.get("date")?.[0]),
    messageId: normalizeMessageId(firstStr(mail, "message_id", "messageId", "message-id", "Message-ID") ?? headers.get("message-id")?.[0]),
    attachments: attachmentNames(mail.attachments),
  };
}

function dedupe(list: string[]): string[] {
  return [...new Set(list)];
}

// ---------------------------------------------------------------------------
// Token, sender, recipients
// ---------------------------------------------------------------------------

/** Tokens are lowercase letters and digits (mail_bcc_addresses.token). */
export const BCC_TOKEN_RE = /^[a-z0-9]{16,64}$/;

/** The address of a token: "<token>@log.nordavo.nl". */
export function bccAddress(token: string, bccDomain: string): string {
  return `${token}@${bccDomain.trim().toLowerCase().replace(/^@/, "")}`;
}

/**
 * Tokens of every address on the BCC domain in the mail (envelope and BCC
 * first, then To and Cc), without a +suffix. Usually one.
 */
export function findBccTokens(mail: InboundMail, bccDomain: string): { token: string; address: string }[] {
  const domain = bccDomain.trim().toLowerCase().replace(/^@/, "");
  if (!domain) return [];
  const found: { token: string; address: string }[] = [];
  for (const address of [...mail.envelopeTo, ...mail.bcc, ...mail.to, ...mail.cc]) {
    if (domainOf(address) !== domain) continue;
    const token = address.slice(0, address.lastIndexOf("@")).split("+")[0];
    if (BCC_TOKEN_RE.test(token) && !found.some((f) => f.token === token)) found.push({ token, address });
  }
  return found;
}

/** Only mail from the owner of the address counts: the sender equals the user's email, case insensitive. */
export function senderMatches(from: string | null, ownerEmail: string | null | undefined): boolean {
  const a = cleanAddress(from);
  const b = cleanAddress(ownerEmail);
  return Boolean(a && b && a === b);
}

/**
 * The people the mail went to that may be contacts: To and Cc, without
 * Nordavo addresses (company domains and their subdomains), the BCC domain
 * and the sender. Lowercased, in order, without doubles.
 */
export function externalRecipients(mail: InboundMail, internalDomains: string[], bccDomain: string): string[] {
  const skip = [...internalDomains, bccDomain].filter(Boolean);
  const from = cleanAddress(mail.from);
  return dedupe([...mail.to, ...mail.cc]).filter((a) => a !== from && !isOnDomain(a, skip));
}

export type MatchedContact = { id: string; company_id: string; email: string };

export type BccActivityGroup = {
  companyId: string;
  /** The first matched contact of this company; the activity hangs on it. */
  contactId: string;
  contactIds: string[];
  recipients: string[];
};

/**
 * One group per company: recipients from three companies make three
 * activities. A recipient matches a contact on its exact address (case
 * insensitive); when two contacts share an address the first one wins.
 */
export function groupByCompany(recipients: string[], contacts: MatchedContact[]): BccActivityGroup[] {
  const byEmail = new Map<string, MatchedContact>();
  for (const c of contacts) {
    const key = c.email.trim().toLowerCase();
    if (!byEmail.has(key)) byEmail.set(key, c);
  }
  const groups = new Map<string, BccActivityGroup>();
  for (const recipient of recipients) {
    const contact = byEmail.get(recipient.toLowerCase());
    if (!contact) continue;
    const group = groups.get(contact.company_id);
    if (group) {
      if (!group.contactIds.includes(contact.id)) group.contactIds.push(contact.id);
      if (!group.recipients.includes(recipient)) group.recipients.push(recipient);
    } else {
      groups.set(contact.company_id, {
        companyId: contact.company_id,
        contactId: contact.id,
        contactIds: [contact.id],
        recipients: [recipient],
      });
    }
  }
  return [...groups.values()];
}

/**
 * The Message-ID that prevents doubles. A mail without one gets a stable
 * hash of sender, date, subject and recipients, so a retry is still a double.
 */
export function dedupeKey(mail: InboundMail): string {
  if (mail.messageId) return mail.messageId;
  const basis = [mail.from, mail.date, mail.subject, ...mail.to, ...mail.cc].join("|");
  return `generated-${createHash("sha256").update(basis).digest("hex").slice(0, 40)}`;
}

/** activities.external_id of the activity for one company: one Message-ID, one activity per company. */
export function bccExternalId(messageKey: string, companyId: string): string {
  return `bcc:${messageKey.slice(0, 400)}:${companyId}`;
}

/** The text in the timeline: subject, recipients and attachments. */
export function bccActivityNotes(mail: InboundMail, group: Pick<BccActivityGroup, "recipients">): string {
  const lines = [`Subject: ${mail.subject || "(no subject)"}`];
  lines.push(`To: ${mail.to.join(", ") || "(none)"}`);
  if (mail.cc.length > 0) lines.push(`Cc: ${mail.cc.join(", ")}`);
  if (mail.attachments.length > 0) lines.push(`Attachments: ${mail.attachments.join(", ")}`);
  if (group.recipients.length > 0) lines.push(`Logged for: ${group.recipients.join(", ")}`);
  return lines.join("\n").slice(0, 4000);
}

/** activities.mail: the details of the mail, for the timeline and later use. */
export function bccActivityMail(mail: InboundMail, group: Pick<BccActivityGroup, "recipients" | "contactIds">, messageKey: string) {
  return {
    subject: mail.subject,
    from: mail.from,
    to: mail.to,
    cc: mail.cc,
    date: mail.date,
    message_id: messageKey,
    attachments: mail.attachments,
    recipients: group.recipients,
    contact_ids: group.contactIds,
    provider: mail.provider,
  };
}

// ---------------------------------------------------------------------------
// Authentication of the webhook
// ---------------------------------------------------------------------------

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * The shared secret (INBOUND_MAIL_SECRET), from any of the places a provider
 * lets you put it: header X-Inbound-Secret, Authorization: Bearer <secret>,
 * Basic auth (Postmark: https://inbound:<secret>@portal/api/webhooks/inbound-mail;
 * the user name is free) or ?secret=<secret> in the URL.
 */
export function verifyInboundSecret(
  secret: string | undefined,
  { header, authorization, query }: { header?: string | null; authorization?: string | null; query?: string | null },
): boolean {
  if (!secret) return false;
  const candidates: string[] = [];
  if (header) candidates.push(header.trim());
  if (query) candidates.push(query.trim());
  if (authorization) {
    const [scheme, value = ""] = authorization.trim().split(/\s+/, 2);
    if (/^bearer$/i.test(scheme)) candidates.push(value);
    if (/^basic$/i.test(scheme)) {
      const decoded = Buffer.from(value, "base64").toString("utf8");
      const colon = decoded.indexOf(":");
      if (colon >= 0) candidates.push(decoded.slice(colon + 1));
    }
  }
  return candidates.some((c) => c !== "" && safeEqual(c, secret));
}

/**
 * Resend signs webhooks with Svix: HMAC-SHA256 of "<svix-id>.<svix-timestamp>.<body>"
 * with the base64 key after "whsec_", in svix-signature as "v1,<base64>" (several
 * separated by spaces). Timestamps older than 5 minutes are refused.
 */
export function verifySvixSignature(
  rawBody: string,
  secret: string | undefined,
  { id, timestamp, signature }: { id?: string | null; timestamp?: string | null; signature?: string | null },
  now: number = Date.now(),
): boolean {
  if (!secret || !id || !timestamp || !signature) return false;
  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds) || Math.abs(now / 1000 - seconds) > 300) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${rawBody}`).digest("base64");
  return signature
    .split(" ")
    .map((part) => part.split(",", 2))
    .some(([version, value]) => version === "v1" && Boolean(value) && safeEqual(value, expected));
}
