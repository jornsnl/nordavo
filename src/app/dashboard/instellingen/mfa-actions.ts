"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";
import { type ActionState, GENERIC_ERROR, fieldErrorsFrom, formValues } from "@/lib/action-state";
import { getCurrentUser, requireAdmin } from "@/lib/auth";
import { PASSKEY_SESSION_COOKIE, isPasskeySession } from "@/lib/security/passkey-session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// These actions also run for client portal users (/portaal/beveiliging),
// so they authorize with getCurrentUser() and only touch the user's own factors.

export type MfaEnrollState = ActionState & {
  factorId?: string;
  /** SVG QR code as a data URI, ready for an <img>. */
  qrCode?: string;
  /** The same secret as text, for typing it into the app by hand. */
  secret?: string;
  friendlyName?: string;
};

function revalidateSecurityPages() {
  revalidatePath("/dashboard/instellingen");
  revalidatePath("/portaal/beveiliging");
}

const INSUFFICIENT_AAL =
  "Log eerst opnieuw in met je wachtwoord en een code uit je authenticator app, en probeer het daarna nog eens.";

const enrollSchema = z.object({
  friendly_name: z
    .string({ error: "Geef de app een naam" })
    .min(2, { error: "Geef de app een naam" })
    .max(60, { error: "Maximaal 60 tekens" }),
});

/** Step 1 of adding an authenticator app: creates an unverified factor and returns its QR code. */
export async function startMfaEnrollment(
  _prev: MfaEnrollState,
  formData: FormData,
): Promise<MfaEnrollState> {
  await getCurrentUser();
  const parsed = enrollSchema.safeParse(formValues(formData));
  if (!parsed.success) {
    return { error: "Controleer de naam.", fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  const supabase = await createClient();

  // A previous attempt that was never finished leaves an unverified factor behind.
  const { data: factors } = await supabase.auth.mfa.listFactors();
  for (const factor of factors?.all ?? []) {
    if (factor.factor_type === "totp" && factor.status === "unverified") {
      await supabase.auth.mfa.unenroll({ factorId: factor.id });
    }
  }

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: parsed.data.friendly_name,
    issuer: "Nordavo",
  });

  if (error || !data) {
    console.error("startMfaEnrollment", error?.code, error?.message);
    switch (error?.code) {
      case "mfa_factor_name_conflict":
        return {
          error: "Je hebt al een app met deze naam.",
          fieldErrors: { friendly_name: "Kies een andere naam" },
        };
      case "too_many_enrolled_mfa_factors":
        return { error: "Je hebt het maximale aantal apps bereikt. Verwijder er eerst een." };
      case "mfa_totp_enroll_not_enabled":
        return { error: "Tweestapsverificatie staat nog niet aan in Supabase. Vraag een beheerder." };
      case "insufficient_aal":
        return { error: INSUFFICIENT_AAL };
      default:
        return { error: GENERIC_ERROR };
    }
  }

  // supabase-js prefixes the raw SVG; encode it so characters like # survive in a data URI.
  const svg = data.totp.qr_code.replace(/^data:image\/svg\+xml;utf-8,/, "");
  return {
    ok: true,
    factorId: data.id,
    qrCode: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
    secret: data.totp.secret,
    friendlyName: data.friendly_name ?? parsed.data.friendly_name,
  };
}

const verifySchema = z.object({
  factor_id: z.guid({ error: "Begin opnieuw met het toevoegen van de app" }),
  code: z.string({ error: "Vul de code in" }).regex(/^\d{6}$/, { error: "Vul de 6 cijfers uit je app in" }),
});

/** Step 2: the first code from the app proves the QR code was scanned. Upgrades this session to aal2. */
export async function verifyMfaEnrollment(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await getCurrentUser();
  const parsed = verifySchema.safeParse({
    factor_id: formData.get("factor_id"),
    code: String(formData.get("code") ?? "").replace(/\s/g, ""),
  });
  if (!parsed.success) {
    return { error: "Controleer de code.", fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.mfa.challengeAndVerify({
    factorId: parsed.data.factor_id,
    code: parsed.data.code,
  });

  if (error) {
    console.error("verifyMfaEnrollment", error.code, error.message);
    if (error.code === "mfa_verification_failed" || error.code === "mfa_verification_rejected") {
      return {
        error: "Deze code klopt niet.",
        fieldErrors: { code: "Gebruik de code die nu in je app staat" },
      };
    }
    if (error.code === "mfa_factor_not_found") {
      return { error: "Deze koppeling is verlopen. Begin opnieuw met het toevoegen van de app." };
    }
    if (error.status === 429) {
      return { error: "Te veel pogingen. Wacht een paar minuten en probeer het opnieuw." };
    }
    return { error: GENERIC_ERROR };
  }

  revalidateSecurityPages();
  return { ok: true, message: "Tweestapsverificatie staat aan. Bij de volgende keer inloggen vragen we om een code." };
}

/** Removes an unfinished enrollment when the user cancels. */
export async function cancelMfaEnrollment(factorId: string): Promise<ActionState> {
  await getCurrentUser();
  if (!z.guid().safeParse(factorId).success) return { error: GENERIC_ERROR };

  const supabase = await createClient();
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const factor = factors?.all.find((f) => f.id === factorId);
  // Only unfinished ones: removing a working app goes through removeMfaFactor.
  if (!factor || factor.status !== "unverified") return { ok: true };

  await supabase.auth.mfa.unenroll({ factorId });
  return { ok: true };
}

/** Removes one of the user's own authenticator apps. */
export async function removeMfaFactor(factorId: string): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!z.guid().safeParse(factorId).success) return { error: GENERIC_ERROR };

  const supabase = await createClient();
  const { data: factors } = await supabase.auth.mfa.listFactors();
  if (!factors?.all.some((f) => f.id === factorId)) {
    return { error: "Deze app staat niet (meer) op je account." };
  }

  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error?.code === "insufficient_aal") {
    // Supabase Auth only knows aal1 for a passkey sign-in, which we count as two factors.
    const { data } = await supabase.auth.getClaims();
    const cookieStore = await cookies();
    const admin = createAdminClient();
    const passkey = await isPasskeySession(
      cookieStore.get(PASSKEY_SESSION_COOKIE)?.value,
      data?.claims?.session_id,
    );
    if (!passkey || !admin) return { error: INSUFFICIENT_AAL };

    const { error: adminError } = await admin.auth.admin.mfa.deleteFactor({ userId: user.id, id: factorId });
    if (adminError) {
      console.error("removeMfaFactor admin", adminError.code, adminError.message);
      return { error: GENERIC_ERROR };
    }
  } else if (error) {
    console.error("removeMfaFactor", error.code, error.message);
    return { error: GENERIC_ERROR };
  }

  revalidateSecurityPages();
  return { ok: true, message: "De app is verwijderd." };
}

/**
 * Admin only: removes every factor of another user, for a lost or replaced phone.
 * The user then signs in with just a password and can add a new app.
 */
export async function resetUserMfa(userId: string): Promise<ActionState> {
  const admin = await requireAdmin();
  if (!z.guid().safeParse(userId).success) return { error: "Gebruiker niet gevonden." };
  if (userId === admin.id) {
    return { error: "Je eigen tweestapsverificatie reset je niet zelf. Vraag een andere beheerder." };
  }

  const client = createAdminClient();
  if (!client) {
    return {
      error:
        "Resetten kan pas als SUPABASE_SECRET_KEY op de server is ingesteld. Verwijder de factor tot die tijd via het Supabase dashboard.",
    };
  }

  const { data, error } = await client.auth.admin.mfa.listFactors({ userId });
  if (error || !data) {
    console.error("resetUserMfa list", error?.code, error?.message);
    return { error: GENERIC_ERROR };
  }

  for (const factor of data.factors) {
    const { error: deleteError } = await client.auth.admin.mfa.deleteFactor({ userId, id: factor.id });
    if (deleteError) {
      console.error("resetUserMfa delete", deleteError.code, deleteError.message);
      return { error: GENERIC_ERROR };
    }
  }

  revalidatePath("/dashboard/instellingen");
  return { ok: true, message: "Tweestapsverificatie is gereset." };
}
