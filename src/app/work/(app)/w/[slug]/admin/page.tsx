import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { ArrowLeft, Download } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ListSkeleton } from "@/components/ui/skeleton";
import { ConfirmButton, DeactivateButton, InviteForm, MemberRoleForm, WorkspaceNameForm } from "@/components/work/people-admin";
import {
  deactivateMemberAction,
  inviteAction,
  reactivateMemberAction,
  renameWorkspaceAction,
  revokeInviteAction,
  setMemberAction,
} from "@/app/work/actions";
import { listAccessLog, listMembers, listOpenInvites, listProjects, requireWorkspaceAdmin, requireWorkUser } from "@/lib/work/data";
import { accessActions, workOption, workRoles } from "@/lib/work/labels";
import { formatDateIn, formatDateTimeIn, formatDue, utcToLocalInput } from "@/lib/work/time";

export const metadata: Metadata = { title: "Manage workspace" };

export default function AdminPage({ params }: PageProps<"/work/w/[slug]/admin">) {
  return (
    <Suspense fallback={<ListSkeleton rows={8} />}>
      <Admin params={params} />
    </Suspense>
  );
}

async function Admin({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await requireWorkUser();
  const workspace = await requireWorkspaceAdmin(slug);
  const tz = user.timeZone;
  const [members, projects, invites, log] = await Promise.all([
    listMembers(workspace.id),
    listProjects(workspace.id),
    listOpenInvites(workspace.id),
    listAccessLog(workspace.id),
  ]);
  const active = members.filter((m) => !m.deactivatedAt);
  const inactive = members.filter((m) => m.deactivatedAt);
  const handover = active.filter((m) => m.role !== "guest").map((m) => ({ id: m.id, name: m.name }));
  const ws = { id: workspace.id, name: workspace.name };

  return (
    <>
      <Link
        href={`/work/w/${slug}`}
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-brand-700 pointer-coarse:min-h-11"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {workspace.name}
      </Link>
      <PageHeader
        eyebrow="Manage"
        title={workspace.name}
        description="Members, guests, roles and access. Every change lands in the access log below."
        actions={
          <>
            <a href={`/work/w/${slug}/export?format=json`} className={buttonClasses({ variant: "secondary" })}>
              <Download aria-hidden="true" />
              Export JSON
            </a>
            <a href={`/work/w/${slug}/export?format=csv`} className={buttonClasses({ variant: "secondary" })}>
              <Download aria-hidden="true" />
              Export CSV
            </a>
          </>
        }
      />

      <div className="space-y-5">
        <Card>
          <CardHeader title={`People (${active.length})`} description="Admins manage everything; members see open projects; guests only their projects." />
          <ul className="divide-y divide-border">
            {active.map((m) => (
              <li key={m.id} className="flex flex-col gap-3 px-4 py-4 sm:px-5 lg:flex-row lg:items-center">
                <div className="min-w-0 lg:w-64">
                  <p className="truncate text-sm font-medium">
                    {m.name}
                    {m.id === user.id && <span className="ml-1 text-xs text-muted">(you)</span>}
                  </p>
                  <p className="truncate text-xs text-muted">{m.email}</p>
                  {m.projects.length > 0 && (
                    <p className="mt-1 line-clamp-2 text-xs text-muted">
                      In: {m.projects.map((p) => p.name + (p.accessExpiresAt ? ` (until ${formatDateIn(p.accessExpiresAt, tz)})` : "")).join(", ")}
                    </p>
                  )}
                </div>
                <div className="flex-1">
                  <MemberRoleForm
                    action={setMemberAction.bind(null, workspace.id)}
                    userId={m.id}
                    role={m.role}
                    expiresLocal={utcToLocalInput(m.accessExpiresAt, tz)}
                    disabled={m.id === user.id}
                  />
                </div>
                {m.id !== user.id && (
                  <DeactivateButton
                    action={deactivateMemberAction.bind(null, workspace.id)}
                    userId={m.id}
                    name={m.name}
                    transferOptions={handover.filter((h) => h.id !== m.id)}
                  />
                )}
              </li>
            ))}
          </ul>
        </Card>

        {inactive.length > 0 && (
          <Card>
            <CardHeader title="Deactivated" description="No access any more. Their history stays." />
            <ul className="divide-y divide-border">
              {inactive.map((m) => (
                <li key={m.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-muted">{m.name}</p>
                    <p className="text-xs text-muted">Deactivated {formatDateIn(m.deactivatedAt, tz)}</p>
                  </div>
                  <ConfirmButton run={reactivateMemberAction.bind(null, workspace.id, m.id)} label="Reactivate" icon={false} />
                </li>
              ))}
            </ul>
          </Card>
        )}

        <div className="grid gap-5 xl:grid-cols-2">
          <Card>
            <CardHeader title="Invite" description="The mail has a link that lands in the workspace, or straight in the project." />
            <CardBody className="space-y-4">
              <InviteForm action={inviteAction.bind(null, ws)} projects={projects.map((p) => ({ id: p.id, name: p.name }))} roles={["admin", "member", "guest"]} />
              {invites.length > 0 && (
                <ul className="divide-y divide-border border-t border-border pt-2">
                  {invites.map((invite) => (
                    <li key={invite.id} className="flex items-center gap-3 py-2 text-sm">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{invite.email}</span>
                        <span className="text-xs text-muted">
                          {workOption(workRoles, invite.role).label}
                          {invite.projectName && ` in ${invite.projectName}`} · by {invite.invitedBy?.name ?? "someone"} · open until{" "}
                          {formatDateIn(invite.expiresAt, tz)}
                        </span>
                      </span>
                      <ConfirmButton run={revokeInviteAction.bind(null, invite.id)} label="Revoke" />
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Workspace" />
            <CardBody>
              <WorkspaceNameForm action={renameWorkspaceAction.bind(null, workspace.id)} name={workspace.name} />
              <p className="mt-4 text-xs text-muted">Web address: /work/w/{workspace.slug}</p>
            </CardBody>
          </Card>
        </div>

        <Card>
          <CardHeader title="Access log" description="Who got or lost access, and when. Latest 300 entries." />
          <ul className="divide-y divide-border">
            {log.length === 0 && <li className="px-5 py-4 text-sm text-muted">Nothing yet.</li>}
            {log.map((entry) => (
              <li key={entry.id} className="flex flex-col gap-1 px-4 py-2.5 text-sm sm:flex-row sm:items-center sm:gap-4 sm:px-5">
                <time className="shrink-0 text-xs text-muted sm:w-40" dateTime={entry.createdAt}>
                  {formatDateTimeIn(entry.createdAt, tz)}
                </time>
                <span className="min-w-0 flex-1">
                  <Badge tone={entry.action === "revoked" || entry.action === "deactivated" || entry.action === "expired" ? "danger" : "neutral"}>
                    {accessActions[entry.action]}
                  </Badge>{" "}
                  <strong className="font-medium">{entry.person?.name ?? entry.email ?? "Someone"}</strong>
                  {entry.role && ` as ${entry.role}`}
                  {entry.projectName && ` in ${entry.projectName}`}
                  {typeof entry.details.access_expires_at === "string" && ` until ${formatDue(entry.details.access_expires_at, tz)}`}
                </span>
                <span className="text-xs text-muted">{entry.actor ? `by ${entry.actor.name}` : "automatic"}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
