import { getCurrentUser, isStaff } from "@/lib/auth";
import { env } from "@/lib/env";
import { formatDate, formatDateTime } from "@/lib/format";
import { hasAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { McpSetupGuide } from "@/components/settings/security/mcp-setup-guide";
import { McpTokenForm } from "@/components/settings/security/mcp-token-form";
import { McpTokenList, type McpTokenRow } from "@/components/settings/security/mcp-token-list";
import { createMcpToken, revokeMcpToken } from "@/app/dashboard/instellingen/mcp-actions";

/**
 * Claude Code koppelen via MCP: personal tokens and setup instructions.
 * Rendered inside a <Suspense> boundary on the settings page. Staff only.
 */
export async function McpSection() {
  const user = await getCurrentUser();
  if (!isStaff(user)) return null;

  const { tokens, error } = await loadTokens(user.id);

  const endpoint = `${env.siteUrl().replace(/\/$/, "")}/api/mcp`;
  const enabled = hasAdminClient();

  return (
    <Card>
      <CardHeader
        title="Claude Code koppelen (MCP)"
        description="Laat Claude Code met jouw rechten klanten, vacatures, kandidaten en taken in Nordavo opzoeken."
      />
      <CardBody className="space-y-6 py-5">
        {!enabled && (
          <p className="rounded-xl border border-amber-600/20 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            De MCP server werkt pas als <code className="font-mono text-xs">SUPABASE_SECRET_KEY</code> op de
            server is ingesteld. Vraag een beheerder om die toe te voegen.
          </p>
        )}
        {error && (
          <p role="alert" className="rounded-xl border border-danger/20 bg-danger-bg px-4 py-3 text-sm text-danger">
            Je tokens konden niet worden geladen. Is de migratie voor mcp_tokens uitgevoerd?
          </p>
        )}

        <section aria-labelledby="mcp-tokens-heading" className="space-y-3">
          <h3 id="mcp-tokens-heading" className="text-sm font-semibold text-brand-900">
            Je tokens
          </h3>
          <McpTokenList tokens={tokens} revokeAction={revokeMcpToken} />
        </section>

        <section aria-labelledby="mcp-new-heading" className="space-y-3">
          <h3 id="mcp-new-heading" className="text-sm font-semibold text-brand-900">
            Nieuw token
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
    lastUsedAt: t.last_used_at ? formatDateTime(t.last_used_at) : "Nog niet",
    expiresAt: t.expires_at ? formatDate(t.expires_at) : "Nooit",
    status: t.revoked_at
      ? "revoked"
      : t.expires_at && new Date(t.expires_at).getTime() <= now
        ? "expired"
        : "active",
  }));
  return { tokens, error: Boolean(error) };
}
