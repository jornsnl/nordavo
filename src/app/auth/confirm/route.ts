import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/safe-redirect";

/**
 * Landing point for links in Supabase auth e-mails (invites, magic links,
 * password recovery). Point the e-mail templates at:
 * {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next=/auth/wachtwoord
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = safeNextPath(searchParams.get("next"));

  if (tokenHash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (!error) {
      return NextResponse.redirect(new URL(next, request.url));
    }
  }

  // Links for the task tool fall back to its own sign-in page.
  const failed = next.startsWith("/work") ? `/work/sign-in?error=link&next=${encodeURIComponent(next)}` : "/login?error=link";
  return NextResponse.redirect(new URL(failed, request.url));
}
