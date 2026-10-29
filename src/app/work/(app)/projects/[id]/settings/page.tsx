import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ListSkeleton } from "@/components/ui/skeleton";
import { ProjectForm } from "@/components/work/forms";
import { AddPersonForm, ConfirmButton, InviteForm } from "@/components/work/people-admin";
import {
  addProjectMemberAction,
  inviteAction,
  removeProjectMemberAction,
  revokeInviteAction,
  updateProjectAction,
} from "@/app/work/actions";
import { getProject, listMembers, listOpenInvites, listProjectMembers, requireWorkUser } from "@/lib/work/data";
import { workOption, workRoles } from "@/lib/work/labels";
import { formatDateIn, formatDue } from "@/lib/work/time";

export const metadata: Metadata = { title: "Project settings" };

export default function ProjectSettingsPage({ params }: PageProps<"/work/projects/[id]/settings">) {
  return (
    <Suspense fallback={<ListSkeleton rows={6} />}>
      <Settings params={params} />
    </Suspense>
  );
}

async function Settings({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireWorkUser();
  const project = await getProject(id);
  if (!project.canManage) notFound();
  const isAdmin = project.workspace.role === "admin";

  const [people, members, invites] = await Promise.all([
    listProjectMembers(id, project.workspaceId),
    listMembers(project.workspaceId),
    listOpenInvites(project.workspaceId, id),
  ]);
  const inProject = new Set(people.map((p) => p.id));
  const candidates = members
    .filter((m) => !m.deactivatedAt && !inProject.has(m.id))
    .map((m) => ({ id: m.id, name: m.name, role: m.role }));

  return (
    <>
      <Link
        href={`/work/projects/${id}`}
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-brand-700 pointer-coarse:min-h-11"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {project.name}
      </Link>
      <PageHeader eyebrow={project.workspace.name} title="Settings and people" />

      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader title="Project" />
          <CardBody>
            <ProjectForm
              action={updateProjectAction.bind(null, id)}
              submitLabel="Save"
              showArchive
              defaults={{
                name: project.name,
                description: project.description,
                visibility: project.visibility,
                guestsSeeAssignedOnly: project.guestsSeeAssignedOnly,
                archived: project.archived,
              }}
            />
          </CardBody>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader
              title="People in this project"
              description={
                project.visibility === "open"
                  ? "Open project: every admin and member sees it. Add guests here."
                  : "Private project: only admins and these people see it."
              }
            />
            <ul className="divide-y divide-border">
              {people.map((p) => (
                <li key={p.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {p.name}
                      {p.id === user.id && <span className="ml-1 text-xs text-muted">(you)</span>}
                    </p>
                    <p className="truncate text-xs text-muted">
                      {p.email}
                      {p.accessExpiresAt && ` · access ends ${formatDue(p.accessExpiresAt, user.timeZone)}`}
                    </p>
                  </div>
                  {p.role && <Badge tone={workOption(workRoles, p.role).tone}>{workOption(workRoles, p.role).label}</Badge>}
                  <ConfirmButton
                    run={removeProjectMemberAction.bind(null, id, p.id)}
                    label="Remove"
                    confirm={`Remove ${p.name} from ${project.name}? Their access ends at once.`}
                  />
                </li>
              ))}
            </ul>
            <CardBody className="border-t border-border">
              <AddPersonForm action={addProjectMemberAction.bind(null, id)} candidates={candidates} showExpiry />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Invite someone new" description="They get a mail with a link that lands in this project." />
            <CardBody className="space-y-4">
              <InviteForm
                action={inviteAction.bind(null, { id: project.workspaceId, name: project.workspace.name })}
                projects={[{ id, name: project.name }]}
                defaultProjectId={id}
                roles={isAdmin ? ["admin", "member", "guest"] : ["guest"]}
              />
              {invites.length > 0 && (
                <ul className="divide-y divide-border border-t border-border pt-2">
                  {invites.map((invite) => (
                    <li key={invite.id} className="flex items-center gap-3 py-2 text-sm">
                      <span className="min-w-0 flex-1 truncate">
                        {invite.email} · {workOption(workRoles, invite.role).label}
                        <span className="text-xs text-muted"> · open until {formatDateIn(invite.expiresAt, user.timeZone)}</span>
                      </span>
                      <ConfirmButton run={revokeInviteAction.bind(null, invite.id)} label="Revoke" />
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
