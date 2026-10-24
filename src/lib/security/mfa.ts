import type { Factor, JwtPayload, SupabaseClient } from "@supabase/supabase-js";
import { PASSKEY_SESSION_COOKIE, isPasskeySession } from "@/lib/security/passkey-session";

/**
 * Two-step verification with an authenticator app (TOTP), shared by the
 * proxy and the Data Access Layer.
 *
 * A session that only did the first step (aal1) while the user has a verified
 * app must finish /login/verificatie first. A passkey sign-in counts as two
 * factors, see passkey-session.ts.
 *
 * The factor list inside the session cookie is not signed, so a user could
 * remove it from their own cookie. We therefore ask Supabase Auth itself
 * (getUser) and remember a "no app found" answer for a few minutes in a signed
 * cookie tied to the session id. Uses Web Crypto only, so it runs in the proxy.
 */

export const MFA_VERIFY_PATH = "/login/verificatie";

/** Remembers that this session's user has no authenticator app. */
export const MFA_CHECK_COOKIE = "nordavo-mfa-check";

/** How long a "no app" answer is trusted; an app added elsewhere is enforced after this. */
export const MFA_CHECK_MAX_AGE = 60 * 10;

export const mfaCheckCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: MFA_CHECK_MAX_AGE,
};

/** Verified authenticator apps of a user. Other factor types are not offered in the portal. */
export function verifiedTotpFactors(factors: Factor[] | undefined | null): Factor[] {
  return (factors ?? []).filter(
    (factor) => factor.factor_type === "totp" && factor.status === "verified",
  );
}

export function hasVerifiedTotp(factors: Factor[] | undefined | null) {
  return verifiedTotpFactors(factors).length > 0;
}

function secret(): string | null {
  return process.env.PASSKEY_SESSION_SECRET || process.env.SUPABASE_SECRET_KEY || null;
}

function toBase64Url(bytes: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sign(message: string, key: string): Promise<string> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  // The "mfa-none:" prefix keeps these signatures apart from the passkey cookie.
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(`mfa-none:${message}`));
  return toBase64Url(signature);
}

async function createMfaCheckValue(sessionId: string): Promise<string | null> {
  const key = secret();
  if (!key || !sessionId) return null;
  const expires = Math.floor(Date.now() / 1000) + MFA_CHECK_MAX_AGE;
  return `${sessionId}.${expires}.${await sign(`${sessionId}.${expires}`, key)}`;
}

async function isMfaCheckValid(value: string | undefined, sessionId: string): Promise<boolean> {
  const key = secret();
  if (!key || !value || !sessionId) return false;
  const [cookieSessionId, expires, actual, ...rest] = value.split(".");
  if (rest.length > 0 || !actual || cookieSessionId !== sessionId) return false;
  const expiresAt = Number(expires);
  if (!Number.isInteger(expiresAt) || expiresAt < Math.floor(Date.now() / 1000)) return false;
  const expected = await sign(`${sessionId}.${expires}`, key);
  if (expected.length !== actual.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ actual.charCodeAt(i);
  return diff === 0;
}

export type SecondStep = {
  /** True when this session must enter an authenticator app code first. */
  required: boolean;
  /** Set this as MFA_CHECK_COOKIE (where cookies can be written) to skip the lookup next time. */
  checkCookie?: string;
};

/**
 * Whether a signed-in session still needs its second step. Pass verified
 * claims from getClaims(). Fails closed: when Supabase Auth cannot be asked,
 * the session is treated as unverified.
 */
export async function checkSecondStep(
  supabase: { auth: Pick<SupabaseClient["auth"], "getUser"> },
  claims: Pick<JwtPayload, "aal" | "session_id">,
  readCookie: (name: string) => string | undefined,
): Promise<SecondStep> {
  if (claims.aal === "aal2") return { required: false };

  const sessionId = claims.session_id;
  if (await isPasskeySession(readCookie(PASSKEY_SESSION_COOKIE), sessionId)) {
    return { required: false };
  }
  if (await isMfaCheckValid(readCookie(MFA_CHECK_COOKIE), sessionId)) {
    return { required: false };
  }

  // The source of truth: the user's factors according to Supabase Auth.
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return { required: true };
  if (hasVerifiedTotp(data.user.factors)) return { required: true };

  return { required: false, checkCookie: (await createMfaCheckValue(sessionId)) ?? undefined };
}
