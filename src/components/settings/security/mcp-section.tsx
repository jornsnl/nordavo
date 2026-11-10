import { getCurrentUser, isStaff } from "@/lib/auth";
import { env } from "@/lib/env";
import { formatDate, formatDateTime } from "@/lib/format";
import { hasAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { McpSetupGuide } from "@/components/settings/security/mcp-setup-guide";
import { McpTokenForm } from "@/components/settings/security/mcp-token-form";
import { McpTokenList, type McpTokenRow } from "@/components/settings/security/mcp-token-list";
import { McpOAuthList, type OAuthGrantRow } from "@/components/settings/security/mcp-oauth-list";
import { createMcpToken, revokeMcpToken, revokeOAuthGrant } from "@/app/dashboard/settings/mcp-actions";

/**
 * Claude Code koppelen via MCP: personal tokens and setup instructions.
 * Rendered inside a <Suspense> boundary on the settings page. Staff only.
 */
export async function McpSection() {
  const user = await getCurrentUser();
  if (!isStaff(user)) return null;

  const [{ tokens, error }, grants] = await Promise.all([loadTokens(user.id), loadGrants(user.id)]);

  const endpoint = `${env.siteUrl().replace(/\/$/, "")}/api/mcp`;
  const enabled = hasAdminClient();

  return (
    <Card>
      <CardHeader
        title="Connect Claude (MCP)"
        description="Let Claude look up clients, vacancies, candidates and tasks in Nordavo with your permissions. Sign in with OAuth, or use a personal token."
      />
      <CardBody className="space-y-6 py-5">
        {!enabled && (
          <p className="rounded-xl border border-amber-600/20 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            The MCP server only works once <code className="font-mono text-xs">SUPABASE_SECRET_KEY</code> is set on the
            server. Ask an admin to add it.
          </p>
        )}
        {error && (
          <p role="alert" className="rounded-xl border border-danger/20 bg-danger-bg px-4 py-3 text-sm text-danger">
            Your tokens could not be loaded. Has the migration for mcp_tokens been run?
          </p>
        )}

        <section aria-labelledby="mcp-apps-heading" className="space-y-3">
          <h3 id="mcp-apps-heading" className="text-sm font-semibold text-brand-900">
            Connected apps
          </h3>
          <McpOAuthList grants={grants} revokeAction={revokeOAuthGrant} />
        </section>

        <section aria-labelledby="mcp-tokens-heading" className="space-y-3">
          <h3 id="mcp-tokens-heading" className="text-sm font-semibold text-brand-900">
            Your tokens
          </h3>
          <McpTokenList tokens={tokens} revokeAction={revokeMcpToken} />
        </section>

        <section aria-labelledby="mcp-new-heading" className="space-y-3">
          <h3 id="mcp-new-heading" className="text-sm font-semibold text-brand-900">
            New token
          </h3>
          <McpTokenForm action={createMcpToken} endpoint={endpoint} enabled={enabled} />
        </section>

        <McpSetupGuide endpoint={endpoint} />
      </CardBody>
    </Card>
  );
}

/** The user's own tokens (RLS), with the status computed at request time. Never selects token_hash. */
async function loadTokens(userId: string): Promise<{ tokens: McpTokenRow[]; error: boolean }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("mcp_tokens")
    .select("id, name, token_prefix, access, created_at, expires_at, last_used_at, revoked_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) console.error("McpSection", error.message);

  const now = Date.now();
  const tokens: McpTokenRow[] = (data ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    prefix: t.token_prefix,
    access: t.access === "write" ? "write" : "read",
    createdAt: formatDate(t.created_at),
    lastUsedAt: t.last_used_at ? formatDateTime(t.last_used_at) : "Not yet",
    expiresAt: t.expires_at ? formatDate(t.expires_at) : "Never",
    status: t.revoked_at
      ? "revoked"
      : t.expires_at && new Date(t.expires_at).getTime() <= now
        ? "expired"
        : "active",
  }));
  return { tokens, error: Boolean(error) };
}

/** Active OAuth connections of the user (RLS; the hashes are not even readable). */
async function loadGrants(userId: string): Promise<OAuthGrantRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("oauth_grants")
    .select("id, client_id, access, created_at, last_used_at, refresh_expires_at")
    .eq("user_id", userId)
    .is("revoked_at", null)
    .gt("refresh_expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) {
    console.error("McpSection grants", error.message);
    return [];
  }
  if (!data?.length) return [];

  const clientIds = [...new Set(data.map((g) => g.client_id))];
  const { data: clients } = await supabase
    .from("oauth_clients")
    .select("client_id, client_name")
    .in("client_id", clientIds);
  const names = new Map((clients ?? []).map((c) => [c.client_id, c.client_name]));

  return data.map((g) => ({
    id: g.id,
    appName: names.get(g.client_id) ?? "Unknown app",
    access: g.access === "write" ? "write" : "read",
    createdAt: formatDate(g.created_at),
    lastUsedAt: g.last_used_at ? formatDateTime(g.last_used_at) : "Not yet",
  }));
}
