"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { env } from "@/lib/env";
import { safeNextPath } from "@/lib/safe-redirect";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { sendSignInMail } from "@/lib/work/notify";
import { SIGN_IN_LINK_SENT, mayUseSignInLink, signInLinkUrl } from "@/lib/security/sign-in-link";

export type SignInState = { error?: string; sent?: string };

const site = () => env.siteUrl().replace(/\/$/, "");

/** Sign in with Google. Only existing accounts get in (invites create them). */
export async function signInWithGoogle(next: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${site()}/auth/callback?next=${encodeURIComponent(safeNextPath(next, "/work"))}`,
      queryParams: { prompt: "select_account" },
    },
  });
  if (error || !data.url) redirect("/work/sign-in?error=google");
  redirect(data.url);
}

/**
 * Mail a one-time sign-in link. With the secret key and mail set up, we make
 * the link ourselves (English mail, straight back to `next`); otherwise
 * Supabase sends its own magic link mail. Never creates an account, and the
 * answer is the same whether the address exists or not. Links are for Work
 * guests only (see src/lib/security/sign-in-link.ts); staff and clients use
 * their password or passkey.
 */
export async function sendSignInLink(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const parsed = z.email().safeParse(String(formData.get("email") ?? "").trim().toLowerCase());
  if (!parsed.success) return { error: "Enter a valid e-mail address." };
  const email = parsed.data;
  const next = safeNextPath(formData.get("next"), "/work");
  const sent = SIGN_IN_LINK_SENT(email);

  const admin = createAdminClient();
  if (admin && process.env.RESEND_API_KEY && process.env.MAIL_FROM) {
    const { data: profile } = await admin.from("profiles").select("id, role").eq("email", email).maybeSingle();
    if (!profile || !mayUseSignInLink(profile.role)) return { sent };
    const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
    if (error || !data.properties?.hashed_token) {
      console.error("[work] sign-in link failed:", error?.code, error?.message);
      return { error: "The link could not be sent. Try again in a minute." };
    }
    const url = signInLinkUrl(site(), data.properties.hashed_token, next);
    await sendSignInMail(email, url);
    return { sent };
  }

  // Without the secret key we cannot see the role first; /auth/confirm then
  // signs a staff or client link session out again.
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo: `${site()}/auth/confirm?next=${encodeURIComponent(next)}` },
  });
  if (error && error.code !== "otp_disabled" && error.status !== 422 && error.status !== 400) {
    console.error("[work] magic link failed:", error.code, error.message);
    if (error.status === 429) return { error: "Too many links asked for. Wait a minute and try again." };
  }
  return { sent };
}
