import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { hashesEqual, parseBearerToken, shouldTouchLastUsed } from "@/lib/mcp/tokens";

/**
 * Personal API tokens for /api/work: "wrk_" + 32 random bytes (base64url).
 * Any Work user can make one for themselves; the API then acts as that user
 * with exactly their rights. Only the SHA-256 hash is stored.
 */
export const WORK_TOKEN_PREFIX = "wrk_";
const TOKEN_RE = /^wrk_[A-Za-z0-9_-]{43}$/;

export function generateWorkToken() {
  const token = `${WORK_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  return { token, hash: sha256(token), prefix: token.slice(0, 12) };
}

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function isWorkTokenFormat(value: string) {
  return TOKEN_RE.test(value);
}

/** Random token for invite links (the database keeps only its hash). */
export function generateInviteToken() {
  const token = randomBytes(24).toString("base64url");
  return { token, hash: sha256(`invite:${token}`) };
}

export function inviteTokenHash(token: string) {
  return sha256(`invite:${token}`);
}

export type WorkApiActor = {
  tokenId: string;
  userId: string;
  access: "read" | "write";
  name: string;
  email: string | null;
};

export type WorkAuthResult =
  | { ok: true; actor: WorkApiActor }
  | { ok: false; reason: "missing" | "invalid" | "revoked" | "expired" };

export async function authenticateWorkToken(
  header: string | null | undefined,
  db: SupabaseClient<Database>,
  now: Date = new Date(),
): Promise<WorkAuthResult> {
  const token = parseBearerToken(header);
  if (!token) return { ok: false, reason: "missing" };
  if (!isWorkTokenFormat(token)) return { ok: false, reason: "invalid" };
  const hash = sha256(token);
  const { data: row } = await db
    .from("work_api_tokens")
    .select("id, user_id, token_hash, access, expires_at, revoked_at, last_used_at")
    .eq("token_hash", hash)
    .maybeSingle();
  if (!row || !hashesEqual(row.token_hash, hash)) return { ok: false, reason: "invalid" };
  if (row.revoked_at) return { ok: false, reason: "revoked" };
  if (row.expires_at && new Date(row.expires_at).getTime() <= now.getTime()) return { ok: false, reason: "expired" };

  const { data: profile } = await db.from("profiles").select("full_name, email").eq("id", row.user_id).maybeSingle();
  if (shouldTouchLastUsed(row.last_used_at, now)) {
    await db.from("work_api_tokens").update({ last_used_at: now.toISOString() }).eq("id", row.id);
  }
  return {
    ok: true,
    actor: {
      tokenId: row.id,
      userId: row.user_id,
      access: row.access === "write" ? "write" : "read",
      name: profile?.full_name || profile?.email?.split("@")[0] || "Work user",
      email: profile?.email ?? null,
    },
  };
}

export function workAuthMessage(reason: Exclude<WorkAuthResult, { ok: true }>["reason"]) {
  switch (reason) {
    case "missing":
      return "Send Authorization: Bearer <token>. Create a token in Work under Settings.";
    case "invalid":
      return "Invalid token.";
    case "revoked":
      return "This token was revoked.";
    case "expired":
      return "This token has expired.";
  }
}
