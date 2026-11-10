import { connection } from "next/server";
import { env } from "@/lib/env";
import {
  exchangeAuthorizationCode,
  oauthError,
  oauthJson,
  oauthPreflight,
  readTokenForm,
  refreshAccessToken,
} from "@/lib/mcp/oauth";
import { createAdminClient } from "@/lib/supabase/admin";

/** OAuth token endpoint: authorization_code (with PKCE) and refresh_token. */
export async function POST(request: Request) {
  await connection();
  const db = createAdminClient();
  if (!db) return oauthError(503, "temporarily_unavailable", "SUPABASE_SECRET_KEY is missing on the server.");

  const form = await readTokenForm(request);
  const result =
    form.grant_type === "authorization_code"
      ? await exchangeAuthorizationCode(
          db,
          {
            code: form.code ?? "",
            client_id: form.client_id ?? "",
            redirect_uri: form.redirect_uri ?? "",
            code_verifier: form.code_verifier ?? "",
            resource: form.resource ?? "",
          },
          env.siteUrl(),
        )
      : form.grant_type === "refresh_token"
        ? await refreshAccessToken(db, { refresh_token: form.refresh_token ?? "", client_id: form.client_id ?? "" })
        : null;

  if (!result) {
    return oauthError(400, "unsupported_grant_type", "Use authorization_code or refresh_token.");
  }
  if (!result.ok) return oauthError(result.status, result.error, result.description);
  return oauthJson(result.body);
}

export async function OPTIONS() {
  await connection();
  return oauthPreflight();
}
