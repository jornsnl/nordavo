/**
 * The one house style for every mail Nordavo sends: navy header with the
 * compass mark and a saffron rule, a white card, a quiet footer. Pure (no
 * server-only), so templates are tested without sending.
 *
 * Mail clients ignore <style> blocks and CSS variables, so everything is
 * inline and laid out with tables. The colors mirror src/app/globals.css.
 */

export const mailColors = {
  navy: "#0a1a2f",
  brand700: "#173a66",
  brand600: "#1f4e8c",
  brand100: "#e3ecf8",
  brand50: "#f2f6fc",
  saffron: "#f2a33a",
  saffronDark: "#d9871a",
  saffronSoft: "#fdf0dc",
  ink: "#0f1b2d",
  muted: "#5b6779",
  border: "#e3e8ef",
} as const;

const fontStack = "'Plus Jakarta Sans',Inter,'Segoe UI',Helvetica,Arial,sans-serif";
const bodyFont = "Inter,'Segoe UI',Helvetica,Arial,sans-serif";

export function escapeMailHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const esc = escapeMailHtml;

/** A bulletproof button: a table cell, so Outlook keeps the padding and the color. */
export function mailButton(href: string, label: string, { tone = "primary" }: { tone?: "primary" | "accent" } = {}) {
  const bg = tone === "accent" ? mailColors.saffron : mailColors.brand700;
  const color = tone === "accent" ? mailColors.navy : "#ffffff";
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:24px 0"><tr><td style="border-radius:10px;background:${bg}"><a href="${esc(href)}" style="display:inline-block;padding:12px 22px;font-family:${fontStack};font-size:15px;font-weight:700;line-height:20px;color:${color};text-decoration:none;border-radius:10px">${esc(label)}</a></td></tr></table>`;
}

/** The fallback line under a button, for clients that block links in buttons. */
export function mailLinkFallback(href: string) {
  return `<p style="margin:0 0 16px;font-size:13px;line-height:20px;color:${mailColors.muted}">Or open this link: <a href="${esc(href)}" style="color:${mailColors.brand600};word-break:break-all">${esc(href)}</a></p>`;
}

/** A soft saffron note, for warnings or "this is a test". */
export function mailNotice(html: string) {
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin:0 0 20px"><tr><td style="background:${mailColors.saffronSoft};border-left:4px solid ${mailColors.saffronDark};border-radius:6px;padding:12px 16px;font-size:14px;line-height:21px;color:${mailColors.navy}">${html}</td></tr></table>`;
}

export type MailLayoutOptions = {
  /** The body, as an HTML fragment with inline styles. */
  body: string;
  /** Small saffron label above the title, for example "Weekly report". */
  eyebrow?: string;
  /** Title in the navy header. Without it the header only carries the logo. */
  title?: string;
  /** Hidden preview text that inbox lists show after the subject. */
  preheader?: string;
  /** Extra line in the footer, for example why someone gets this mail. */
  footerNote?: string;
  /** 600 by default; the weekly report uses 680 for its tables. */
  width?: number;
  /** Public URL of the portal, for the logo image and footer link. Defaults to NEXT_PUBLIC_SITE_URL. */
  siteUrl?: string;
};

function publicSiteUrl(siteUrl?: string) {
  const url = (siteUrl ?? process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/+$/, "");
  // A logo on localhost would show as a broken image in a real inbox.
  return /^https:\/\//.test(url) ? url : null;
}

/** The compass mark as an image when the portal is public, else a navy tile with the needle in text. */
function logo(siteUrl: string | null) {
  const mark = siteUrl
    ? `<img src="${esc(siteUrl)}/email/logo-mark.png" width="36" height="36" alt="" style="display:block;border:0;outline:none;width:36px;height:36px;border-radius:9px">`
    : `<div style="width:36px;height:36px;border-radius:9px;background:${mailColors.brand700};color:${mailColors.saffron};font-size:18px;line-height:36px;text-align:center">&#9650;</div>`;
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr>
<td style="vertical-align:middle;padding-right:10px">${mark}</td>
<td style="vertical-align:middle;font-family:${fontStack};font-size:22px;font-weight:800;letter-spacing:-0.5px;color:#ffffff">nordavo</td>
</tr></table>`;
}

/** Wrap a body fragment in the Nordavo mail template: a complete HTML document. */
export function renderMailLayout({
  body,
  eyebrow,
  title,
  preheader,
  footerNote,
  width = 600,
  siteUrl,
}: MailLayoutOptions): string {
  const site = publicSiteUrl(siteUrl);
  const year = new Date().getUTCFullYear();
  const heading =
    eyebrow || title
      ? `<tr><td style="padding:22px 0 0">
${eyebrow ? `<p style="margin:0;font-family:${fontStack};font-size:12px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:${mailColors.saffron}">${esc(eyebrow)}</p>` : ""}
${title ? `<h1 style="margin:6px 0 0;font-family:${fontStack};font-size:24px;line-height:31px;font-weight:700;color:#ffffff">${esc(title)}</h1>` : ""}
</td></tr>`
      : "";

  return `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${esc(title ?? "Nordavo")}</title>
</head>
<body style="margin:0;padding:0;background:${mailColors.brand50};-webkit-text-size-adjust:100%">
${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all">${esc(preheader)}&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>` : ""}
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:${mailColors.brand50}">
<tr><td align="center" style="padding:32px 12px">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:${width}px">
<tr><td style="background:${mailColors.navy};border-radius:16px 16px 0 0;border-bottom:4px solid ${mailColors.saffron};padding:24px 32px 26px">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
<tr><td>${logo(site)}</td></tr>
${heading}
</table>
</td></tr>
<tr><td style="background:#ffffff;border-radius:0 0 16px 16px;padding:32px;font-family:${bodyFont};font-size:15px;line-height:24px;color:${mailColors.ink}">
${body}
</td></tr>
<tr><td style="padding:24px 32px 0;text-align:center;font-family:${bodyFont};font-size:12px;line-height:19px;color:${mailColors.muted}">
${footerNote ? `<p style="margin:0 0 8px">${footerNote}</p>` : ""}
<p style="margin:0"><strong style="color:${mailColors.navy}">Nordavo</strong> &middot; The bridge between Dutch growth companies and Indian tech talent</p>
<p style="margin:4px 0 0"><a href="https://nordavo.nl" style="color:${mailColors.brand600};text-decoration:none">nordavo.nl</a> &middot; &copy; ${year}</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

/** Whether html is already a complete document (then sendMail leaves it alone). */
export function isFullDocument(html: string) {
  return /^\s*<!doctype|^\s*<html/i.test(html);
}

/** Standard paragraph style inside the card. */
export function mailParagraph(html: string) {
  return `<p style="margin:0 0 16px">${html}</p>`;
}

/** The test mail from Settings: shows every building block of the template. */
export function testMail({ sentBy, sentAt, siteUrl }: { sentBy: string; sentAt: Date; siteUrl?: string }) {
  const when = new Intl.DateTimeFormat("en-GB", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Europe/Amsterdam",
  }).format(sentAt);
  const portal = (siteUrl ?? process.env.NEXT_PUBLIC_SITE_URL ?? "https://nordavo.nl").replace(/\/+$/, "");
  const subject = "Test mail from the Nordavo portal";
  const body = [
    mailNotice("<strong>This is a test.</strong> If you can read this, Resend and the sender domain are set up correctly."),
    mailParagraph("Hi there,"),
    mailParagraph(
      `This mail was sent from Settings in the Nordavo portal by <strong>${esc(sentBy)}</strong> on ${esc(when)} (Amsterdam time). Every mail the portal sends uses this template: interview invitations, application forms, reminders, Work updates and the weekly report.`,
    ),
    mailButton(`${portal}/dashboard/settings`, "Open the portal"),
    mailLinkFallback(`${portal}/dashboard/settings`),
    mailParagraph("Kind regards,<br>Nordavo"),
  ].join("\n");
  const text = [
    "This is a test. If you can read this, Resend and the sender domain are set up correctly.",
    "",
    `This mail was sent from Settings in the Nordavo portal by ${sentBy} on ${when} (Amsterdam time).`,
    "",
    `Open the portal: ${portal}/dashboard/settings`,
    "",
    "Kind regards,",
    "Nordavo",
  ].join("\n");
  return {
    subject,
    text,
    html: renderMailLayout({
      body,
      eyebrow: "Test mail",
      title: "Your mail is working",
      preheader: "Resend and the sender domain are set up correctly.",
      footerNote: "You get this mail because someone entered your address in the portal's test mail form.",
      siteUrl,
    }),
  };
}
