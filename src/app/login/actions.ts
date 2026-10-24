"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/safe-redirect";
import { MFA_VERIFY_PATH, hasVerifiedTotp } from "@/lib/security/mfa";

export type LoginState = {
  error?: string;
  email?: string;
};

export async function login(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Vul je e-mailadres en wachtwoord in.", email };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return {
      error:
        error.code === "email_not_confirmed"
          ? "Je e-mailadres is nog niet bevestigd. Check je inbox voor de uitnodiging."
          : "Deze combinatie van e-mailadres en wachtwoord klopt niet.",
      email,
    };
  }

  // With an authenticator app, the session stays at aal1 until the code is entered.
  // The factors come straight from Supabase Auth's sign-in response.
  if (hasVerifiedTotp(data.user.factors)) {
    const next = safeNextPath(formData.get("next"), "");
    redirect(next ? `${MFA_VERIFY_PATH}?next=${encodeURIComponent(next)}` : MFA_VERIFY_PATH);
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", data.user.id)
    .maybeSingle();

  if (profile?.role === "client") {
    redirect("/portaal");
  }

  redirect(safeNextPath(formData.get("next")));
}
