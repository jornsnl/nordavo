import { env } from "@/lib/env";

/**
 * The landing link for a link made with auth.admin.generateLink(): verify the
 * token, sign in, then open "Set password". Always on the public address of the
 * portal (src/lib/site-url.ts), never localhost in production.
 */
export function confirmUrl(hashedToken: string, type: "invite" | "recovery"): string {
  return `${env.siteUrl().replace(/\/$/, "")}/auth/confirm?token_hash=${encodeURIComponent(hashedToken)}&type=${type}&next=/auth/password`;
}

/** Where Supabase sends someone after its own mail (only used as redirectTo). */
export function setPasswordRedirect(): string {
  return `${env.siteUrl().replace(/\/$/, "")}/auth/confirm?next=/auth/password`;
}
