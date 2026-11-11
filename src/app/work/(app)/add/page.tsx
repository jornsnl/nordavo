import type { Metadata } from "next";
import { Suspense } from "react";
import { Inbox } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/dashboard/empty-state";
import { ListSkeleton } from "@/components/ui/skeleton";
import { LiveTasks } from "@/components/work/live-task-lists";
import { QuickAddTask } from "@/components/work/quick-add-task";
import { getInboxProjectId, listMyWorkspaces, listProjects, listProjectTasks, requireWorkUser } from "@/lib/work/data";
import { openStatuses } from "@/lib/work/labels";
import { quickAddProjects } from "@/lib/work/quick-add";

export const metadata: Metadata = { title: "Add a task" };

/**
 * Dump a task in one go (feedback Julius): open, type, Enter, done. The
 * field has the focus, the task goes to your inbox unless you pick another
 * project, and it works offline. Built for the home screen shortcut and a
 * narrow side panel (Sidepad), so nothing else is on the page.
 */
export default function AddTaskPage() {
  return (
    <>
      <PageHeader eyebrow="Work" title="Add a task" description="Type and press Enter. It lands in your inbox; sort it later." />
      <Suspense fallback={<ListSkeleton rows={3} />}>
        <AddTask />
      </Suspense>
    </>
  );
}

async function AddTask() {
  const user = await requireWorkUser();
  const inboxProjectId = await getInboxProjectId();
  const workspaces = await listMyWorkspaces();
  const projects = (await Promise.all(workspaces.map((w) => listProjects(w.id)))).flat();
  const inbox = inboxProjectId ? (await listProjectTasks(inboxProjectId, {})).filter((t) => openStatuses.includes(t.status)) : [];
  const options = quickAddProjects(projects, workspaces, inboxProjectId);

  return (
    <div className="space-y-5">
      <QuickAddTask projects={options} user={{ id: user.id, name: user.name, email: user.email }} defaultProjectId={inboxProjectId ?? undefined} autoFocus />
      {inboxProjectId && (
        <LiveTasks
          tasks={inbox}
          view={{ projectId: inboxProjectId, statuses: openStatuses }}
          layout="group"
          title="In your inbox"
          description="Open a task to move it to a project"
          timeZone={user.timeZone}
          showContext={false}
          empty={<EmptyState icon={Inbox} title="Your inbox is empty" description="Tasks you add without a project land here." />}
        />
      )}
    </div>
  );
}
