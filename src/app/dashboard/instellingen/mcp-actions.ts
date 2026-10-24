"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { type ActionState, GENERIC_ERROR, fieldErrorsFrom, formValues } from "@/lib/action-state";
import { requireStaff } from "@/lib/auth";
import { generateMcpToken } from "@/lib/mcp/tokens";
import { createClient } from "@/lib/supabase/server";

/** Action state of the create form; token is only set right after creating it. */
export type McpTokenActionState = ActionState & { token?: string };

const MAX_ACTIVE_TOKENS = 20;

const createSchema = z.object({
  name: z
    .string({ error: "Geef het token een naam" })
    .trim()
    .min(1, { error: "Geef het token een naam" })
    .max(80, { error: "Maximaal 80 tekens" }),
  access: z.enum(["read", "write"], { error: "Kies lezen of lezen en schrijven" }),
  expires: z.enum(["30", "90", "365", "never"], { error: "Kies een geldigheid" }),
});

export async function createMcpToken(
  _prev: McpTokenActionState,
  formData: FormData,
): Promise<McpTokenActionState> {
  const user = await requireStaff();
  const parsed = createSchema.safeParse(formValues(formData));
  if (!parsed.success) {
    return { error: "Controleer de gemarkeerde velden.", fieldErrors: fieldErrorsFrom(parsed.error) };
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
    return { error: `Je hebt al ${MAX_ACTIVE_TOKENS} actieve tokens. Trek er eerst een in.` };
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
    message: "Token aangemaakt. Kopieer het nu: je ziet het hierna nooit meer.",
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
  if (data.length === 0) return { error: "Token niet gevonden of al ingetrokken." };

  refresh();
  return { ok: true, message: "Token ingetrokken." };
}
