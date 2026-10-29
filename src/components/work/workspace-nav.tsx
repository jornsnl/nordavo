import Link from "next/link";
import { Lock, Plus } from "lucide-react";
import { canCreateWorkspace, listMyWorkspaces, listProjects } from "@/lib/work/data";
import { workOption, workRoles } from "@/lib/work/labels";

/** Every workspace and project this user can open, for the sidebar. */
export async function WorkspaceNav() {
  const [workspaces, canCreate] = await Promise.all([listMyWorkspaces(), canCreateWorkspace()]);
  const projects = await Promise.all(workspaces.map((w) => listProjects(w.id)));

  return (
    <nav aria-label="Workspaces" className="space-y-5">
      {workspaces.map((workspace, i) => (
        <div key={workspace.id}>
          <Link
            href={`/work/w/${workspace.slug}`}
            className="mb-1.5 flex items-center justify-between rounded-lg px-3 text-[11px] font-semibold tracking-wider text-brand-200/60 uppercase hover:text-white"
          >
            {workspace.name}
            {workspace.role !== "member" && (
              <span className="font-medium tracking-normal normal-case">{workOption(workRoles, workspace.role).label}</span>
            )}
          </Link>
          <ul className="space-y-0.5">
            {projects[i].map((project) => (
              <li key={project.id}>
                <Link
                  href={`/work/projects/${project.id}`}
                  className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-brand-100/70 hover:bg-white/5 hover:text-white max-lg:min-h-10"
                >
                  <span className="min-w-0 flex-1 truncate">{project.name}</span>
                  {project.visibility === "private" && <Lock className="size-3.5 shrink-0 text-brand-200/50" aria-label="Private" />}
                  {project.inReview > 0 && (
                    <span className="rounded-full bg-accent-500/20 px-1.5 text-[11px] font-semibold text-accent-500" title="In review">
                      {project.inReview}
                    </span>
                  )}
                </Link>
              </li>
            ))}
            {projects[i].length === 0 && <li className="px-3 py-1 text-xs text-brand-200/50">No projects yet</li>}
          </ul>
        </div>
      ))}
      {workspaces.length === 0 && (
        <p className="px-3 text-xs leading-relaxed text-brand-200/60">You are not in a workspace yet. Ask an admin for an invite.</p>
      )}
      {canCreate && (
        <Link
          href="/work/new"
          className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-brand-200/70 hover:bg-white/5 hover:text-white"
        >
          <Plus className="size-4" aria-hidden="true" />
          New workspace
        </Link>
      )}
    </nav>
  );
}

export function WorkspaceNavSkeleton() {
  return (
    <div className="space-y-2 px-3" aria-hidden="true">
      {Array.from({ length: 4 }, (_, i) => (
        <span key={i} className="block h-4 w-full animate-pulse rounded bg-white/10" />
      ))}
    </div>
  );
}
