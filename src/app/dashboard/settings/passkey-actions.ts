"use server";

import { revalidatePath } from "next/cache";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  type PublicKeyCredentialCreationOptionsJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { z } from "zod";
import { type ActionState, GENERIC_ERROR, fieldErrorsFrom, formValues } from "@/lib/action-state";
import { getCurrentUser } from "@/lib/auth";
import {
  WEBAUTHN_TIMEOUT,
  consumeChallenge,
  encodePublicKey,
  expectedOrigin,
  rpID,
  rpName,
  storeChallenge,
  userHandleFor,
} from "@/lib/security/webauthn";
import { hasAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// Staff manage passkeys on /dashboard/settings, client users on /portal/security.
function revalidateSecurityPages() {
  revalidatePath("/dashboard/settings");
  revalidatePath("/portal/security");
}

const nameSchema = z
  .string({ error: "Name your passkey" })
  .min(1, { error: "Name your passkey" })
  .max(80, { error: "At most 80 characters" });

const NOT_CONFIGURED =
  "Passkeys only work once SUPABASE_SECRET_KEY is set on the server.";

/** Step 1 of adding a passkey: options for the browser prompt. */
export async function startPasskeyRegistration(
  name: string,
): Promise<{ options?: PublicKeyCredentialCreationOptionsJSON; error?: string; fieldErrors?: Record<string, string> }> {
  const user = await getCurrentUser();
  const parsed = nameSchema.safeParse(typeof name === "string" ? name.trim() : undefined);
  if (!parsed.success) {
    return { error: "Check the name.", fieldErrors: { name: parsed.error.issues[0].message } };
  }
  if (!hasAdminClient()) return { error: NOT_CONFIGURED };

  const supabase = await createClient();
  const { data: existing, error } = await supabase
    .from("passkeys")
    .select("credential_id, transports")
    .eq("user_id", user.id);

  if (error) {
    console.error("startPasskeyRegistration", error);
    return { error: GENERIC_ERROR };
  }

  const options = await generateRegistrationOptions({
    rpName,
    rpID: rpID(),
    userName: user.email,
    userDisplayName: user.name,
    userID: userHandleFor(user.id),
    timeout: WEBAUTHN_TIMEOUT,
    attestationType: "none",
    // A device that already holds one of your passkeys is not offered again.
    excludeCredentials: (existing ?? []).map((passkey) => ({
      id: passkey.credential_id,
      transports: passkey.transports,
    })),
    authenticatorSelection: {
      residentKey: "required",
      userVerification: "required",
    },
  });

  if (!(await storeChallenge("registration", options.challenge, user.id))) {
    return { error: GENERIC_ERROR };
  }
  return { options };
}

// Only the shape; verifyRegistrationResponse checks the contents.
const registrationResponseSchema = z
  .object({
    id: z.string().min(1).max(1024),
    rawId: z.string().min(1).max(1024),
    type: z.literal("public-key"),
    response: z
      .object({
        clientDataJSON: z.string().min(1),
        attestationObject: z.string().min(1),
      })
      .loose(),
  })
  .loose();

/** Step 2 of adding a passkey: check the browser's answer and store the credential. */
export async function finishPasskeyRegistration(
  name: string,
  response: RegistrationResponseJSON,
): Promise<ActionState> {
  const user = await getCurrentUser();
  const parsedName = nameSchema.safeParse(typeof name === "string" ? name.trim() : undefined);
  const parsedResponse = registrationResponseSchema.safeParse(response);
  if (!parsedName.success || !parsedResponse.success) {
    return { error: "The passkey was not added. Please try again." };
  }

  const challenge = await consumeChallenge("registration", user.id);
  if (!challenge) {
    return { error: "This took too long. Please try again." };
  }

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: parsedResponse.data as unknown as RegistrationResponseJSON,
      expectedChallenge: challenge,
      expectedOrigin: expectedOrigin(),
      expectedRPID: rpID(),
      requireUserVerification: true,
    });
  } catch (error) {
    console.error("finishPasskeyRegistration verify", error instanceof Error ? error.message : error);
    return { error: "The passkey could not be verified. Please try again." };
  }

  if (!verification.verified) {
    return { error: "The passkey could not be verified. Please try again." };
  }

  const { credential, credentialDeviceType, credentialBackedUp, aaguid } =
    verification.registrationInfo;

  // RLS only allows inserting rows for yourself.
  const supabase = await createClient();
  const { error } = await supabase.from("passkeys").insert({
    user_id: user.id,
    credential_id: credential.id,
    public_key: encodePublicKey(credential.publicKey),
    counter: credential.counter,
    transports: credential.transports ?? [],
    device_type: credentialDeviceType,
    backed_up: credentialBackedUp,
    aaguid,
    name: parsedName.data,
  });

  if (error) {
    console.error("finishPasskeyRegistration insert", error);
    if (error.code === "23505") {
      return { error: "This passkey has already been added." };
    }
    return { error: GENERIC_ERROR };
  }

  revalidateSecurityPages();
  return { ok: true, message: `Passkey "${parsedName.data}" added.` };
}

const renameSchema = z.object({
  id: z.guid({ error: "Passkey not found" }),
  name: nameSchema,
});

export async function renamePasskey(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getCurrentUser();
  const parsed = renameSchema.safeParse(formValues(formData));
  if (!parsed.success) {
    return { error: "Check the name.", fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  const supabase = await createClient();
  // The column grant only allows changing the name, RLS only your own rows.
  const { data, error } = await supabase
    .from("passkeys")
    .update({ name: parsed.data.name })
    .eq("id", parsed.data.id)
    .eq("user_id", user.id)
    .select("id");

  if (error || !data?.length) {
    if (error) console.error("renamePasskey", error);
    return { error: GENERIC_ERROR };
  }

  revalidateSecurityPages();
  return { ok: true, message: "Saved." };
}

export async function removePasskey(id: string): Promise<ActionState> {
  const user = await getCurrentUser();
  const parsed = z.guid().safeParse(id);
  if (!parsed.success) return { error: "Passkey not found." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("passkeys")
    .delete()
    .eq("id", parsed.data)
    .eq("user_id", user.id)
    .select("id");

  if (error || !data?.length) {
    if (error) console.error("removePasskey", error);
    return { error: GENERIC_ERROR };
  }

  revalidateSecurityPages();
  return { ok: true, message: "The passkey has been revoked." };
}
