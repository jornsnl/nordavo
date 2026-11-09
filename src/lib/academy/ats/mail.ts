import type { AcademyLocale } from "@/lib/academy/database";
import { escapeMailHtml as esc, mailButton, mailLinkFallback, mailParagraph, renderMailLayout } from "@/lib/notify/layout";

// Mails of the ATS automation (docs/academy.md, ATS-koppeling), in the
// person's language: a reminder when a candidate gets stuck, the welcome
// mail when a placement starts (developer and client) and the mail to a new
// top candidate. Pure, tested in tests/academy-ats.test.ts; sent by
// src/lib/academy/ats/process.ts and src/jobs/academy-ats.ts.

type Mail = { subject: string; html: string; text: string };

function firstName(name: string | null | undefined): string {
  const trimmed = (name ?? "").trim();
  return trimmed.split(/\s+/)[0] || trimmed;
}

function layout(
  locale: AcademyLocale,
  { title, preheader, paragraphs, action, url, siteUrl }: {
    title: string;
    preheader: string;
    paragraphs: string[];
    action: string;
    url: string;
    siteUrl?: string;
  },
): string {
  const nl = locale === "nl";
  const body = [...paragraphs.map(mailParagraph), mailButton(url, action), mailLinkFallback(url), mailParagraph(nl ? "Groet,<br>Nordavo" : "Kind regards,<br>Nordavo")].join("\n");
  return renderMailLayout({
    body,
    eyebrow: "Academy",
    title,
    preheader,
    footerNote: nl ? "Je krijgt deze mail omdat je in de Nordavo Academy zit." : "You get this mail because you are in the Nordavo Academy.",
    siteUrl,
  });
}

/** A candidate did nothing for a while: the next lesson, friendly. */
export function stuckReminderMail({
  name,
  locale,
  courseTitle,
  lessonTitle,
  url,
  daysInactive,
  siteUrl,
}: {
  name: string | null;
  locale: AcademyLocale;
  courseTitle: string;
  lessonTitle: string;
  url: string;
  daysInactive: number;
  siteUrl?: string;
}): Mail {
  const nl = locale === "nl";
  const first = firstName(name);
  const subject = nl ? `Ga verder met ${courseTitle}` : `Continue with ${courseTitle}`;
  const greeting = nl ? `Hoi ${first},` : `Hi ${first},`;
  const intro = nl
    ? `Je bent al ${daysInactive} dagen niet in de Nordavo Academy geweest. Je volgende les staat klaar: <strong>${esc(lessonTitle)}</strong>.`
    : `You have not been in the Nordavo Academy for ${daysInactive} days. Your next lesson is ready: <strong>${esc(lessonTitle)}</strong>.`;
  const help = nl
    ? "Loop je ergens vast? Antwoord op deze mail, dan helpen we je verder."
    : "Stuck on something? Reply to this mail and we will help you along.";
  const action = nl ? "Ga verder" : "Continue";
  const html = layout(locale, {
    title: nl ? "Je volgende les wacht" : "Your next lesson is waiting",
    preheader: nl ? `Volgende les: ${lessonTitle}` : `Next lesson: ${lessonTitle}`,
    paragraphs: [esc(greeting), intro, help],
    action,
    url,
    siteUrl,
  });
  const text = [
    greeting,
    "",
    nl
      ? `Je bent al ${daysInactive} dagen niet in de Nordavo Academy geweest. Je volgende les: ${lessonTitle}.`
      : `You have not been in the Nordavo Academy for ${daysInactive} days. Your next lesson: ${lessonTitle}.`,
    "",
    `${action}: ${url}`,
    "",
    help,
  ].join("\n");
  return { subject, html, text };
}

/** Placed: welcome to the placement, for the developer or the client. */
export function placementWelcomeMail({
  name,
  locale,
  audience,
  clientName,
  developerName,
  startDate,
  url,
  linkKind,
  siteUrl,
}: {
  name: string | null;
  locale: AcademyLocale;
  audience: "developer" | "client";
  clientName: string;
  developerName: string;
  /** YYYY-MM-DD, shown as is. */
  startDate: string;
  url: string;
  /** new: set a password first; login: an existing account. */
  linkKind: "new" | "reset" | "login";
  siteUrl?: string;
}): Mail {
  const nl = locale === "nl";
  const first = firstName(name);
  const greeting = nl ? `Hoi ${first},` : `Hi ${first},`;
  const subject =
    audience === "developer"
      ? nl
        ? `Welkom bij ${clientName}`
        : `Welcome to ${clientName}`
      : nl
        ? `${developerName} start bij jullie: welkom in de Nordavo Academy`
        : `${developerName} starts with you: welcome to the Nordavo Academy`;
  // b(): bold and escaped in the HTML, plain in the text version.
  const introWith = (b: (v: string) => string, e: (v: string) => string) =>
    audience === "developer"
      ? nl
        ? `Gefeliciteerd: je start op ${e(startDate)} bij ${b(clientName)}. De hele developercourse staat nu voor je open; wat je al hebt afgerond blijft staan. Op je plaatsingspagina vind je de tijdlijn, je eerste taken en de rituelen.`
        : `Congratulations: you start on ${e(startDate)} at ${b(clientName)}. The whole developer course is now open for you; what you already finished stays done. Your placement page has the timeline, your first tasks and the rituals.`
      : nl
        ? `${b(developerName)} start op ${e(startDate)} bij jullie. In de Nordavo Academy staat de klantcourse voor je klaar: rond module 1 af voordat je developer start. Op de plaatsingspagina zie je de tijdlijn, de afspraken en de voortgang.`
        : `${b(developerName)} starts with you on ${e(startDate)}. The client course is ready for you in the Nordavo Academy: finish module 1 before your developer starts. The placement page shows the timeline, the agreements and the progress.`;
  const intro = introWith((v) => `<strong>${esc(v)}</strong>`, esc);
  const introText = introWith((v) => v, (v) => v);
  const action =
    linkKind === "login" ? (nl ? "Open de Academy" : "Open the Academy") : nl ? "Stel je wachtwoord in" : "Set your password";
  const expiry =
    linkKind === "login"
      ? nl
        ? "Log in met je bestaande wachtwoord of passkey."
        : "Sign in with your existing password or passkey."
      : nl
        ? "De link werkt één keer en verloopt na een dag. Vraag Nordavo om een nieuwe als hij niet meer werkt."
        : "The link works once and expires after a day. Ask Nordavo for a new one if it no longer works.";
  const html = layout(locale, {
    title: nl ? "Welkom" : "Welcome",
    preheader: nl ? `Start op ${startDate}` : `Start on ${startDate}`,
    paragraphs: [esc(greeting), intro, expiry],
    action,
    url,
    siteUrl,
  });
  const text = [greeting, "", introText, "", `${action}: ${url}`, "", expiry].join("\n");
  return { subject, html, text };
}

/** Marked as top candidate: which modules opened. */
export function topCandidateMail({
  name,
  locale,
  moduleTitles,
  url,
  siteUrl,
}: {
  name: string | null;
  locale: AcademyLocale;
  moduleTitles: string[];
  url: string;
  siteUrl?: string;
}): Mail {
  const nl = locale === "nl";
  const first = firstName(name);
  const greeting = nl ? `Hoi ${first},` : `Hi ${first},`;
  const subject = nl ? "Er staan nieuwe modules voor je open" : "New modules are open for you";
  const list = `<ul>${moduleTitles.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>`;
  const intro = nl
    ? "Goed bezig. Nordavo heeft extra modules van de developercourse voor je opengezet:"
    : "Well done. Nordavo opened extra modules of the developer course for you:";
  const action = nl ? "Bekijk de modules" : "See the modules";
  const html = layout(locale, {
    title: nl ? "Nieuwe modules" : "New modules",
    preheader: moduleTitles.join(", "),
    paragraphs: [esc(greeting), `${intro}${list}`],
    action,
    url,
    siteUrl,
  });
  const text = [greeting, "", intro, ...moduleTitles.map((t) => `- ${t}`), "", `${action}: ${url}`].join("\n");
  return { subject, html, text };
}
