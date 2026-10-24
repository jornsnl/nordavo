"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/server";
import { z } from "zod";
import { safeNextPath } from "@/lib/safe-redirect";
import {
  PASSKEY_SESSION_COOKIE,
  createPasskeySessionValue,
  passkeySessionCookieOptions,
} from "@/lib/security/passkey-session";
import {
  WEBAUTHN_TIMEOUT,
  consumeChallenge,
  decodePublicKey,
  expectedOrigin,
  rpID,
  storeChallenge,
  userIdFromHandle,
} from "@/lib/security/webauthn";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type PasskeySignInResult = { error?: string };

// One message for every failure, so nobody learns whether an account or passkey exists.
const SIGN_IN_FAILED =
  "Inloggen met deze passkey lukt niet. Probeer het opnieuw of log in met je wachtwoord.";

/** Step 1: a challenge for the browser prompt. No e-mail needed: the passkey knows who you are. */
export async function startPasskeySignIn(): Promise<{
  options?: PublicKeyCredentialRequestOptionsJSON;
  error?: string;
}> {
  const options = await generateAuthenticationOptions({
    rpID: rpID(),
    timeout: WEBAUTHN_TIMEOUT,
    userVerification: "required",
  });

  if (!(await storeChallenge("authentication", options.challenge, null))) {
    return { error: "Inloggen met een passkey is nu niet mogelijk. Log in met je wachtwoord." };
  }
  return { options };
}

// Only the shape; verifyAuthenticationResponse checks the contents.
const authenticationResponseSchema = z
  .object({
    id: z.string().min(1).max(1024),
    rawId: z.string().min(1).max(1024),
    type: z.literal("public-key"),
    response: z
      .object({
        clientDataJSON: z.string().min(1),
        authenticatorData: z.string().min(1),
        signature: z.string().min(1),
        userHandle: z.string().optional(),
      })
      .loose(),
  })
  .loose();

/**
 * Step 2: verify the signed challenge, then sign the owner of the passkey in
 * with a real Supabase session. Redirects on success.
 */
export async function finishPasskeySignIn(
  response: AuthenticationResponseJSON,
  next: string | null,
): Promise<PasskeySignInResult> {
  const parsed = authenticationResponseSchema.safeParse(response);
  // Consume first, so even a malformed answer uses up the challenge.
  const challenge = await consumeChallenge("authentication", null);
  if (!parsed.success) return { error: SIGN_IN_FAILED };
  if (!challenge) {
    return { error: "Dit duurde te lang. Probeer het opnieuw." };
  }

  const admin = createAdminClient();
  if (!admin) return { error: SIGN_IN_FAILED };

  const { data: passkey, error: lookupError } = await admin
    .from("passkeys")
    .select("id, user_id, credential_id, public_key, counter, transports")
    .eq("credential_id", parsed.data.id)
    .maybeSingle();

  if (lookupError) console.error("finishPasskeySignIn lookup", lookupError);
  if (!passkey) return { error: SIGN_IN_FAILED };

  // Discoverable credentials carry the user handle we set at registration.
  const handle = parsed.data.response.userHandle;
  if (handle && userIdFromHandle(handle) !== passkey.user_id) {
    return { error: SIGN_IN_FAILED };
  }

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: parsed.data as unknown as AuthenticationResponseJSON,
      expectedChallenge: challenge,
      expectedOrigin: expectedOrigin(),
      expectedRPID: rpID(),
      credential: {
        id: passkey.credential_id,
        publicKey: decodePublicKey(passkey.public_key),
        counter: passkey.counter,
        transports: passkey.transports,
      },
      requireUserVerification: true,
    });
  } catch (error) {
    // Includes a signature counter that went backwards: a sign of a cloned authenticator.
    console.error("finishPasskeySignIn verify", error instanceof Error ? error.message : error);
    return { error: SIGN_IN_FAILED };
  }

  if (!verification.verified) return { error: SIGN_IN_FAILED };

  const { newCounter, credentialBackedUp } = verification.authenticationInfo;
  const { error: updateError } = await admin
    .from("passkeys")
    .update({
      counter: newCounter,
      backed_up: credentialBackedUp,
      last_used_at: new Date().toISOString(),
    })
    .eq("id", passkey.id);
  if (updateError) console.error("finishPasskeySignIn update", updateError);

  // Turn the verified passkey into a Supabase session: a one-time magic link
  // token, redeemed right here so the auth cookies are set on this response.
  const { data: userData, error: userError } = await admin.auth.admin.getUserById(passkey.user_id);
  const email = userData?.user?.email;
  if (userError || !email) {
    console.error("finishPasskeySignIn user", userError?.code, userError?.message);
    return { error: SIGN_IN_FAILED };
  }

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkError || !link?.properties?.hashed_token) {
    console.error("finishPasskeySignIn link", linkError?.code, linkError?.message);
    return { error: SIGN_IN_FAILED };
  }

  const supabase = await createClient();
  const { data: auth, error: otpError } = await supabase.auth.verifyOtp({
    type: "magiclink",
    token_hash: link.properties.hashed_token,
  });
  if (otpError || !auth.session || auth.user?.id !== passkey.user_id) {
    console.error("finishPasskeySignIn session", otpError?.code, otpError?.message);
    await supabase.auth.signOut({ scope: "local" });
    return { error: SIGN_IN_FAILED };
  }

  // Mark this session as signed in with a passkey, which counts as two-step verification.
  const { data: claims } = await supabase.auth.getClaims(auth.session.access_token);
  const sessionId = claims?.claims.session_id;
  const cookieStore = await cookies();
  const value = typeof sessionId === "string" ? await createPasskeySessionValue(sessionId) : null;
  if (value) {
    cookieStore.set(PASSKEY_SESSION_COOKIE, value, passkeySessionCookieOptions);
  } else {
    cookieStore.delete(PASSKEY_SESSION_COOKIE);
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("role")
    .eq("id", passkey.user_id)
    .maybeSingle();

  if (profile?.role === "client") {
    redirect("/portaal");
  }
  redirect(safeNextPath(next));
}
