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

// Staff manage passkeys on /dashboard/instellingen, client users on /portaal/beveiliging.
function revalidateSecurityPages() {
  revalidatePath("/dashboard/instellingen");
  revalidatePath("/portaal/beveiliging");
}

const nameSchema = z
  .string({ error: "Geef je passkey een naam" })
  .min(1, { error: "Geef je passkey een naam" })
  .max(80, { error: "Maximaal 80 tekens" });

const NOT_CONFIGURED =
  "Passkeys werken pas als SUPABASE_SECRET_KEY op de server is ingesteld.";

/** Step 1 of adding a passkey: options for the browser prompt. */
export async function startPasskeyRegistration(
  name: string,
): Promise<{ options?: PublicKeyCredentialCreationOptionsJSON; error?: string; fieldErrors?: Record<string, string> }> {
  const user = await getCurrentUser();
  const parsed = nameSchema.safeParse(typeof name === "string" ? name.trim() : undefined);
  if (!parsed.success) {
    return { error: "Controleer de naam.", fieldErrors: { name: parsed.error.issues[0].message } };
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
    return { error: "De passkey is niet toegevoegd. Probeer het opnieuw." };
  }

  const challenge = await consumeChallenge("registration", user.id);
  if (!challenge) {
    return { error: "Dit duurde te lang. Probeer het opnieuw." };
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
    return { error: "De passkey kon niet worden gecontroleerd. Probeer het opnieuw." };
  }

  if (!verification.verified) {
    return { error: "De passkey kon niet worden gecontroleerd. Probeer het opnieuw." };
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
      return { error: "Deze passkey is al toegevoegd." };
    }
    return { error: GENERIC_ERROR };
  }

  revalidateSecurityPages();
  return { ok: true, message: `Passkey "${parsedName.data}" is toegevoegd.` };
}

const renameSchema = z.object({
  id: z.guid({ error: "Passkey niet gevonden" }),
  name: nameSchema,
});

export async function renamePasskey(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getCurrentUser();
  const parsed = renameSchema.safeParse(formValues(formData));
  if (!parsed.success) {
    return { error: "Controleer de naam.", fieldErrors: fieldErrorsFrom(parsed.error) };
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
  return { ok: true, message: "Opgeslagen." };
}

export async function removePasskey(id: string): Promise<ActionState> {
  const user = await getCurrentUser();
  const parsed = z.guid().safeParse(id);
  if (!parsed.success) return { error: "Passkey niet gevonden." };

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
  return { ok: true, message: "De passkey is ingetrokken." };
}
