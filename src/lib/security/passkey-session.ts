/**
 * Marks a Supabase session as signed in with a passkey.
 *
 * A passkey sign-in is phishing resistant and verifies the user on the device
 * (fingerprint, face or PIN), so it counts as two factors. Supabase Auth only
 * knows aal1 for that session, so we keep a signed, httpOnly cookie that ties
 * the passkey sign-in to the session id in the JWT. The proxy and the Data
 * Access Layer accept that cookie in place of an authenticator app code.
 *
 * Uses Web Crypto only, so it runs in the proxy as well as on the server.
 */

export const PASSKEY_SESSION_COOKIE = "nordavo-passkey-session";

/** Lives as long as a typical Supabase session; it is useless after sign out anyway. */
export const PASSKEY_SESSION_MAX_AGE = 60 * 60 * 24 * 30;

function secret(): string | null {
  return process.env.PASSKEY_SESSION_SECRET || process.env.SUPABASE_SECRET_KEY || null;
}

function toBase64Url(bytes: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sign(sessionId: string, key: string): Promise<string> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(`passkey:${sessionId}`));
  return toBase64Url(signature);
}

/** Cookie value for a session that was just created with a passkey. Null without a secret. */
export async function createPasskeySessionValue(sessionId: string): Promise<string | null> {
  const key = secret();
  if (!key || !sessionId) return null;
  return `${sessionId}.${await sign(sessionId, key)}`;
}

/** Whether the cookie value proves a passkey sign-in for this session id. */
export async function isPasskeySession(
  value: string | undefined,
  sessionId: string | undefined,
): Promise<boolean> {
  const key = secret();
  if (!key || !value || !sessionId) return false;
  const dot = value.lastIndexOf(".");
  if (dot <= 0) return false;
  const cookieSessionId = value.slice(0, dot);
  if (cookieSessionId !== sessionId) return false;
  const expected = await sign(sessionId, key);
  const actual = value.slice(dot + 1);
  if (expected.length !== actual.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ actual.charCodeAt(i);
  return diff === 0;
}

export const passkeySessionCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: PASSKEY_SESSION_MAX_AGE,
};
