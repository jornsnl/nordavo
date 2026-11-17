import { escapeMailHtml as esc, mailButton, mailLinkFallback, mailNotice, mailParagraph, renderMailLayout } from "@/lib/notify/layout";

// Mail for portal accounts (Settings > Users and the login page). Pure, so
// they are tested without sending; the server actions send them. The links are
// one-time links made with auth.admin.generateLink (see src/lib/site-url.ts for
// the address they point at), so Supabase's own plain invitation is not used.

export type UserInviteRole = "admin" | "member" | "client" | "external" | "content";

type InviteInput = {
  name: string;
  /** The one-time link that signs in and opens "Set password". */
  url: string;
  invitedBy: string;
  role: UserInviteRole;
  /** Company of a client account. */
  company?: string | null;
  /** Names of the modules of a team member, when restricted. */
  modules?: string[];
  /** What the Content only account can do (reviewer, viewer, author). */
  contentRole?: string | null;
  siteUrl?: string;
};

/** What the person gets to do, in one or two sentences, per role. */
export function roleIntro({ role, invitedBy, company, modules, contentRole }: Pick<InviteInput, "role" | "invitedBy" | "company" | "modules" | "contentRole">) {
  switch (role) {
    case "client":
      return company
        ? `${invitedBy} of Nordavo invites you to the client portal of ${company}. There you see your vacancies and the candidates we propose, and you can give feedback and plan interviews.`
        : `${invitedBy} of Nordavo invites you to the Nordavo client portal. There you see your vacancies and the candidates we propose, and you can give feedback and plan interviews.`;
    case "admin":
      return `${invitedBy} invites you as an admin of the Nordavo portal. You see all modules, manage the team and settings, and work in Work, Nordavo's task tool.`;
    case "member":
      return modules && modules.length > 0
        ? `${invitedBy} invites you to the Nordavo portal as a team member. You get access to ${modules.join(", ")}, and to Work, Nordavo's task tool.`
        : `${invitedBy} invites you to the Nordavo portal as a team member. You get access to Work, Nordavo's task tool.`;
    case "content":
      return `${invitedBy} invites you to Nordavo Content${contentRole === "reviewer" || !contentRole ? " as a reviewer: you read the LinkedIn posts and approve them or leave a comment" : contentRole === "author" ? " as an author: you write and plan LinkedIn posts" : " as a viewer: you see the planned LinkedIn posts"}. You also get your own inbox in Work.`;
    default:
      return `${invitedBy} invites you to Work, Nordavo's task tool. You see the projects you are added to and the tasks that are yours.`;
  }
}

const eyebrows: Record<UserInviteRole, string> = {
  admin: "Portal",
  member: "Portal",
  client: "Client portal",
  external: "Work",
  content: "Content",
};

export function userInviteMail(input: InviteInput) {
  const first = input.name.trim().split(/\s+/)[0] || input.name;
  const intro = roleIntro(input);
  const subject =
    input.role === "client"
      ? `${input.invitedBy} invites you to the Nordavo client portal${input.company ? ` of ${input.company}` : ""}`
      : `${input.invitedBy} invites you to Nordavo`;
  const body = [
    mailParagraph(`Hi ${esc(first)},`),
    mailParagraph(esc(intro)),
    mailParagraph("Choose a password to get started. You sign in with your e-mail address and this password."),
    mailButton(input.url, "Set your password"),
    mailLinkFallback(input.url),
    mailNotice("The link works once and expires after a day. If it no longer works, ask Nordavo for a new one, or use &ldquo;Forgot password?&rdquo; on the sign-in page."),
    mailParagraph("Kind regards,<br>Nordavo"),
  ].join("\n");
  const text = [
    `Hi ${first},`,
    "",
    intro,
    "",
    `Set your password: ${input.url}`,
    "",
    "The link works once and expires after a day. If it no longer works, ask Nordavo for a new one, or use \"Forgot password?\" on the sign-in page.",
    "",
    "Kind regards,",
    "Nordavo",
  ].join("\n");
  return {
    subject,
    text,
    html: renderMailLayout({
      body,
      eyebrow: eyebrows[input.role],
      title: input.role === "client" ? "Welcome to your Nordavo client portal" : "Welcome to the Nordavo portal",
      preheader: "Choose a password and sign in.",
      footerNote: "You get this mail because Nordavo created an account for you.",
      siteUrl: input.siteUrl,
    }),
  };
}

export function passwordResetMail({ name, url, siteUrl }: { name: string; url: string; siteUrl?: string }) {
  const first = name.trim().split(/\s+/)[0] || name;
  const subject = "Reset your Nordavo password";
  const body = [
    mailParagraph(`Hi ${esc(first)},`),
    mailParagraph("Someone asked to reset the password of your Nordavo account. Choose a new password with the button below; you are signed in right after."),
    mailButton(url, "Choose a new password"),
    mailLinkFallback(url),
    mailParagraph("The link works once and expires after an hour. Did not ask for it? Ignore this mail, your password stays as it is."),
  ].join("\n");
  const text = [
    `Hi ${first},`,
    "",
    "Someone asked to reset the password of your Nordavo account. Choose a new password: ",
    url,
    "",
    "The link works once and expires after an hour. Did not ask for it? Ignore this mail, your password stays as it is.",
  ].join("\n");
  return {
    subject,
    text,
    html: renderMailLayout({
      body,
      eyebrow: "Account",
      title: "Reset your password",
      preheader: "Choose a new password for your Nordavo account.",
      footerNote: "You get this mail because a password reset was asked for this address.",
      siteUrl,
    }),
  };
}
