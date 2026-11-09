import type { AcademyLocale } from "@/lib/academy/database";
import { escapeMailHtml as esc, mailButton, mailLinkFallback, mailParagraph, renderMailLayout } from "@/lib/notify/layout";

// The invitation to the Academy (Academy: beheer-editor en mensen
// toevoegen), in the person's language. Pure, tested in
// tests/academy-mail.test.ts; sent by src/app/dashboard/academy/people/actions.ts.

export function academyInviteMail({
  name,
  url,
  invitedBy,
  locale,
  courseTitle,
  linkKind,
  siteUrl,
}: {
  name: string;
  /** The one-time link (set password) or the sign-in page for an existing account. */
  url: string;
  invitedBy: string;
  locale: AcademyLocale;
  courseTitle: string | null;
  /** new: invite link; reset: set a (new) password; login: account with a password already. */
  linkKind: "new" | "reset" | "login";
  siteUrl?: string;
}) {
  const first = name.trim().split(/\s+/)[0] || name;
  const nl = locale === "nl";
  const subject = nl ? "Je bent uitgenodigd voor de Nordavo Academy" : "You are invited to the Nordavo Academy";
  const action =
    linkKind === "login"
      ? nl
        ? "Inloggen"
        : "Sign in"
      : linkKind === "reset"
        ? nl
          ? "Stel een nieuw wachtwoord in"
          : "Set a new password"
        : nl
          ? "Stel je wachtwoord in"
          : "Set your password";
  const course = courseTitle
    ? nl
      ? ` voor de course <strong>${esc(courseTitle)}</strong>`
      : ` to the course <strong>${esc(courseTitle)}</strong>`
    : "";
  const courseText = courseTitle ? (nl ? ` voor de course ${courseTitle}` : ` to the course ${courseTitle}`) : "";
  const intro = nl
    ? `${esc(invitedBy)} van Nordavo heeft je toegevoegd aan de Nordavo Academy${course}. Je volgt er je lessen, ziet je voortgang en gaat altijd verder waar je was.`
    : `${esc(invitedBy)} from Nordavo added you to the Nordavo Academy${course}. Follow your lessons there, see your progress and always continue where you left off.`;
  const expiry =
    linkKind === "login"
      ? nl
        ? "Log in met je bestaande wachtwoord of passkey."
        : "Sign in with your existing password or passkey."
      : nl
        ? "De link werkt één keer en verloopt na een dag. Vraag Nordavo om een nieuwe als hij niet meer werkt."
        : "The link works once and expires after a day. Ask Nordavo for a new one if it no longer works.";
  const greeting = nl ? `Hoi ${esc(first)},` : `Hi ${esc(first)},`;
  const regards = nl ? "Groet,<br>Nordavo" : "Kind regards,<br>Nordavo";

  const body = [mailParagraph(greeting), mailParagraph(intro), mailButton(url, action), mailLinkFallback(url), mailParagraph(expiry), mailParagraph(regards)].join("\n");
  const text = [
    nl ? `Hoi ${first},` : `Hi ${first},`,
    "",
    nl
      ? `${invitedBy} van Nordavo heeft je toegevoegd aan de Nordavo Academy${courseText}.`
      : `${invitedBy} from Nordavo added you to the Nordavo Academy${courseText}.`,
    "",
    `${action}: ${url}`,
    "",
    expiry,
    "",
    nl ? "Groet," : "Kind regards,",
    "Nordavo",
  ].join("\n");

  return {
    subject,
    text,
    html: renderMailLayout({
      body,
      eyebrow: "Academy",
      title: nl ? "Welkom bij de Nordavo Academy" : "Welcome to the Nordavo Academy",
      preheader: nl ? `${action} en begin aan je eerste les.` : `${action} and start your first lesson.`,
      footerNote: nl ? "Je krijgt deze mail omdat Nordavo je heeft toegevoegd aan de Academy." : "You get this mail because Nordavo added you to the Academy.",
      siteUrl,
    }),
  };
}
