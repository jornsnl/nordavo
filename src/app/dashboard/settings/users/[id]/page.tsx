import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { ArrowLeft, KeyRound } from "lucide-react";
import { getUserDetails, tokenState } from "@/lib/data/user-details";
import { formatDate, formatDateTime } from "@/lib/format";
import { optionFor, profileRoles } from "@/lib/labels";
import { effectiveModules, portalModules } from "@/lib/modules";
import { hasAdminClient } from "@/lib/supabase/admin";
import type { ProfileRole } from "@/lib/database.types";
import { PageHeader } from "@/components/dashboard/page-header";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, DetailList } from "@/components/ui/card";
import { ListSkeleton } from "@/components/ui/skeleton";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";

export const metadata: Metadata = { title: "User" };

/**
 * One user, read only, for admins: profile, security, memberships and the
 * MCP and API tokens they connected. Changing a role or modules stays in
 * the list on Settings; tokens are revoked by their owner.
 */
export default function UserPage({ params }: PageProps<"/dashboard/settings/users/[id]">) {
  return (
    <Suspense fallback={<ListSkeleton rows={6} />}>
      <UserDetailsView params={params} />
    </Suspense>
  );
}

const stateTone = { active: "success", expired: "neutral", revoked: "danger" } as const;

async function UserDetailsView({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getUserDetails(id);
  const role = optionFor(profileRoles, user.role as ProfileRole);
  const modules = effectiveModules(user.role as ProfileRole, user.modules);
  const keyKnown = hasAdminClient();

  return (
    <>
      <Link href="/dashboard/settings" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-brand-700">
        <ArrowLeft className="size-4" aria-hidden="true" />
        Settings
      </Link>
      <PageHeader
        eyebrow="User"
        title={
          <span className="flex flex-wrap items-center gap-3">
            <Avatar name={user.name} />
            {user.name}
            <Badge tone={role.tone}>{role.label}</Badge>
          </span>
        }
        description={user.email ?? "No email address"}
      />

      {!keyKnown && (
        <p className="mb-6 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
          SUPABASE_SECRET_KEY is not set, so sign-in, security and token details are unknown.
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Details" />
          <CardBody>
            <DetailList
              items={[
                { label: "Role", value: role.label },
                { label: "Client", value: user.clientName ?? (user.role === "client" ? "Not linked" : "None") },
                {
                  label: "Modules",
                  value:
                    user.role === "admin"
                      ? "Everything (admin)"
                      : portalModules.filter((m) => modules.includes(m.value)).map((m) => m.label).join(", ") || "None",
                },
                { label: "Time zone", value: user.timeZone ?? "Europe/Amsterdam" },
                { label: "Account since", value: formatDate(user.createdAt) },
                { label: "Last signed in", value: user.lastSignInAt ? formatDateTime(user.lastSignInAt) : "Never or unknown" },
              ]}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Security" />
          <CardBody>
            <DetailList
              items={[
                {
                  label: "Two-step verification",
                  value: user.mfaOn === null ? "Unknown" : <Badge tone={user.mfaOn ? "success" : "neutral"}>{user.mfaOn ? "On" : "Off"}</Badge>,
                },
                {
                  label: "Passkeys",
                  value:
                    user.passkeys.length === 0
                      ? "None"
                      : user.passkeys.map((p) => `${p.name} (added ${formatDate(p.createdAt)})`).join(", "),
                },
              ]}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Work" description="Workspaces and roles in the task tool." />
          <CardBody>
            {user.workspaces.length === 0 ? (
              <p className="text-sm text-muted">Not in a Work workspace.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {user.workspaces.map((w) => (
                  <li key={w.name} className="flex items-center justify-between gap-2">
                    {w.name}
                    <Badge tone={w.deactivated ? "neutral" : "brand"}>{w.deactivated ? "Deactivated" : w.role}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Content" description="Content workspaces and roles." />
          <CardBody>
            {user.role === "admin" ? (
              <p className="text-sm text-muted">Admin: sees and manages every content workspace.</p>
            ) : user.contentWorkspaces.length === 0 ? (
              <p className="text-sm text-muted">Not in a content workspace.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {user.contentWorkspaces.map((w) => (
                  <li key={w.name} className="flex items-center justify-between gap-2">
                    {w.name}
                    <Badge tone="brand">{w.role}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader
          title="Connected MCP and API tokens"
          description="For reference only. Portal MCP tokens open /api/mcp, Work tokens open /api/work (REST and MCP). Only the first characters are shown; the owner revokes a token in their own settings."
        />
        <CardBody>
          {user.tokens.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-muted">
              <KeyRound className="size-4" aria-hidden="true" />
              No tokens connected.
            </p>
          ) : (
            <Table>
              <THead>
                <tr>
                  <TH>Name</TH>
                  <TH>Connection</TH>
                  <TH>Access</TH>
                  <TH>Created</TH>
                  <TH>Last used</TH>
                  <TH>Expires</TH>
                  <TH>State</TH>
                </tr>
              </THead>
              <TBody>
                {user.tokens.map((token) => {
                  const state = tokenState(token);
                  return (
                    <TR key={`${token.kind}-${token.id}`}>
                      <TD>
                        <p className="font-medium text-ink">{token.name}</p>
                        <p className="font-mono text-xs text-muted">{token.prefix}…</p>
                      </TD>
                      <TD>{token.kind === "portal" ? "Portal MCP" : "Work API and MCP"}</TD>
                      <TD>
                        <Badge tone={token.access === "write" ? "warning" : "neutral"}>
                          {token.access === "write" ? "Read and write" : "Read only"}
                        </Badge>
                      </TD>
                      <TD className="text-muted">{formatDate(token.createdAt)}</TD>
                      <TD className="text-muted">{token.lastUsedAt ? formatDateTime(token.lastUsedAt) : "Never"}</TD>
                      <TD className="text-muted">{token.expiresAt ? formatDate(token.expiresAt) : "Never"}</TD>
                      <TD>
                        <Badge tone={stateTone[state]}>
                          {state === "active" ? "Active" : state === "expired" ? "Expired" : `Revoked ${formatDate(token.revokedAt)}`}
                        </Badge>
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>
    </>
  );
}
