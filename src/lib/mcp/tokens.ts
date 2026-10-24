import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, McpTokenAccess } from "@/lib/database.types";

/**
 * Personal access tokens for the MCP server at /api/mcp.
 *
 * Format: "nrd_" + 32 random bytes as base64url (47 characters). Only the
 * SHA-256 hash is stored; the first characters are kept so people can
 * recognise a token in the list.
 */
export const MCP_TOKEN_PREFIX = "nrd_";
const TOKEN_BYTES = 32;
const DISPLAY_PREFIX_LENGTH = 12;
const TOKEN_RE = /^nrd_[A-Za-z0-9_-]{43}$/;

/** last_used_at is written at most this often per token. */
const LAST_USED_INTERVAL_MS = 5 * 60 * 1000;

export type McpTokenContext = {
  tokenId: string;
  tokenName: string;
  userId: string;
  access: McpTokenAccess;
  /** Display name of the token owner. */
  name: string;
  email: string | null;
  role: "admin" | "member";
};

export type McpAuthResult =
  | { ok: true; context: McpTokenContext }
  | { ok: false; reason: "missing" | "malformed" | "invalid" | "revoked" | "expired" | "forbidden" };

type AdminDb = SupabaseClient<Database>;

export function generateMcpToken(): { token: string; hash: string; prefix: string } {
  const token = `${MCP_TOKEN_PREFIX}${randomBytes(TOKEN_BYTES).toString("base64url")}`;
  return { token, hash: hashMcpToken(token), prefix: mcpTokenDisplayPrefix(token) };
}

/** Lowercase hex SHA-256, as stored in mcp_tokens.token_hash. */
export function hashMcpToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function mcpTokenDisplayPrefix(token: string): string {
  return token.slice(0, DISPLAY_PREFIX_LENGTH);
}

export function isMcpTokenFormat(value: string): boolean {
  return TOKEN_RE.test(value);
}

/** "Bearer <token>" (scheme case-insensitive) to the token, or null. */
export function parseBearerToken(header: string | null | undefined): string | null {
  if (!header) return null;
  const match = /^\s*Bearer\s+(\S+)\s*$/i.exec(header);
  return match ? match[1] : null;
}

/** Constant-time comparison of two hex digests of equal length. */
export function hashesEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(left, right);
}

export function shouldTouchLastUsed(lastUsedAt: string | null, now: Date): boolean {
  if (!lastUsedAt) return true;
  return now.getTime() - new Date(lastUsedAt).getTime() >= LAST_USED_INTERVAL_MS;
}

/**
 * Check the Authorization header of an MCP request against mcp_tokens with
 * the admin (secret key) client. Rejects revoked and expired tokens and
 * users who are no longer on the Nordavo team.
 */
export async function authenticateMcpToken(
  authorizationHeader: string | null | undefined,
  db: AdminDb,
  now: Date = new Date(),
): Promise<McpAuthResult> {
  const token = parseBearerToken(authorizationHeader);
  if (!token) return { ok: false, reason: "missing" };
  if (!isMcpTokenFormat(token)) return { ok: false, reason: "malformed" };

  const hash = hashMcpToken(token);
  const { data: row, error } = await db
    .from("mcp_tokens")
    .select("id, user_id, name, token_hash, access, expires_at, last_used_at, revoked_at")
    .eq("token_hash", hash)
    .maybeSingle();

  if (error) {
    console.error("[mcp] token lookup failed:", error.message);
    return { ok: false, reason: "invalid" };
  }
  // The lookup is by hash; compare again in constant time so the decision
  // never depends on a non constant-time string comparison.
  if (!row || !hashesEqual(row.token_hash, hash)) return { ok: false, reason: "invalid" };
  if (row.revoked_at) return { ok: false, reason: "revoked" };
  if (row.expires_at && new Date(row.expires_at).getTime() <= now.getTime()) {
    return { ok: false, reason: "expired" };
  }

  const { data: profile } = await db
    .from("profiles")
    .select("full_name, email, role")
    .eq("id", row.user_id)
    .maybeSingle();
  if (!profile || (profile.role !== "admin" && profile.role !== "member")) {
    return { ok: false, reason: "forbidden" };
  }

  if (shouldTouchLastUsed(row.last_used_at, now)) {
    const { error: touchError } = await db
      .from("mcp_tokens")
      .update({ last_used_at: now.toISOString() })
      .eq("id", row.id);
    if (touchError) console.error("[mcp] last_used_at update failed:", touchError.message);
  }

  return {
    ok: true,
    context: {
      tokenId: row.id,
      tokenName: row.name,
      userId: row.user_id,
      access: row.access === "write" ? "write" : "read",
      name: profile.full_name || profile.email?.split("@")[0] || "Nordavo",
      email: profile.email,
      role: profile.role,
    },
  };
}

/** Dutch message for a rejected token, safe to show to the client. */
export function mcpAuthErrorMessage(reason: Exclude<McpAuthResult, { ok: true }>["reason"]): string {
  switch (reason) {
    case "missing":
      return "Geen token meegestuurd. Stuur de header Authorization: Bearer <token> mee. Maak een token aan in Nordavo onder Instellingen.";
    case "malformed":
    case "invalid":
      return "Ongeldig token. Controleer of je het volledige token hebt geplakt.";
    case "revoked":
      return "Dit token is ingetrokken. Maak een nieuw token aan onder Instellingen.";
    case "expired":
      return "Dit token is verlopen. Maak een nieuw token aan onder Instellingen.";
    case "forbidden":
      return "Dit account heeft geen toegang tot de MCP server.";
  }
}
