/**
 * The public address of the portal, used in every link we put in a mail
 * (invites, sign-in and password links, the logo).
 *
 * NEXT_PUBLIC_SITE_URL wins. In production a missing or localhost value must
 * never end up in a mail (an invite that opens "localhost" cannot be used), so
 * there we fall back to the production domain of the hosting and then to
 * PRODUCTION_SITE_URL. Locally the default stays http://localhost:3000.
 */
export const PRODUCTION_SITE_URL = "https://portal.nordavo.nl";

type Vars = Record<string, string | undefined>;

function clean(value: string | undefined): string | null {
  const v = (value ?? "").trim().replace(/\/+$/, "");
  if (!v) return null;
  return /^https?:\/\//i.test(v) ? v : `https://${v}`;
}

export function isLocalUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host.endsWith(".localhost");
  } catch {
    return true;
  }
}

export function resolveSiteUrl(vars: Vars): string {
  const configured = clean(vars.NEXT_PUBLIC_SITE_URL);
  const production = vars.NODE_ENV === "production";
  if (configured && !(production && isLocalUrl(configured))) return configured;
  if (!production) return configured ?? "http://localhost:3000";
  return clean(vars.VERCEL_PROJECT_PRODUCTION_URL) ?? PRODUCTION_SITE_URL;
}
