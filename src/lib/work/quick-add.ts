import type { QuickAddProject } from "@/components/work/quick-add-task";

type ProjectLike = { id: string; name: string; workspaceId: string; archived: boolean };
type WorkspaceLike = { id: string; name: string; slug: string; kind: "shared" | "private" | "inbox" };

/**
 * The projects a quick add can go to: the inbox first (shown as "Inbox"),
 * then every open project. With more than one workspace the name says which
 * workspace it is in ("Home › Tasks").
 */
export function quickAddProjects(projects: ProjectLike[], workspaces: WorkspaceLike[], inboxProjectId: string | null): QuickAddProject[] {
  const byId = new Map(workspaces.map((w) => [w.id, w]));
  const several = workspaces.filter((w) => w.kind !== "inbox").length > 1;
  const list = projects
    .filter((p) => !p.archived && byId.has(p.workspaceId))
    .map((p) => {
      const w = byId.get(p.workspaceId)!;
      const inbox = p.id === inboxProjectId || w.kind === "inbox";
      return {
        id: p.id,
        name: inbox ? "Inbox" : several ? `${w.name} › ${p.name}` : p.name,
        workspace: { id: w.id, name: w.name, slug: w.slug },
        inbox,
      };
    });
  list.sort((a, b) => Number(b.inbox) - Number(a.inbox));
  return list.map((p) => ({ id: p.id, name: p.name, workspace: p.workspace }));
}
