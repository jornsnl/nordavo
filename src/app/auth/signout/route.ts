import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { PASSKEY_SESSION_COOKIE } from "@/lib/security/passkey-session";
import { safeNextPath } from "@/lib/safe-redirect";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  // The passkey marker belongs to the session that just ended.
  (await cookies()).delete(PASSKEY_SESSION_COOKIE);

  // The task tool signs out to its own (English) sign-in page.
  const next = safeNextPath(request.nextUrl.searchParams.get("next"), "/login");
  return NextResponse.redirect(new URL(next === "/work/sign-in" ? next : "/login", request.url), {
    status: 303,
  });
}
