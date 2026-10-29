import { NextResponse, type NextRequest } from "next/server";
import { safeNextPath } from "@/lib/safe-redirect";
import { createClient } from "@/lib/supabase/server";

/**
 * Landing point for OAuth sign-in (Google). Swaps the code for a session and
 * continues to `next`. Add {SITE_URL}/auth/callback to the redirect URLs in
 * Supabase (Authentication > URL Configuration).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"), "/work");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, request.url));
    console.error("[auth] code exchange failed:", error.code, error.message);
  }

  const signIn = new URL("/work/sign-in", request.url);
  signIn.searchParams.set("error", "google");
  if (next !== "/work") signIn.searchParams.set("next", next);
  return NextResponse.redirect(signIn);
}
