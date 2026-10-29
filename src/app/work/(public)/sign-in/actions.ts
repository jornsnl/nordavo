"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { env } from "@/lib/env";
import { safeNextPath } from "@/lib/safe-redirect";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { sendSignInMail } from "@/lib/work/notify";

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
 * answer is the same whether the address exists or not.
 */
export async function sendSignInLink(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const parsed = z.email().safeParse(String(formData.get("email") ?? "").trim().toLowerCase());
  if (!parsed.success) return { error: "Enter a valid e-mail address." };
  const email = parsed.data;
  const next = safeNextPath(formData.get("next"), "/work");
  const sent = `If ${email} has an account, a sign-in link is on its way. It works once, within an hour.`;

  const admin = createAdminClient();
  if (admin && process.env.RESEND_API_KEY && process.env.MAIL_FROM) {
    const { data: profile } = await admin.from("profiles").select("id").eq("email", email).maybeSingle();
    if (!profile) return { sent };
    const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
    if (error || !data.properties?.hashed_token) {
      console.error("[work] sign-in link failed:", error?.code, error?.message);
      return { error: "The link could not be sent. Try again in a minute." };
    }
    const url = `${site()}/auth/confirm?token_hash=${encodeURIComponent(data.properties.hashed_token)}&type=email&next=${encodeURIComponent(next)}`;
    await sendSignInMail(email, url);
    return { sent };
  }

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
