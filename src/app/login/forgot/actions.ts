"use server";

import { z } from "zod";
import { FORGOT_PASSWORD_SENT } from "@/app/login/forgot/messages";
import { confirmUrl, setPasswordRedirect } from "@/lib/auth-links";
import { passwordResetMail } from "@/lib/notify/account-mail";
import { sendMail } from "@/lib/notify/mail";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type ForgotState = { error?: string; sent?: string; email?: string };

/** One reset mail per address per this many minutes, so the form cannot be used to flood an inbox. */
const THROTTLE_MINUTES = 2;

/**
 * "Forgot password?" on the login page (feedback Julius). With the secret key
 * and mail set up we make the recovery link ourselves, so it always opens the
 * public portal and the mail is in the portal's own style; otherwise Supabase
 * sends its own recovery mail. Works for every role. After the new password
 * the user is signed in (/auth/confirm, then /auth/password); an authenticator
 * app is still asked for where it is set up.
 */
export async function requestPasswordReset(_prev: ForgotState, formData: FormData): Promise<ForgotState> {
  const parsed = z.email().safeParse(String(formData.get("email") ?? "").trim().toLowerCase());
  if (!parsed.success) return { error: "Enter a valid e-mail address.", email: String(formData.get("email") ?? "") };
  const email = parsed.data;
  const sent = FORGOT_PASSWORD_SENT(email);

  const admin = createAdminClient();
  if (admin && process.env.RESEND_API_KEY && process.env.MAIL_FROM) {
    const { data: profile } = await admin.from("profiles").select("id, full_name, email").eq("email", email).maybeSingle();
    if (!profile?.email) return { sent, email };

    const since = new Date(Date.now() - THROTTLE_MINUTES * 60_000).toISOString();
    const { count } = await admin
      .from("mail_log")
      .select("id", { count: "exact", head: true })
      .eq("category", "password_reset")
      .contains("to_addresses", [profile.email])
      .gte("created_at", since);
    if ((count ?? 0) > 0) return { sent, email };

    const link = await admin.auth.admin.generateLink({ type: "recovery", email: profile.email });
    if (link.error || !link.data.properties?.hashed_token) {
      console.error("[auth] password reset link failed:", link.error?.code, link.error?.message);
      return { error: "The link could not be sent. Try again in a minute.", email };
    }
    const mail = passwordResetMail({ name: profile.full_name ?? profile.email, url: confirmUrl(link.data.properties.hashed_token, "recovery") });
    await sendMail({ category: "password_reset", to: profile.email, subject: mail.subject, html: mail.html, text: mail.text });
    return { sent, email };
  }

  // No secret key or mail: Supabase's own recovery mail, back to the set-password page.
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: setPasswordRedirect() });
  if (error) {
    console.error("[auth] resetPasswordForEmail failed:", error.code, error.message);
    if (error.status === 429) return { error: "Too many links asked for. Wait a minute and try again.", email };
  }
  return { sent, email };
}
