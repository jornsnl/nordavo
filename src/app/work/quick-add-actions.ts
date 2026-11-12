"use server";

import { z } from "zod";
import type { QuickAddProject } from "@/components/work/quick-add-task";
import { getInboxProjectId, listMyWorkspaces, listProjectPeople, listProjects, requireWorkUser } from "@/lib/work/data";
import { quickAddProjects } from "@/lib/work/quick-add";

/**
 * What the quick add window (the "q" shortcut, from any screen) needs:
 * the projects you can add to, your inbox and who you are. Loaded when the
 * window opens for the first time, so pages stay as fast as they were.
 */
export type QuickAddContext = {
  projects: QuickAddProject[];
  inboxProjectId: string | null;
  user: { id: string; name: string; email: string | null; timeZone: string };
};

export async function quickAddContextAction(): Promise<QuickAddContext> {
  const user = await requireWorkUser();
  const [inboxProjectId, workspaces] = await Promise.all([getInboxProjectId(), listMyWorkspaces()]);
  const projects = (await Promise.all(workspaces.map((w) => listProjects(w.id)))).flat();
  return {
    projects: quickAddProjects(projects, workspaces, inboxProjectId),
    inboxProjectId,
    user: { id: user.id, name: user.name, email: user.email, timeZone: user.timeZone },
  };
}

/** The people who can own a task in this project (for the owner field of the quick add window). */
export async function quickAddPeopleAction(projectId: string): Promise<{ id: string; name: string; email: string | null }[]> {
  await requireWorkUser();
  if (!z.guid().safeParse(projectId).success) return [];
  try {
    const people = await listProjectPeople(projectId);
    return people.map((p) => ({ id: p.id, name: p.name, email: p.email }));
  } catch {
    // Not found or no access: only you, as with a new task in your inbox.
    return [];
  }
}
