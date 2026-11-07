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
    return { error: "Enter the 6 digits from your authenticator app." };
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
      return { error: "Too many attempts. Wait a few minutes and try again." };
    }
    switch (error.code) {
      case "mfa_verification_failed":
      case "mfa_verification_rejected":
        return { error: "This code is not correct. Use the code your app shows now." };
      case "mfa_challenge_expired":
        return { error: "The code has expired. Enter the new code from your app." };
      case "mfa_factor_not_found":
        return { error: "This authenticator app is no longer on your account. Sign out and sign in again." };
      default:
        return { error: GENERIC_ERROR };
    }
  }

  redirect(await pathAfterSignIn(data.claims.sub, formData.get("next")));
}
