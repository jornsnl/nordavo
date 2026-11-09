import "server-only";
import { escapeMailHtml, isFullDocument, renderMailLayout } from "./layout";

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
export async function deliverMail({
  to = process.env.REPORT_EMAIL_TO,
  subject,
  html,
  text,
  cc,
  replyTo,
  from = process.env.MAIL_FROM,
}: MailInput): Promise<MailResult> {
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
        html: isFullDocument(html) ? html : renderMailLayout({ body: html }),
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
