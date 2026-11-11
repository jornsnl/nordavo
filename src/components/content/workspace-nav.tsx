import Link from "next/link";
import { Plus } from "lucide-react";
import { listMyContentWorkspaces, requireContentUser } from "@/lib/content/data";
import { roleLabel } from "@/lib/content/rules";
import type { ContentWorkspaceItem } from "@/lib/content/data";

/** The sections of a workspace, as far as its modules are switched on. */
export function workspaceSections(workspace: Pick<ContentWorkspaceItem, "slug" | "modules" | "role">) {
  const base = `/content/w/${workspace.slug}`;
  const sections = [
    { label: "Home", href: base },
    workspace.modules.ideas ? { label: "Ideas", href: `${base}/ideas` } : null,
    { label: "Posts", href: `${base}/posts` },
    { label: "Calendar", href: `${base}/calendar` },
    workspace.modules.media ? { label: "Media", href: `${base}/media` } : null,
    workspace.modules.sources ? { label: "Sources", href: `${base}/sources` } : null,
    workspace.modules.series ? { label: "Series", href: `${base}/series` } : null,
    workspace.modules.results ? { label: "Results", href: `${base}/results` } : null,
    workspace.role === "admin" || workspace.role === "author" ? { label: "Settings", href: `${base}/settings` } : null,
  ];
  return sections.filter((s): s is { label: string; href: string } => s !== null);
}

/** Every content workspace this user can open, with its sections, for the sidebar. */
export async function ContentWorkspaceNav() {
  const [workspaces, user] = await Promise.all([listMyContentWorkspaces(), requireContentUser()]);
  return (
    <nav aria-label="Workspaces" className="space-y-5">
      {workspaces.map((workspace) => (
        <div key={workspace.id}>
          <Link
            href={`/content/w/${workspace.slug}`}
            className="mb-1.5 flex items-center justify-between rounded-lg px-3 text-[11px] font-semibold tracking-wider text-brand-200/60 uppercase hover:text-white"
          >
            <span className="truncate">{workspace.name}</span>
            <span className="font-medium tracking-normal normal-case">{roleLabel(workspace.role).label}</span>
          </Link>
          <ul className="space-y-0.5">
            {workspaceSections(workspace).map((section) => (
              <li key={section.href}>
                <Link
                  href={section.href}
                  className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-brand-100/70 hover:bg-white/5 hover:text-white max-lg:min-h-10"
                >
                  {section.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {workspaces.length === 0 && (
        <p className="px-3 text-xs leading-relaxed text-brand-200/60">You are not in a content workspace yet. Ask an admin to add you.</p>
      )}
      {user.isAdmin && (
        <div className="space-y-0.5">
          <Link href="/content/library" className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-brand-200/70 hover:bg-white/5 hover:text-white">
            Company media library
          </Link>
          <Link href="/content/reviewer-count" className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-brand-200/70 hover:bg-white/5 hover:text-white">
            Reviewer count
          </Link>
          <Link href="/content/new" className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-brand-200/70 hover:bg-white/5 hover:text-white">
            <Plus className="size-4" aria-hidden="true" />
            New workspace
          </Link>
        </div>
      )}
    </nav>
  );
}
