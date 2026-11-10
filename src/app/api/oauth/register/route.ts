import { connection } from "next/server";
import { generateClientId, oauthError, oauthJson, oauthPreflight, parseClientRegistration } from "@/lib/mcp/oauth";
import { createAdminClient } from "@/lib/supabase/admin";

const MAX_BODY_BYTES = 16 * 1024;

/**
 * Dynamic client registration (RFC 7591) for MCP clients such as Claude.
 * Open by design, as the MCP spec expects: registering gives no access, a
 * team member still has to approve the app on the consent page.
 */
export async function POST(request: Request) {
  await connection();
  const db = createAdminClient();
  if (!db) return oauthError(503, "temporarily_unavailable", "SUPABASE_SECRET_KEY is missing on the server.");

  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return oauthError(400, "invalid_client_metadata", "The request is too large.");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return oauthError(400, "invalid_client_metadata", "Send the client metadata as JSON.");
  }

  const parsed = parseClientRegistration(body);
  if (!parsed.ok) return oauthError(400, parsed.error, parsed.description);

  const clientId = generateClientId();
  const { data, error } = await db
    .from("oauth_clients")
    .insert({ client_id: clientId, ...parsed.value })
    .select("client_id, client_name, client_uri, redirect_uris, created_at")
    .single();
  if (error || !data) {
    console.error("[oauth] register failed:", error?.message);
    return oauthError(500, "server_error", "Could not register the client.");
  }

  return oauthJson(
    {
      client_id: data.client_id,
      client_id_issued_at: Math.floor(new Date(data.created_at).getTime() / 1000),
      client_name: data.client_name,
      ...(data.client_uri ? { client_uri: data.client_uri } : {}),
      redirect_uris: data.redirect_uris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: "read write",
    },
    201,
  );
}

export async function OPTIONS() {
  await connection();
  return oauthPreflight();
}
