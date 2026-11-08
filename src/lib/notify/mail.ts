import "server-only";

/**
 * Transactional mail (job failures, weekly report) through the Resend API.
 * Without RESEND_API_KEY the message is logged instead, so jobs never fail
 * because mail is not configured.
 */
export async function sendMail({
  to = process.env.REPORT_EMAIL_TO,
  subject,
  html,
  text,
  cc,
  replyTo,
  from = process.env.MAIL_FROM,
}: {
  to?: string;
  subject: string;
  html: string;
  text?: string;
  /** Comma separated, like `to`. */
  cc?: string;
  replyTo?: string;
  /** Defaults to MAIL_FROM. */
  from?: string;
}): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || !from || !to) {
    console.warn(`[mail] not sent (RESEND_API_KEY, MAIL_FROM or REPORT_EMAIL_TO missing): ${subject}`);
    return false;
  }

  const response = await fetch("https://api.resend.com/emails", {
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
  if (!response.ok) {
    console.error(`[mail] sending failed (${response.status}): ${await response.text()}`);
    return false;
  }
  return true;
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

export function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
