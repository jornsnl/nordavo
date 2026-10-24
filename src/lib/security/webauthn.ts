import "server-only";
import { cookies } from "next/headers";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import type { WebauthnChallengeKind } from "@/lib/database.types";
import { env } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Relying party settings and challenge storage for passkeys (WebAuthn).
 *
 * The rpID is the domain a passkey belongs to: a passkey made on
 * portaal.nordavo.nl only works there. For local development the
 * defaults (localhost, http://localhost:3000) work without extra settings.
 */

export const rpName = "Nordavo";

export function rpID(): string {
  return process.env.WEBAUTHN_RP_ID || new URL(env.siteUrl()).hostname;
}

export function expectedOrigin(): string {
  return process.env.WEBAUTHN_ORIGIN || new URL(env.siteUrl()).origin;
}

/** How long the browser prompt may stay open, in ms. The challenge lives 5 minutes. */
export const WEBAUTHN_TIMEOUT = 60_000;

const CHALLENGE_MAX_AGE = 60 * 5;

// One cookie per ceremony, so starting a sign-in never cancels a registration.
function challengeCookie(kind: WebauthnChallengeKind) {
  return `nordavo-webauthn-${kind}`;
}

/**
 * Stores a challenge for this browser. The row id goes into a short lived,
 * httpOnly cookie, so only the browser that asked for it can use it.
 * Returns false without the secret key (the table has no RLS policies).
 */
export async function storeChallenge(
  kind: WebauthnChallengeKind,
  challenge: string,
  userId: string | null,
): Promise<boolean> {
  const admin = createAdminClient();
  if (!admin) return false;

  // Keep the table small: drop challenges nobody finished.
  await admin.from("webauthn_challenges").delete().lt("expires_at", new Date().toISOString());

  const { data, error } = await admin
    .from("webauthn_challenges")
    .insert({ kind, challenge, user_id: userId })
    .select("id")
    .single();

  if (error || !data) {
    console.error("storeChallenge", error);
    return false;
  }

  const cookieStore = await cookies();
  cookieStore.set(challengeCookie(kind), data.id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: CHALLENGE_MAX_AGE,
  });
  return true;
}

/**
 * Takes this browser's challenge, exactly once: the row is deleted as it is
 * read, so a replayed response finds nothing. Null when missing, expired or
 * created for another user.
 */
export async function consumeChallenge(
  kind: WebauthnChallengeKind,
  userId: string | null,
): Promise<string | null> {
  const cookieStore = await cookies();
  const id = cookieStore.get(challengeCookie(kind))?.value;
  cookieStore.delete(challengeCookie(kind));
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return null;

  const admin = createAdminClient();
  if (!admin) return null;

  const { data, error } = await admin
    .from("webauthn_challenges")
    .delete()
    .eq("id", id)
    .eq("kind", kind)
    .select("challenge, user_id, expires_at")
    .maybeSingle();

  if (error) {
    console.error("consumeChallenge", error);
    return null;
  }
  if (!data) return null;
  if (new Date(data.expires_at).getTime() < Date.now()) return null;
  if (data.user_id !== userId) return null;
  return data.challenge;
}

/** The WebAuthn user handle for a Supabase user: the user id, never the e-mail. */
export function userHandleFor(userId: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(userId);
}

/** Reverse of userHandleFor, for the base64url userHandle in a sign-in response. */
export function userIdFromHandle(userHandle: string | undefined): string | null {
  if (!userHandle) return null;
  try {
    return isoBase64URL.toUTF8String(userHandle);
  } catch {
    return null;
  }
}

/** The COSE public key as stored in passkeys.public_key. */
export function encodePublicKey(publicKey: Uint8Array<ArrayBuffer>): string {
  return isoBase64URL.fromBuffer(publicKey);
}

export function decodePublicKey(value: string): Uint8Array<ArrayBuffer> {
  return isoBase64URL.toBuffer(value);
}
