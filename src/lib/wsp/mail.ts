import { escapeMailHtml as esc, mailButton, mailLinkFallback, mailParagraph, renderMailLayout } from "@/lib/notify/layout";
import { REPORT_TITLE } from "./content";
import { flagReason } from "./scoring";
import { formatWspDate, splitName, withdrawnMailText } from "./text";

// The mails of the Working Style Profile, in English (part 4: no
// translations). Pure, tested in tests/wsp.test.ts, sent from the outbox by
// src/lib/wsp/outbox.ts. The withdrawal mail to the client is the exact text
// of the assignment.

export type Mail = { subject: string; html: string; text: string };

function layout({ title, preheader, paragraphs, action, url, footerNote, siteUrl }: {
  title: string;
  preheader: string;
  paragraphs: string[];
  action?: string;
  url?: string;
  footerNote: string;
  siteUrl?: string;
}): string {
  const body = [
    ...paragraphs.map((p) => mailParagraph(esc(p))),
    ...(action && url ? [mailButton(url, action), mailLinkFallback(url)] : []),
    mailParagraph("Kind regards,<br>Nordavo"),
  ].join("\n");
  return renderMailLayout({ body, eyebrow: REPORT_TITLE, title, preheader, footerNote, siteUrl });
}

const PERSON_FOOTER = "You get this mail because Nordavo invited you to the Working Style Profile.";

/** The invitation (also after a resend). Developers read that it is optional. */
export function inviteMail({ name, url, expiresAt, developer, siteUrl }: {
  name: string;
  url: string;
  expiresAt: string;
  developer: boolean;
  siteUrl?: string;
}): Mail {
  const first = splitName(name).first || "there";
  const paragraphs = [
    `Hi ${first},`,
    "Nordavo invites you to complete your Working Style Profile: 52 short statements, about 10 minutes. It helps you understand how you like to work, and helps the companies you work with understand how to get the best out of you.",
    ...(developer ? ["This is optional. Not completing it has no consequences for your role."] : []),
    "You always see your own report first. Your profile is never shared with a client company unless you tick the box for that company yourself.",
    `The link is personal and works until ${formatWspDate(expiresAt)}.`,
  ];
  return {
    subject: "Your Working Style Profile (about 10 minutes)",
    html: layout({ title: "Your Working Style Profile", preheader: "52 short statements, about 10 minutes.", paragraphs, action: "Start the questionnaire", url, footerNote: PERSON_FOOTER, siteUrl }),
    text: [...paragraphs, "", url, "", "Kind regards,", "Nordavo"].join("\n"),
  };
}

/** One reminder, 3 days after the invitation when it was not started. */
export function reminderMail({ name, url, expiresAt, siteUrl }: { name: string; url: string; expiresAt: string; siteUrl?: string }): Mail {
  const first = splitName(name).first || "there";
  const paragraphs = [
    `Hi ${first},`,
    "A short reminder: your Working Style Profile is still waiting for you. It takes about 10 minutes and your answers are saved as you go.",
    `The link works until ${formatWspDate(expiresAt)}.`,
  ];
  return {
    subject: "Reminder: your Working Style Profile",
    html: layout({ title: "Your Working Style Profile", preheader: "About 10 minutes, saved as you go.", paragraphs, action: "Continue", url, footerNote: PERSON_FOOTER, siteUrl }),
    text: [...paragraphs, "", url, "", "Kind regards,", "Nordavo"].join("\n"),
  };
}

/** "Ask for permission": the person decides on the sharing page. */
export function permissionMail({ name, clientName, url, siteUrl }: { name: string; clientName: string; url: string; siteUrl?: string }): Mail {
  const first = splitName(name).first || "there";
  const paragraphs = [
    `Hi ${first},`,
    `${clientName} would like to see your Working Style Profile. Nothing is shared unless you tick the box for ${clientName} yourself, and you can withdraw your permission at any time.`,
  ];
  return {
    subject: `May ${clientName} see your Working Style Profile?`,
    html: layout({ title: "A request to share your profile", preheader: `${clientName} would like to see your profile.`, paragraphs, action: "Open my working style profile", url, footerNote: PERSON_FOOTER, siteUrl }),
    text: [...paragraphs, "", url, "", "Kind regards,", "Nordavo"].join("\n"),
  };
}

/** To the client contact when a share ends (exact text). */
export function withdrawnMail({ fullName, siteUrl }: { fullName: string; siteUrl?: string }): Mail {
  const sentence = withdrawnMailText(splitName(fullName).first || fullName);
  return {
    subject: "Working Style Profile: permission withdrawn",
    html: renderMailLayout({
      body: mailParagraph(esc(sentence)),
      eyebrow: REPORT_TITLE,
      title: "Permission withdrawn",
      preheader: sentence,
      footerNote: "You get this mail because a Working Style Profile was shared with your company in the Nordavo portal.",
      siteUrl,
    }),
    text: sentence,
  };
}

/** To the Nordavo team: the questionnaire is done, with any flags. */
export function completedMail({ name, flags, url, siteUrl }: { name: string; flags: string[]; url: string; siteUrl?: string }): Mail {
  const paragraphs = [
    `${name} completed the Working Style Profile.`,
    flags.length
      ? `Interpret with caution: ${flags.map((type) => flagReason({ type, details: {} })).join(" ")}`
      : "No quality flags.",
  ];
  return {
    subject: `Working Style Profile completed: ${name}${flags.length ? " (interpret with caution)" : ""}`,
    html: layout({ title: "Working Style Profile completed", preheader: paragraphs[1], paragraphs, action: "Open the profile", url, footerNote: "Sent by the Nordavo portal.", siteUrl }),
    text: [...paragraphs, "", url].join("\n"),
  };
}
