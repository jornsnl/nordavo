import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { escapeMailHtml, isFullDocument, renderMailLayout } from "./layout";
import type { MailCategory } from "./categories";

type MailInput = {
  to?: string;
  subject: string;
  html: string;
  text?: string;
  /** Comma separated, like `to`. */
  cc?: string;
  replyTo?: string;
  /** Defaults to MAIL_FROM. */
  from?: string;
  /** What kind of mail this is, for the mail log in Settings (see mailCategories). */
  category?: MailCategory;
};

export type MailResult = { ok: true; id?: string } | { ok: false; reason: "not_configured" | "rejected" | "network"; detail: string };

/**
 * Transactional mail (job failures, weekly report, candidates, Work) through
 * the Resend API. Every HTML fragment is wrapped in the Nordavo template
 * (src/lib/notify/layout.ts); a complete document is sent as is.
 * Without RESEND_API_KEY the message is logged instead, so jobs never fail
 * because mail is not configured.
 */
export async function sendMail(input: MailInput): Promise<boolean> {
  return (await deliverMail(input)).ok;
}

/** Like sendMail, but says why a mail was not sent (for the test mail in Settings). */
export async function deliverMail(input: MailInput): Promise<MailResult> {
  const from = input.from ?? process.env.MAIL_FROM;
  const to = input.to ?? process.env.REPORT_EMAIL_TO;
  const html = isFullDocument(input.html) ? input.html : renderMailLayout({ body: input.html });
  const result = await send({ ...input, from, to, html });
  await logMail({ ...input, from, to, html }, result);
  return result;
}

async function send({ to, subject, html, text, cc, replyTo, from }: MailInput): Promise<MailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || !from || !to) {
    const missing = [!apiKey && "RESEND_API_KEY", !from && "MAIL_FROM", !to && "a recipient (REPORT_EMAIL_TO)"].filter(Boolean).join(", ");
    console.warn(`[mail] not sent (${missing} missing): ${subject}`);
    return { ok: false, reason: "not_configured", detail: `Missing: ${missing}.` };
  }

  let response: Response;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: splitAddresses(to),
        subject,
        html,
        text,
        ...(cc && splitAddresses(cc).length > 0 ? { cc: splitAddresses(cc) } : {}),
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[mail] sending failed (network): ${detail}`);
    return { ok: false, reason: "network", detail };
  }
  if (!response.ok) {
    const raw = await response.text();
    console.error(`[mail] sending failed (${response.status}): ${raw}`);
    let detail = raw;
    try {
      detail = (JSON.parse(raw) as { message?: string }).message ?? raw;
    } catch {}
    return { ok: false, reason: "rejected", detail: `Resend answered ${response.status}: ${detail}` };
  }
  const data = (await response.json().catch(() => ({}))) as { id?: string };
  return { ok: true, id: data.id };
}

/** How long the mail log keeps a row. */
const MAIL_LOG_DAYS = 180;

/**
 * Write the attempt to public.mail_log (Settings > Mail log). Needs
 * SUPABASE_SECRET_KEY; never throws, so a logging problem never stops a mail.
 */
async function logMail(input: MailInput, result: MailResult) {
  const db = createAdminClient();
  if (!db) return;
  try {
    const { error } = await db.from("mail_log").insert({
      category: input.category ?? "other",
      status: result.ok ? "sent" : result.reason === "not_configured" ? "not_configured" : "failed",
      from_address: input.from ?? null,
      to_addresses: input.to ? splitAddresses(input.to).map((a) => a.toLowerCase()) : [],
      cc_addresses: input.cc ? splitAddresses(input.cc).map((a) => a.toLowerCase()) : [],
      reply_to: input.replyTo ?? null,
      subject: input.subject.slice(0, 500),
      html: input.html,
      text_body: input.text ?? null,
      resend_id: result.ok ? (result.id ?? null) : null,
      error: result.ok ? null : result.detail.slice(0, 2000),
    });
    if (error) console.error("[mail] log failed", error.code, error.message);
    const cutoff = new Date(Date.now() - MAIL_LOG_DAYS * 24 * 60 * 60 * 1000).toISOString();
    await db.from("mail_log").delete().lt("created_at", cutoff);
  } catch (error) {
    console.error("[mail] log failed", error instanceof Error ? error.message : error);
  }
}

function splitAddresses(value: string) {
  return value
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean);
}

/** Sender for mail to candidates: its own domain, so it never shares the cold mail domain. */
export function recruitmentFrom() {
  return process.env.MAIL_FROM_RECRUITMENT || process.env.MAIL_FROM || undefined;
}

/** Whether mail can be sent at all (RESEND_API_KEY and a sender). */
export function hasRecruitmentMail() {
  return Boolean(process.env.RESEND_API_KEY && recruitmentFrom());
}

export const escapeHtml = escapeMailHtml;
