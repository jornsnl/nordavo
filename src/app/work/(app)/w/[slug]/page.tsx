import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { FolderKanban, Lock, Settings, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { ListSkeleton } from "@/components/ui/skeleton";
import { NewProjectButton } from "@/components/work/forms";
import { getWorkspace, listProjects } from "@/lib/work/data";
import { workOption, workRoles } from "@/lib/work/labels";
import { createProjectAction } from "@/app/work/actions";

export const metadata: Metadata = { title: "Workspace" };

export default function WorkspacePage({ params }: PageProps<"/work/w/[slug]">) {
  return (
    <Suspense fallback={<ListSkeleton rows={5} />}>
      <Workspace params={params} />
    </Suspense>
  );
}

async function Workspace({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const workspace = await getWorkspace(slug);
  const projects = await listProjects(workspace.id, { includeArchived: workspace.role === "admin" });
  const role = workOption(workRoles, workspace.role);

  return (
    <>
      <PageHeader
        eyebrow="Workspace"
        title={
          <span className="flex flex-wrap items-center gap-3">
            {workspace.name}
            <Badge tone={role.tone}>You: {role.label}</Badge>
          </span>
        }
        description={
          workspace.role === "guest"
            ? "You see the projects you were added to."
            : "Open projects are visible to every member; private ones only to the people in them."
        }
        actions={
          <>
            {workspace.role !== "guest" && <NewProjectButton action={createProjectAction.bind(null, workspace.id)} />}
            {workspace.role === "admin" && (
              <>
                <ButtonLink href={`/work/w/${slug}/admin`} variant="secondary">
                  <Settings aria-hidden="true" />
                  Manage
                </ButtonLink>
                <ButtonLink href={`/work/w/${slug}/trash`} variant="secondary">
                  <Trash2 aria-hidden="true" />
                  Trash
                </ButtonLink>
              </>
            )}
          </>
        }
      />

      {projects.length === 0 ? (
        <EmptyState icon={FolderKanban} title="No projects yet" description="Create a project to start handing out tasks." />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {projects.map((project) => (
            <li key={project.id}>
              <Link
                href={`/work/projects/${project.id}`}
                className={`block h-full rounded-2xl border border-border bg-card p-4 shadow-xs transition hover:border-brand-200 hover:shadow-sm ${
                  project.archived ? "opacity-60" : ""
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <h2 className="font-display font-semibold text-brand-900">{project.name}</h2>
                  {project.visibility === "private" && <Lock className="size-4 shrink-0 text-muted" aria-label="Private" />}
                </div>
                {project.description && <p className="mt-1 line-clamp-2 text-sm text-muted">{project.description}</p>}
                <p className="mt-3 flex flex-wrap gap-2 text-xs text-muted">
                  <span>{project.openTasks} open</span>
                  {project.inReview > 0 && <Badge tone="accent">{project.inReview} in review</Badge>}
                  {project.archived && <Badge>Archived</Badge>}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
