import "server-only";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { verifiedTotpFactors } from "@/lib/security/mfa";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type ConnectedToken = {
  id: string;
  /**
   * How it connects: a portal MCP token (/api/mcp), an app connected to the
   * portal MCP through OAuth (for example claude.ai), or a Work token
   * (/api/work, REST and MCP).
   */
  kind: "portal" | "oauth" | "work";
  name: string;
  prefix: string;
  access: "read" | "write";
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

export type UserDetails = {
  id: string;
  name: string;
  email: string | null;
  role: string;
  clientName: string | null;
  modules: string[];
  timeZone: string | null;
  createdAt: string;
  lastSignInAt: string | null;
  /** Null when the secret key is missing (unknown). */
  mfaOn: boolean | null;
  passkeys: { name: string; createdAt: string; lastUsedAt: string | null }[];
  workspaces: { name: string; role: string; deactivated: boolean }[];
  contentWorkspaces: { name: string; role: string }[];
  tokens: ConnectedToken[];
};

/**
 * Everything an admin may want to look up about one user, read only: the
 * profile, sign-in and security state, Work and Content memberships, and
 * the MCP apps (OAuth) and API tokens they connected (name, first characters, access and
 * use; never the token itself, which is only stored as a hash). Tokens and
 * passkeys are private to their owner under RLS, so they are read with the
 * secret key after requireAdmin().
 */
export async function getUserDetails(userId: string): Promise<UserDetails> {
  await requireAdmin();
  if (!/^[0-9a-f-]{36}$/i.test(userId)) notFound();
  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, email, role, modules, time_zone, created_at, client:clients!profiles_client_id_fkey(name)")
    .eq("id", userId)
    .maybeSingle();
  if (!profile) notFound();

  const admin = createAdminClient();
  const details: UserDetails = {
    id: profile.id,
    name: profile.full_name || profile.email || "Unnamed",
    email: profile.email,
    role: profile.role,
    clientName: profile.client?.name ?? null,
    modules: profile.modules ?? [],
    timeZone: profile.time_zone,
    createdAt: profile.created_at,
    lastSignInAt: null,
    mfaOn: null,
    passkeys: [],
    workspaces: [],
    contentWorkspaces: [],
    tokens: [],
  };
  if (!admin) return details;

  const [authUser, factors, passkeys, portalTokens, workTokens, workMembers, contentMembers, grants] = await Promise.all([
    admin.auth.admin.getUserById(userId),
    admin.auth.admin.mfa.listFactors({ userId }),
    admin.from("passkeys").select("name, created_at, last_used_at").eq("user_id", userId).order("created_at"),
    admin
      .from("mcp_tokens")
      .select("id, name, token_prefix, access, created_at, expires_at, last_used_at, revoked_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),
    admin
      .from("work_api_tokens")
      .select("id, name, token_prefix, access, created_at, expires_at, last_used_at, revoked_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),
    admin.from("work_members").select("role, deactivated_at, workspace_id").eq("user_id", userId),
    admin.from("content_members").select("role, workspace_id").eq("user_id", userId),
    admin
      .from("oauth_grants")
      .select("id, client_id, access, created_at, refresh_expires_at, last_used_at, revoked_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),
  ]);

  details.lastSignInAt = authUser.data.user?.last_sign_in_at ?? null;
  details.mfaOn = factors.error ? null : verifiedTotpFactors(factors.data?.factors).length > 0;
  details.passkeys = (passkeys.data ?? []).map((p) => ({ name: p.name, createdAt: p.created_at, lastUsedAt: p.last_used_at }));

  const token = (kind: ConnectedToken["kind"]) => (t: NonNullable<typeof portalTokens.data>[number]): ConnectedToken => ({
    id: t.id,
    kind,
    name: t.name,
    prefix: t.token_prefix,
    access: t.access === "write" ? "write" : "read",
    createdAt: t.created_at,
    expiresAt: t.expires_at,
    lastUsedAt: t.last_used_at,
    revokedAt: t.revoked_at,
  });
  const clientIds = [...new Set((grants.data ?? []).map((g) => g.client_id))];
  const { data: clients } = clientIds.length
    ? await admin.from("oauth_clients").select("client_id, client_name").in("client_id", clientIds)
    : { data: [] };
  const clientName = new Map((clients ?? []).map((c) => [c.client_id, c.client_name]));
  const oauth: ConnectedToken[] = (grants.data ?? []).map((g) => ({
    id: g.id,
    kind: "oauth",
    name: clientName.get(g.client_id) ?? "Connected app",
    prefix: g.client_id.slice(0, 8),
    access: g.access === "write" ? "write" : "read",
    createdAt: g.created_at,
    expiresAt: g.refresh_expires_at,
    lastUsedAt: g.last_used_at,
    revokedAt: g.revoked_at,
  }));
  details.tokens = [
    ...oauth,
    ...(portalTokens.data ?? []).map(token("portal")),
    ...(workTokens.data ?? []).map(token("work")),
  ];

  const workIds = (workMembers.data ?? []).map((m) => m.workspace_id);
  const contentIds = (contentMembers.data ?? []).map((m) => m.workspace_id);
  const [workNames, contentNames] = await Promise.all([
    workIds.length ? admin.from("work_workspaces").select("id, name").in("id", workIds) : Promise.resolve({ data: [] }),
    contentIds.length ? admin.from("content_workspaces").select("id, name").in("id", contentIds) : Promise.resolve({ data: [] }),
  ]);
  const workName = new Map((workNames.data ?? []).map((w) => [w.id, w.name]));
  const contentName = new Map((contentNames.data ?? []).map((w) => [w.id, w.name]));
  details.workspaces = (workMembers.data ?? []).map((m) => ({
    name: workName.get(m.workspace_id) ?? "Workspace",
    role: m.role,
    deactivated: Boolean(m.deactivated_at),
  }));
  details.contentWorkspaces = (contentMembers.data ?? []).map((m) => ({
    name: contentName.get(m.workspace_id) ?? "Workspace",
    role: m.role,
  }));
  return details;
}

/** Active, expired or revoked, for the badge. */
export function tokenState(token: Pick<ConnectedToken, "revokedAt" | "expiresAt">, now: Date = new Date()): "active" | "expired" | "revoked" {
  if (token.revokedAt) return "revoked";
  if (token.expiresAt && new Date(token.expiresAt).getTime() <= now.getTime()) return "expired";
  return "active";
}
