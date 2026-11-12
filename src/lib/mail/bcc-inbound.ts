import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, InboundMailStatus, TablesInsert } from "@/lib/database.types";
import {
  type InboundMail,
  bccActivityMail,
  bccActivityNotes,
  bccAddress,
  bccExternalId,
  cleanAddress,
  dedupeKey,
  externalRecipients,
  findBccTokens,
  groupByCompany,
  parseDomainList,
  senderMatches,
} from "@/lib/mail/bcc";

/**
 * BCC logging, the part that touches the database (docs/mail.md). Called by
 * POST /api/webhooks/inbound-mail with the secret key client. Every mail gets
 * one row in mail_inbound_log with its status; only mail from the owner of
 * the BCC address becomes activities.
 */

type Db = SupabaseClient<Database>;

const LOG_DAYS = 180;

/** The domain of the BCC addresses, e.g. "log.nordavo.nl" (MAIL_BCC_DOMAIN); null when not set up. */
export function bccDomain(): string | null {
  const value = process.env.MAIL_BCC_DOMAIN?.trim().toLowerCase().replace(/^@/, "");
  return value || null;
}

/**
 * Nordavo's own domains (MAIL_COMPANY_DOMAINS, comma separated). Without it:
 * nordavo.nl and the domain of MAIL_FROM. Recipients on these domains (and
 * their subdomains) are never matched to contacts.
 */
export function companyMailDomains(): string[] {
  const fallback = ["nordavo.nl"];
  const from = cleanAddress(process.env.MAIL_FROM);
  if (from) fallback.push(from.slice(from.indexOf("@") + 1));
  return [...new Set(parseDomainList(process.env.MAIL_COMPANY_DOMAINS, fallback))];
}

/** The full BCC address of a token, or null when MAIL_BCC_DOMAIN is not set. */
export function bccAddressFor(token: string | null | undefined): string | null {
  const domain = bccDomain();
  return token && domain ? bccAddress(token, domain) : null;
}

export type InboundResult = {
  status: InboundMailStatus;
  reason?: string;
  activities?: number;
  companies?: number;
};

type LogRow = TablesInsert<"mail_inbound_log">;

async function writeLog(db: Db, row: LogRow) {
  const { error } = await db.from("mail_inbound_log").insert(row);
  if (error) console.error("[inbound-mail] could not write the log:", error.message);
  const cutoff = new Date(Date.now() - LOG_DAYS * 86_400_000).toISOString();
  await db.from("mail_inbound_log").delete().lt("received_at", cutoff);
}

/** Log a body that is not a mail we can read. */
export async function logInvalidInbound(db: Db, reason: string): Promise<InboundResult> {
  await writeLog(db, { status: "invalid", reason: reason.slice(0, 500) });
  return { status: "invalid", reason };
}

/** Handle one parsed mail. Throws only when writing activities fails (the provider then retries). */
export async function handleInboundMail(db: Db, mail: InboundMail, domain: string): Promise<InboundResult> {
  const messageKey = dedupeKey(mail);
  const base: LogRow = {
    status: "invalid",
    provider: mail.provider,
    message_id: messageKey,
    from_address: mail.from,
    to_addresses: mail.to.slice(0, 100),
    cc_addresses: mail.cc.slice(0, 100),
    subject: mail.subject.slice(0, 500) || null,
    mail_date: mail.date,
    attachment_names: mail.attachments,
  };
  const finish = async (status: InboundMailStatus, extra: Partial<LogRow> = {}, result: Partial<InboundResult> = {}) => {
    await writeLog(db, { ...base, ...extra, status });
    return { status, reason: extra.reason ?? undefined, ...result } satisfies InboundResult;
  };

  const tokens = findBccTokens(mail, domain);
  if (tokens.length === 0) return finish("no_address", { reason: `No address on ${domain} in the mail.` });

  const { data: owners, error: ownerError } = await db
    .from("mail_bcc_addresses")
    .select("user_id, token")
    .in("token", tokens.map((t) => t.token));
  if (ownerError) throw new Error(`mail_bcc_addresses: ${ownerError.message}`);
  const owner = tokens.map((t) => ({ ...t, row: (owners ?? []).find((o) => o.token === t.token) })).find((t) => t.row);
  if (!owner?.row) {
    return finish("unknown_address", { bcc_address: tokens[0].address, reason: "No user has this BCC address (or it was replaced)." });
  }

  const userId = owner.row.user_id;
  const { data: profile, error: profileError } = await db.from("profiles").select("email").eq("id", userId).maybeSingle();
  if (profileError) throw new Error(`profiles: ${profileError.message}`);
  const withUser: Partial<LogRow> = { user_id: userId, bcc_address: owner.address };

  if (!senderMatches(mail.from, profile?.email)) {
    return finish("sender_mismatch", {
      ...withUser,
      reason: `Sent by ${mail.from ?? "an unknown sender"}, not by the owner of this address. Ignored.`,
    });
  }

  const { data: earlier, error: earlierError } = await db
    .from("mail_inbound_log")
    .select("id")
    .eq("user_id", userId)
    .eq("message_id", messageKey)
    .in("status", ["logged", "no_match"])
    .limit(1);
  if (earlierError) throw new Error(`mail_inbound_log: ${earlierError.message}`);
  if ((earlier ?? []).length > 0) return finish("duplicate", { ...withUser, reason: "This Message-ID was already handled." });

  const recipients = externalRecipients(mail, companyMailDomains(), domain);
  let contacts: { id: string; company_id: string; email: string }[] = [];
  if (recipients.length > 0) {
    const { data, error } = await db.rpc("mail_bcc_find_contacts", { p_emails: recipients });
    if (error) throw new Error(`mail_bcc_find_contacts: ${error.message}`);
    contacts = data ?? [];
  }
  const groups = groupByCompany(recipients, contacts);
  if (groups.length === 0) {
    return finish("no_match", {
      ...withUser,
      reason: recipients.length === 0 ? "No recipients outside Nordavo." : `No contact with the address ${recipients.slice(0, 5).join(", ")}.`,
    });
  }

  const rows: TablesInsert<"activities">[] = groups.map((group) => ({
    company_id: group.companyId,
    contact_id: group.contactId,
    channel: "mail",
    type: "contact",
    direction: "outbound",
    outcome: "verstuurd",
    source: "bcc",
    date: mail.date ?? new Date().toISOString(),
    notes: bccActivityNotes(mail, group),
    mail: bccActivityMail(mail, group, messageKey),
    external_id: bccExternalId(messageKey, group.companyId),
    created_by: userId,
  }));
  const { data: inserted, error: insertError } = await db
    .from("activities")
    .upsert(rows, { onConflict: "external_id", ignoreDuplicates: true })
    .select("id");
  if (insertError) {
    await writeLog(db, { ...base, ...withUser, status: "failed", reason: insertError.message.slice(0, 500) });
    throw new Error(`activities: ${insertError.message}`);
  }

  const ids = (inserted ?? []).map((r) => r.id);
  if (ids.length === 0) return finish("duplicate", { ...withUser, reason: "The activities for this Message-ID already exist." });
  return finish(
    "logged",
    { ...withUser, activity_ids: ids, company_count: groups.length, reason: null },
    { activities: ids.length, companies: groups.length },
  );
}
