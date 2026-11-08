import type { ProfileRole } from "@/lib/database.types";

/**
 * Who may sign in with a one-time link by e-mail (Supabase magic link)
 * instead of a password.
 *
 * Only Work guests and freelancers (portal role "external"). Nordavo staff
 * and client users keep their password, passkey and authenticator app: a
 * mailed link would let anyone with access to their inbox in without the
 * password. The rule is applied in three places:
 *  1. no link is made or mailed for other roles (Work sign-in, /login, invites);
 *  2. /auth/confirm signs a link session of any other role straight out
 *     again, so a link Supabase mailed by itself cannot get around it;
 *  3. an authenticator app still applies: the proxy asks for the code on any
 *     aal1 session of a user with a verified app (src/lib/security/mfa.ts).
 */
export const SIGN_IN_LINK_ROLES: readonly ProfileRole[] = ["external"];

export function mayUseSignInLink(role: string | null | undefined): boolean {
  return SIGN_IN_LINK_ROLES.includes((role ?? "external") as ProfileRole);
}

/** OTP types of /auth/confirm that are a sign-in link (not an invite or password reset). */
export function isSignInLinkType(type: string | null | undefined): boolean {
  return type === "email" || type === "magiclink";
}

/** The landing URL for a link made with auth.admin.generateLink(). */
export function signInLinkUrl(site: string, hashedToken: string, next: string): string {
  return `${site.replace(/\/$/, "")}/auth/confirm?token_hash=${encodeURIComponent(hashedToken)}&type=email&next=${encodeURIComponent(next)}`;
}

export const SIGN_IN_LINK_SENT = (email: string) =>
  `If ${email} is invited to Work, a sign-in link is on its way. It works once, within an hour. Nordavo team members and clients sign in with their password or passkey.`;
