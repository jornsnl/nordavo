import { connection } from "next/server";
import { oauthError, oauthPreflight, readTokenForm, revokeOAuthToken, OAUTH_CORS_HEADERS } from "@/lib/mcp/oauth";
import { createAdminClient } from "@/lib/supabase/admin";

/** RFC 7009: revoking an access or refresh token ends the whole connection. */
export async function POST(request: Request) {
  await connection();
  const db = createAdminClient();
  if (!db) return oauthError(503, "temporarily_unavailable", "SUPABASE_SECRET_KEY is missing on the server.");

  const form = await readTokenForm(request);
  if (form.token) await revokeOAuthToken(db, form.token);
  // Unknown tokens answer 200 too (RFC 7009 2.2).
  return new Response(null, { status: 200, headers: { "Cache-Control": "no-store", ...OAUTH_CORS_HEADERS } });
}

export async function OPTIONS() {
  await connection();
  return oauthPreflight();
}
