import { escapeMailHtml as esc, mailButton, mailLinkFallback, mailNotice, mailParagraph, renderMailLayout } from "@/lib/notify/layout";

// The invitation for an external caller (Settings, Callers). Pure, so it is
// tested without sending; src/app/dashboard/settings/caller-actions.ts sends it.

export function callerInviteMail({
  name,
  url,
  invitedBy,
  existingAccount,
  siteUrl,
}: {
  name: string;
  /** The one-time link that signs in and opens "Set password". */
  url: string;
  invitedBy: string;
  /** The address already had an account: the link sets a new password. */
  existingAccount: boolean;
  siteUrl?: string;
}) {
  const first = name.trim().split(/\s+/)[0] || name;
  const subject = "You are invited to call for Nordavo";
  const action = existingAccount ? "Set a new password" : "Set your password";
  const body = [
    mailParagraph(`Hi ${esc(first)},`),
    mailParagraph(
      `${esc(invitedBy)} invited you to call for Nordavo. In the call screen you see who to call next, the number, what the company does and what happened before. You log the outcome with one tap.`,
    ),
    mailButton(url, action),
    mailLinkFallback(url),
    mailNotice(
      "<strong>An authenticator app is required.</strong> After your password you set up an app such as Google Authenticator or Microsoft Authenticator. Without it the call screen stays closed.",
    ),
    mailParagraph("The link works once and expires after a day. Ask Nordavo for a new one if it no longer works."),
    mailParagraph("Kind regards,<br>Nordavo"),
  ].join("\n");
  const text = [
    `Hi ${first},`,
    "",
    `${invitedBy} invited you to call for Nordavo.`,
    "",
    `${action}: ${url}`,
    "",
    "An authenticator app is required: after your password you set up an app such as Google Authenticator or Microsoft Authenticator.",
    "",
    "The link works once and expires after a day. Ask Nordavo for a new one if it no longer works.",
    "",
    "Kind regards,",
    "Nordavo",
  ].join("\n");
  return {
    subject,
    text,
    html: renderMailLayout({
      body,
      eyebrow: "Calling",
      title: "Welcome to the Nordavo call screen",
      preheader: `${action} and start calling for Nordavo.`,
      footerNote: "You get this mail because Nordavo added you as a caller.",
      siteUrl,
    }),
  };
}
