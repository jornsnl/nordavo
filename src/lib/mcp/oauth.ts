import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, McpTokenAccess } from "@/lib/database.types";

/**
 * OAuth 2.1 authorization server for the MCP server at /api/mcp, as the MCP
 * authorization spec asks for (2025-06-18):
 *
 *   /.well-known/oauth-protected-resource[/api/mcp]   RFC 9728
 *   /.well-known/oauth-authorization-server           RFC 8414
 *   POST /api/oauth/register                          RFC 7591, public clients only
 *   /oauth/authorize                                  consent page, PKCE S256 required
 *   POST /api/oauth/token                             authorization_code and refresh_token
 *   POST /api/oauth/revoke                            RFC 7009
 *
 * Tokens: "nrda_" access tokens (1 hour) and "nrdr_" refresh tokens (90 days,
 * rotated on every use), both 32 random bytes as base64url. Only SHA-256
 * hashes are stored, in oauth_grants: one row per approved connection.
 */

export const OAUTH_ACCESS_PREFIX = "nrda_";
export const OAUTH_REFRESH_PREFIX = "nrdr_";
const OAUTH_CODE_PREFIX = "nrdc_";
const TOKEN_BYTES = 32;

export const ACCESS_TOKEN_TTL_S = 60 * 60;
export const REFRESH_TOKEN_TTL_S = 90 * 24 * 60 * 60;
export const CODE_TTL_S = 10 * 60;

export const OAUTH_SCOPES = ["read", "write"] as const;

type AdminDb = SupabaseClient<Database>;

// ---------------------------------------------------------------------------
// URLs and metadata
// ---------------------------------------------------------------------------

export function oauthUrls(siteUrl: string) {
  const issuer = siteUrl.replace(/\/+$/, "");
  return {
    issuer,
    resource: `${issuer}/api/mcp`,
    resourceMetadata: `${issuer}/.well-known/oauth-protected-resource/api/mcp`,
    authorize: `${issuer}/oauth/authorize`,
    token: `${issuer}/api/oauth/token`,
    register: `${issuer}/api/oauth/register`,
    revoke: `${issuer}/api/oauth/revoke`,
  };
}

export function protectedResourceMetadata(siteUrl: string) {
  const urls = oauthUrls(siteUrl);
  return {
    resource: urls.resource,
    authorization_servers: [urls.issuer],
    scopes_supported: [...OAUTH_SCOPES],
    bearer_methods_supported: ["header"],
    resource_name: "Nordavo",
  };
}

export function authorizationServerMetadata(siteUrl: string) {
  const urls = oauthUrls(siteUrl);
  return {
    issuer: urls.issuer,
    authorization_endpoint: urls.authorize,
    token_endpoint: urls.token,
    registration_endpoint: urls.register,
    revocation_endpoint: urls.revoke,
    scopes_supported: [...OAUTH_SCOPES],
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    authorization_response_iss_parameter_supported: true,
  };
}

/** CORS for the endpoints browser based MCP clients call directly. */
export const OAUTH_CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, MCP-Protocol-Version",
  "Access-Control-Max-Age": "86400",
};

export function oauthJson(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", Pragma: "no-cache", ...OAUTH_CORS_HEADERS, ...headers },
  });
}

export function oauthError(status: number, error: string, description: string) {
  return oauthJson({ error, error_description: description }, status);
}

export function oauthPreflight() {
  return new Response(null, { status: 204, headers: OAUTH_CORS_HEADERS });
}

// ---------------------------------------------------------------------------
// Random values and hashes
// ---------------------------------------------------------------------------

function randomToken(prefix: string): string {
  return `${prefix}${randomBytes(TOKEN_BYTES).toString("base64url")}`;
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function isOAuthAccessToken(value: string): boolean {
  return new RegExp(`^${OAUTH_ACCESS_PREFIX}[A-Za-z0-9_-]{43}$`).test(value);
}

function isOAuthRefreshToken(value: string): boolean {
  return new RegExp(`^${OAUTH_REFRESH_PREFIX}[A-Za-z0-9_-]{43}$`).test(value);
}

function isOAuthCode(value: string): boolean {
  return new RegExp(`^${OAUTH_CODE_PREFIX}[A-Za-z0-9_-]{43}$`).test(value);
}

export function generateClientId(): string {
  return `nrdo_${randomBytes(18).toString("base64url")}`;
}

// ---------------------------------------------------------------------------
// PKCE, scopes and redirect URIs
// ---------------------------------------------------------------------------

const VERIFIER_RE = /^[A-Za-z0-9\-._~]{43,128}$/;
const CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/;

export function isCodeChallenge(value: string): boolean {
  return CHALLENGE_RE.test(value);
}

/** RFC 7636 S256: BASE64URL(SHA256(verifier)) equals the challenge. */
export function verifyPkce(verifier: string, challenge: string): boolean {
  if (!VERIFIER_RE.test(verifier) || !CHALLENGE_RE.test(challenge)) return false;
  return createHash("sha256").update(verifier, "ascii").digest("base64url") === challenge;
}

/** The access a client asks for: write when its scope names write. */
export function accessFromScope(scope: string | null | undefined): McpTokenAccess {
  return (scope ?? "").split(/\s+/).includes("write") ? "write" : "read";
}

export function scopeForAccess(access: McpTokenAccess): string {
  return access === "write" ? "read write" : "read";
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Allowed redirect URIs: https anywhere, http only on loopback (Claude Code
 * and other native apps, RFC 8252 7.3) and private-use schemes with a dot
 * (com.example.app:/callback, RFC 8252 7.1). Never fragments or credentials.
 */
export function isAllowedRedirectUri(value: string): boolean {
  if (value.length > 2000) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.hash || url.username || url.password) return false;
  if (url.protocol === "https:") return Boolean(url.hostname);
  if (url.protocol === "http:") return LOOPBACK_HOSTS.has(url.hostname);
  const scheme = url.protocol.slice(0, -1);
  return /^[a-z][a-z0-9+.-]*\.[a-z0-9+.-]+$/.test(scheme);
}

/**
 * Exact match against a registered redirect URI, except that the port of a
 * loopback URI may differ: native apps pick a free port per sign in.
 */
export function redirectUriMatches(registered: readonly string[], requested: string): boolean {
  if (registered.includes(requested)) return true;
  let req: URL;
  try {
    req = new URL(requested);
  } catch {
    return false;
  }
  if (req.protocol !== "http:" || !LOOPBACK_HOSTS.has(req.hostname)) return false;
  return registered.some((uri) => {
    try {
      const reg = new URL(uri);
      return (
        reg.protocol === "http:" &&
        reg.hostname === req.hostname &&
        reg.pathname === req.pathname &&
        reg.search === req.search
      );
    } catch {
      return false;
    }
  });
}

/** Where the authorization response goes: redirect_uri plus code or error, state and iss. */
export function authorizationResponseUrl(
  redirectUri: string,
  params: Record<string, string | null | undefined>,
): string {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
  }
  return url.toString();
}

// ---------------------------------------------------------------------------
// Dynamic client registration
// ---------------------------------------------------------------------------

export type ClientRegistration = {
  client_name: string;
  client_uri: string | null;
  redirect_uris: string[];
};

export type RegistrationResult =
  | { ok: true; value: ClientRegistration }
  | { ok: false; error: "invalid_redirect_uri" | "invalid_client_metadata"; description: string };

export function parseClientRegistration(body: unknown): RegistrationResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "invalid_client_metadata", description: "Send the client metadata as a JSON object." };
  }
  const meta = body as Record<string, unknown>;

  const uris = meta.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > 10) {
    return { ok: false, error: "invalid_redirect_uri", description: "redirect_uris needs 1 to 10 URIs." };
  }
  if (!uris.every((uri) => typeof uri === "string" && isAllowedRedirectUri(uri))) {
    return {
      ok: false,
      error: "invalid_redirect_uri",
      description: "Every redirect URI must be https, http on localhost or a private-use scheme, without a fragment.",
    };
  }

  const grantTypes = meta.grant_types;
  if (
    grantTypes !== undefined &&
    (!Array.isArray(grantTypes) || !grantTypes.includes("authorization_code"))
  ) {
    return { ok: false, error: "invalid_client_metadata", description: "grant_types must include authorization_code." };
  }
  const responseTypes = meta.response_types;
  if (responseTypes !== undefined && (!Array.isArray(responseTypes) || !responseTypes.includes("code"))) {
    return { ok: false, error: "invalid_client_metadata", description: "response_types must include code." };
  }

  const rawName = typeof meta.client_name === "string" ? meta.client_name.trim() : "";
  const clientName = (rawName || "MCP client").slice(0, 120);

  let clientUri: string | null = null;
  if (typeof meta.client_uri === "string") {
    try {
      const url = new URL(meta.client_uri);
      if (url.protocol === "https:") clientUri = url.toString().slice(0, 500);
    } catch {
      // Ignored: the client URI is only shown on the consent page.
    }
  }

  return { ok: true, value: { client_name: clientName, client_uri: clientUri, redirect_uris: [...new Set(uris as string[])] } };
}

// ---------------------------------------------------------------------------
// Authorization request (consent page)
// ---------------------------------------------------------------------------

export type OAuthClient = {
  client_id: string;
  client_name: string;
  client_uri: string | null;
  redirect_uris: string[];
};

/** The fields of an authorization request, as the consent form carries them along. */
export const AUTHORIZE_FIELDS = [
  "response_type",
  "client_id",
  "redirect_uri",
  "state",
  "code_challenge",
  "code_challenge_method",
  "scope",
  "resource",
] as const;

export type AuthorizeParams = {
  client_id: string;
  redirect_uri: string;
  state: string | null;
  code_challenge: string;
  scope: string | null;
  resource: string | null;
};

/**
 * Checks an authorization request. "fatal" errors are shown on the page:
 * without a trusted redirect URI the user must never be sent anywhere.
 * "redirect" errors go back to the client, as RFC 6749 4.1.2.1 asks.
 */
export type AuthorizeCheck =
  | { kind: "ok"; client: OAuthClient; params: AuthorizeParams; access: McpTokenAccess }
  | { kind: "fatal"; message: string }
  | { kind: "redirect"; redirectUri: string; error: string; description: string; state: string | null };

export async function checkAuthorizeRequest(
  input: Record<string, string | undefined>,
  db: AdminDb,
  siteUrl: string,
): Promise<AuthorizeCheck> {
  const clientId = input.client_id ?? "";
  if (!clientId || clientId.length > 100) return { kind: "fatal", message: "The link is missing a client_id." };

  const client = await loadClient(db, clientId);
  if (!client) {
    return { kind: "fatal", message: "This app is not registered with Nordavo. Remove the connector and add it again." };
  }

  const redirectUri = input.redirect_uri ?? (client.redirect_uris.length === 1 ? client.redirect_uris[0] : "");
  if (!redirectUri || !redirectUriMatches(client.redirect_uris, redirectUri)) {
    return { kind: "fatal", message: "The redirect address does not match what this app registered." };
  }

  const state = input.state ? input.state.slice(0, 1000) : null;
  const fail = (error: string, description: string): AuthorizeCheck => ({
    kind: "redirect",
    redirectUri,
    error,
    description,
    state,
  });

  if (input.response_type !== "code") return fail("unsupported_response_type", "Only response_type=code is supported.");
  const challenge = input.code_challenge ?? "";
  if (!challenge) return fail("invalid_request", "PKCE is required: send code_challenge.");
  if ((input.code_challenge_method ?? "plain") !== "S256") {
    return fail("invalid_request", "Only code_challenge_method=S256 is supported.");
  }
  if (!isCodeChallenge(challenge)) return fail("invalid_request", "code_challenge is not a valid S256 challenge.");

  const resource = input.resource ? input.resource : null;
  if (resource && !resourceMatches(resource, siteUrl)) {
    return fail("invalid_target", "This server only issues tokens for its own MCP endpoint.");
  }

  const scope = input.scope ? input.scope.slice(0, 200) : null;
  if (scope && !scope.split(/\s+/).every((s) => (OAUTH_SCOPES as readonly string[]).includes(s))) {
    return fail("invalid_scope", "Supported scopes: read and write.");
  }

  return {
    kind: "ok",
    client,
    params: { client_id: clientId, redirect_uri: redirectUri, state, code_challenge: challenge, scope, resource },
    access: accessFromScope(scope),
  };
}

/** The resource indicator (RFC 8707) must be this MCP endpoint, with or without a trailing slash. */
export function resourceMatches(resource: string, siteUrl: string): boolean {
  const expected = oauthUrls(siteUrl).resource;
  const issuer = oauthUrls(siteUrl).issuer;
  const normalised = resource.replace(/\/+$/, "");
  return normalised === expected || normalised === issuer;
}

async function loadClient(db: AdminDb, clientId: string): Promise<OAuthClient | null> {
  const { data, error } = await db
    .from("oauth_clients")
    .select("client_id, client_name, client_uri, redirect_uris")
    .eq("client_id", clientId)
    .maybeSingle();
  if (error) console.error("[oauth] client lookup failed:", error.message);
  return data ?? null;
}

/** Stores a one-time code for an approved request and returns it. */
export async function createAuthorizationCode(
  db: AdminDb,
  input: { params: AuthorizeParams; userId: string; access: McpTokenAccess },
  now: Date = new Date(),
): Promise<string | null> {
  const code = randomToken(OAUTH_CODE_PREFIX);
  const { error } = await db.from("oauth_codes").insert({
    code_hash: sha256Hex(code),
    client_id: input.params.client_id,
    user_id: input.userId,
    redirect_uri: input.params.redirect_uri,
    code_challenge: input.params.code_challenge,
    access: input.access,
    resource: input.params.resource,
    expires_at: new Date(now.getTime() + CODE_TTL_S * 1000).toISOString(),
  });
  if (error) {
    console.error("[oauth] code insert failed:", error.message);
    return null;
  }
  // Old codes are of no use to anyone: clear them while we are here.
  await db.from("oauth_codes").delete().lt("expires_at", new Date(now.getTime() - 86_400_000).toISOString());
  return code;
}

// ---------------------------------------------------------------------------
// Token endpoint
// ---------------------------------------------------------------------------

export type TokenResponse = {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
};

export type TokenResult =
  | { ok: true; body: TokenResponse }
  | { ok: false; status: number; error: string; description: string };

const invalidGrant = (description: string): TokenResult => ({
  ok: false,
  status: 400,
  error: "invalid_grant",
  description,
});

function newTokenPair(now: Date) {
  const accessToken = randomToken(OAUTH_ACCESS_PREFIX);
  const refreshToken = randomToken(OAUTH_REFRESH_PREFIX);
  return {
    accessToken,
    refreshToken,
    row: {
      access_token_hash: sha256Hex(accessToken),
      access_expires_at: new Date(now.getTime() + ACCESS_TOKEN_TTL_S * 1000).toISOString(),
      refresh_token_hash: sha256Hex(refreshToken),
      refresh_expires_at: new Date(now.getTime() + REFRESH_TOKEN_TTL_S * 1000).toISOString(),
    },
  };
}

function tokenBody(pair: { accessToken: string; refreshToken: string }, access: McpTokenAccess): TokenResponse {
  return {
    access_token: pair.accessToken,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL_S,
    refresh_token: pair.refreshToken,
    scope: scopeForAccess(access),
  };
}

async function isStaffUser(db: AdminDb, userId: string): Promise<boolean> {
  const { data } = await db.from("profiles").select("role").eq("id", userId).maybeSingle();
  return data?.role === "admin" || data?.role === "member";
}

/** grant_type=authorization_code. The code is spent before any other check, so it works once. */
export async function exchangeAuthorizationCode(
  db: AdminDb,
  form: { code: string; client_id: string; redirect_uri: string; code_verifier: string; resource: string },
  siteUrl: string,
  now: Date = new Date(),
): Promise<TokenResult> {
  if (!form.code || !form.client_id || !form.code_verifier) {
    return { ok: false, status: 400, error: "invalid_request", description: "Send code, client_id and code_verifier." };
  }
  if (!isOAuthCode(form.code)) return invalidGrant("Unknown or expired code.");

  const { data: rows, error } = await db
    .from("oauth_codes")
    .update({ used_at: now.toISOString() })
    .eq("code_hash", sha256Hex(form.code))
    .is("used_at", null)
    .select("client_id, user_id, redirect_uri, code_challenge, access, resource, expires_at");
  if (error) {
    console.error("[oauth] code lookup failed:", error.message);
    return { ok: false, status: 500, error: "server_error", description: "Could not check the code." };
  }
  const code = rows?.[0];
  if (!code) return invalidGrant("Unknown, used or expired code.");
  if (new Date(code.expires_at).getTime() <= now.getTime()) return invalidGrant("The code has expired.");
  if (code.client_id !== form.client_id) return invalidGrant("The code belongs to another client.");
  if (form.redirect_uri && form.redirect_uri !== code.redirect_uri) {
    return invalidGrant("redirect_uri does not match the authorization request.");
  }
  if (!verifyPkce(form.code_verifier, code.code_challenge)) return invalidGrant("code_verifier does not match.");
  if (form.resource && !resourceMatches(form.resource, siteUrl)) {
    return { ok: false, status: 400, error: "invalid_target", description: "Unknown resource." };
  }
  if (!(await isStaffUser(db, code.user_id))) return invalidGrant("This account has no access to the MCP server.");

  const access: McpTokenAccess = code.access === "write" ? "write" : "read";
  const pair = newTokenPair(now);
  const { error: insertError } = await db.from("oauth_grants").insert({
    user_id: code.user_id,
    client_id: code.client_id,
    access,
    ...pair.row,
  });
  if (insertError) {
    console.error("[oauth] grant insert failed:", insertError.message);
    return { ok: false, status: 500, error: "server_error", description: "Could not issue a token." };
  }
  return { ok: true, body: tokenBody(pair, access) };
}

/** grant_type=refresh_token. Rotates both tokens; the old refresh token stops working. */
export async function refreshAccessToken(
  db: AdminDb,
  form: { refresh_token: string; client_id: string },
  now: Date = new Date(),
): Promise<TokenResult> {
  if (!form.refresh_token) {
    return { ok: false, status: 400, error: "invalid_request", description: "Send refresh_token." };
  }
  if (!isOAuthRefreshToken(form.refresh_token)) return invalidGrant("Unknown refresh token.");

  const { data: grant, error } = await db
    .from("oauth_grants")
    .select("id, user_id, client_id, access, refresh_expires_at, revoked_at")
    .eq("refresh_token_hash", sha256Hex(form.refresh_token))
    .maybeSingle();
  if (error) {
    console.error("[oauth] refresh lookup failed:", error.message);
    return { ok: false, status: 500, error: "server_error", description: "Could not check the refresh token." };
  }
  if (!grant || grant.revoked_at) return invalidGrant("Unknown or revoked refresh token.");
  if (form.client_id && form.client_id !== grant.client_id) return invalidGrant("The token belongs to another client.");
  if (new Date(grant.refresh_expires_at).getTime() <= now.getTime()) {
    return invalidGrant("The refresh token has expired. Connect again.");
  }
  if (!(await isStaffUser(db, grant.user_id))) return invalidGrant("This account has no access to the MCP server.");

  const pair = newTokenPair(now);
  // Only the request that still holds the current refresh token wins.
  const { data: updated, error: updateError } = await db
    .from("oauth_grants")
    .update(pair.row)
    .eq("id", grant.id)
    .eq("refresh_token_hash", sha256Hex(form.refresh_token))
    .is("revoked_at", null)
    .select("id");
  if (updateError) {
    console.error("[oauth] refresh rotate failed:", updateError.message);
    return { ok: false, status: 500, error: "server_error", description: "Could not issue a token." };
  }
  if (!updated?.length) return invalidGrant("The refresh token was already used.");

  const access: McpTokenAccess = grant.access === "write" ? "write" : "read";
  return { ok: true, body: tokenBody(pair, access) };
}

/** RFC 7009: revoke the connection that holds this access or refresh token. Always succeeds. */
export async function revokeOAuthToken(db: AdminDb, token: string, now: Date = new Date()): Promise<void> {
  const column = isOAuthAccessToken(token)
    ? "access_token_hash"
    : isOAuthRefreshToken(token)
      ? "refresh_token_hash"
      : null;
  if (!column) return;
  const { error } = await db
    .from("oauth_grants")
    .update({ revoked_at: now.toISOString() })
    .eq(column, sha256Hex(token))
    .is("revoked_at", null);
  if (error) console.error("[oauth] revoke failed:", error.message);
}

/** Reads an x-www-form-urlencoded body (JSON is accepted too) into plain strings. */
export async function readTokenForm(request: Request): Promise<Record<string, string>> {
  const type = request.headers.get("content-type") ?? "";
  const out: Record<string, string> = {};
  try {
    if (type.includes("application/json")) {
      const body = (await request.json()) as Record<string, unknown>;
      for (const [key, value] of Object.entries(body ?? {})) {
        if (typeof value === "string") out[key] = value;
      }
    } else {
      const params = new URLSearchParams(await request.text());
      for (const [key, value] of params) out[key] = value;
    }
  } catch {
    return out;
  }
  // A client may still send its id with HTTP Basic, even without a secret.
  const basic = /^Basic\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "");
  if (basic && !out.client_id) {
    const decoded = Buffer.from(basic[1], "base64").toString("utf8");
    const id = decodeURIComponent(decoded.split(":")[0] ?? "");
    if (id) out.client_id = id;
  }
  return out;
}
