import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { PASSKEY_SESSION_COOKIE } from "@/lib/security/passkey-session";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  // The passkey marker belongs to the session that just ended.
  (await cookies()).delete(PASSKEY_SESSION_COOKIE);

  return NextResponse.redirect(new URL("/login", request.url), {
    status: 303,
  });
}
