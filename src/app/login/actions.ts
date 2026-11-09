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
    return { error: "Enter your e-mail address and password.", email };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return {
      error:
        error.code === "email_not_confirmed"
          ? "Your e-mail address is not confirmed yet. Check your inbox for the invitation."
          : error.code === "user_banned"
            ? "Your access is paused or has ended. Contact Nordavo if you think this is a mistake."
            : "This e-mail address and password do not match.",
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
    redirect("/portal");
  }
  if (profile?.role === "caller") {
    redirect("/caller");
  }
  if (profile?.role !== "admin" && profile?.role !== "member") {
    redirect(safeNextPath(formData.get("next"), "/work"));
  }

  redirect(safeNextPath(formData.get("next")));
}
