"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { GENERIC_ERROR } from "@/lib/action-state";
import { createClient } from "@/lib/supabase/server";
import { pathAfterSignIn } from "./redirect";

export type VerifyState = {
  error?: string;
};

const verifySchema = z.object({
  factor_id: z.guid(),
  code: z.string().regex(/^\d{6}$/),
});

/** Second login step: checks the code from the authenticator app and upgrades the session to aal2. */
export async function verifyCode(_prev: VerifyState, formData: FormData): Promise<VerifyState> {
  const parsed = verifySchema.safeParse({
    factor_id: formData.get("factor_id"),
    code: String(formData.get("code") ?? "").replace(/\s/g, ""),
  });
  if (!parsed.success) {
    return { error: "Vul de 6 cijfers uit je authenticator app in." };
  }

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) {
    redirect("/login");
  }

  // Supabase Auth checks that the factor belongs to this user.
  const { error } = await supabase.auth.mfa.challengeAndVerify({
    factorId: parsed.data.factor_id,
    code: parsed.data.code,
  });

  if (error) {
    console.error("verifyCode", error.code, error.message);
    if (error.status === 429) {
      return { error: "Te veel pogingen. Wacht een paar minuten en probeer het opnieuw." };
    }
    switch (error.code) {
      case "mfa_verification_failed":
      case "mfa_verification_rejected":
        return { error: "Deze code klopt niet. Gebruik de code die nu in je app staat." };
      case "mfa_challenge_expired":
        return { error: "De code is verlopen. Vul de nieuwe code uit je app in." };
      case "mfa_factor_not_found":
        return { error: "Deze authenticator app staat niet meer op je account. Log uit en log opnieuw in." };
      default:
        return { error: GENERIC_ERROR };
    }
  }

  redirect(await pathAfterSignIn(data.claims.sub, formData.get("next")));
}
