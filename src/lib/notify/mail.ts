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
}: {
  to?: string;
  subject: string;
  html: string;
  text?: string;
}): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;
  if (!apiKey || !from || !to) {
    console.warn(`[mail] niet verstuurd (RESEND_API_KEY, MAIL_FROM of REPORT_EMAIL_TO ontbreekt): ${subject}`);
    return false;
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: to.split(",").map((a) => a.trim()), subject, html, text }),
  });
  if (!response.ok) {
    console.error(`[mail] versturen mislukt (${response.status}): ${await response.text()}`);
    return false;
  }
  return true;
}

export function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
