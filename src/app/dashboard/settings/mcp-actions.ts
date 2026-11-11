"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { type ActionState, GENERIC_ERROR, fieldErrorsFrom, formValues } from "@/lib/action-state";
import { requireAdmin, requireStaff } from "@/lib/auth";
import { mcpModules, mcpWriteLevels, type McpWriteLevel } from "@/lib/mcp/module-access";
import { generateMcpToken } from "@/lib/mcp/tokens";
import { createClient } from "@/lib/supabase/server";

/** Action state of the create form; token is only set right after creating it. */
export type McpTokenActionState = ActionState & { token?: string };

const MAX_ACTIVE_TOKENS = 20;

const createSchema = z.object({
  name: z
    .string({ error: "Name the token" })
    .trim()
    .min(1, { error: "Name the token" })
    .max(80, { error: "At most 80 characters" }),
  access: z.enum(["read", "write"], { error: "Choose read or read and write" }),
  expires: z.enum(["30", "90", "365", "never"], { error: "Choose an expiry" }),
});

export async function createMcpToken(
  _prev: McpTokenActionState,
  formData: FormData,
): Promise<McpTokenActionState> {
  const user = await requireStaff();
  const parsed = createSchema.safeParse(formValues(formData));
  if (!parsed.success) {
    return { error: "Check the highlighted fields.", fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  const supabase = await createClient();
  const nowIso = new Date().toISOString();
  const { count, error: countError } = await supabase
    .from("mcp_tokens")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .is("revoked_at", null)
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`);
  if (countError) {
    console.error("createMcpToken count", countError.message);
    return { error: GENERIC_ERROR };
  }
  if ((count ?? 0) >= MAX_ACTIVE_TOKENS) {
    return { error: `You already have ${MAX_ACTIVE_TOKENS} active tokens. Revoke one first.` };
  }

  const { token, hash, prefix } = generateMcpToken();
  const { expires } = parsed.data;
  const expiresAt =
    expires === "never" ? null : new Date(Date.now() + Number(expires) * 86_400_000).toISOString();

  // RLS: staff may only create tokens for themselves.
  const { error } = await supabase.from("mcp_tokens").insert({
    user_id: user.id,
    name: parsed.data.name,
    access: parsed.data.access,
    token_hash: hash,
    token_prefix: prefix,
    expires_at: expiresAt,
  });
  if (error) {
    console.error("createMcpToken insert", error.code, error.message);
    return { error: GENERIC_ERROR };
  }

  refresh();
  return {
    ok: true,
    message: "Token created. Copy it now: you will not see it again.",
    token,
  };
}

export async function revokeMcpToken(tokenId: string): Promise<ActionState> {
  const user = await requireStaff();
  const id = z.guid().safeParse(tokenId);
  if (!id.success) return { error: GENERIC_ERROR };

  const supabase = await createClient();
  // The column grant only allows revoked_at; RLS only the owner's own rows.
  const { data, error } = await supabase
    .from("mcp_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id.data)
    .eq("user_id", user.id)
    .is("revoked_at", null)
    .select("id");
  if (error) {
    console.error("revokeMcpToken", error.code, error.message);
    return { error: GENERIC_ERROR };
  }
  if (data.length === 0) return { error: "Token not found or already revoked." };

  refresh();
  return { ok: true, message: "Token revoked." };
}

/** Disconnect an app that was connected with OAuth (Claude and others). */
export async function revokeOAuthGrant(grantId: string): Promise<ActionState> {
  const user = await requireStaff();
  const id = z.guid().safeParse(grantId);
  if (!id.success) return { error: GENERIC_ERROR };

  const supabase = await createClient();
  // The column grant only allows revoked_at; RLS only the owner's own rows.
  const { data, error } = await supabase
    .from("oauth_grants")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id.data)
    .eq("user_id", user.id)
    .is("revoked_at", null)
    .select("id");
  if (error) {
    console.error("revokeOAuthGrant", error.code, error.message);
    return { error: GENERIC_ERROR };
  }
  if (data.length === 0) return { error: "Connection not found or already disconnected." };

  refresh();
  return { ok: true, message: "App disconnected." };
}

/** Claude's rights per module (admins): read, drafts and suggestions, or full write. */
export async function saveMcpModuleAccess(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  const levels = new Set(mcpWriteLevels.map((l) => l.value));
  const rows: { module: string; level: McpWriteLevel }[] = [];
  for (const m of mcpModules) {
    const value = formData.get(`level_${m.value}`);
    if (typeof value !== "string" || !levels.has(value as McpWriteLevel)) return { error: `Choose a level for ${m.label}.` };
    rows.push({ module: m.value, level: value as McpWriteLevel });
  }
  const supabase = await createClient();
  const { error } = await supabase.from("mcp_module_access").upsert(rows, { onConflict: "module" });
  if (error) {
    console.error("saveMcpModuleAccess", error.code, error.message);
    return { error: error.code === "42P01" ? "Run the migration 20261121020000_mcp_claude_rights.sql first." : GENERIC_ERROR };
  }
  refresh();
  return { ok: true, message: "Saved. Claude gets the new rights on its next request." };
}
