import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { ListSkeleton } from "@/components/ui/skeleton";
import { QuickLogForm } from "@/components/work/quick-log-form";
import { TaskGroup } from "@/components/work/task-row";
import { quickLogAction } from "@/app/work/actions";
import { listMyWorkspaces, listOverview, listProjects, requireWorkUser } from "@/lib/work/data";
import { utcToLocalInput } from "@/lib/work/time";

export const metadata: Metadata = { title: "Quick log" };

export default function QuickLogPage() {
  return (
    <>
      <PageHeader
        eyebrow="Work"
        title="Quick log"
        description="Finished something that was never a task? Log it in one step. It is saved as a done task in the project."
      />
      <Suspense fallback={<ListSkeleton rows={4} />}>
        <QuickLog />
      </Suspense>
    </>
  );
}

async function QuickLog() {
  const user = await requireWorkUser();
  const workspaces = await listMyWorkspaces();
  const projects = (await Promise.all(workspaces.map((w) => listProjects(w.id)))).flatMap((list, i) =>
    list.map((p) => ({ id: p.id, label: workspaces.length > 1 ? `${workspaces[i].name} › ${p.name}` : p.name })),
  );
  const recent = (await listOverview("mine", { status: "done" }))
    .filter((t) => t.isLog)
    .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""))
    .slice(0, 10);

  return (
    <div className="space-y-5">
      <Card>
        <CardBody className="py-5">
          {projects.length === 0 ? (
            <p className="text-sm text-muted">You need access to a project before you can log work.</p>
          ) : (
            <QuickLogForm
              action={quickLogAction}
              projects={projects}
              defaultProjectId={projects.length === 1 ? projects[0].id : undefined}
              nowLocal={utcToLocalInput(new Date().toISOString(), user.timeZone)}
            />
          )}
        </CardBody>
      </Card>
      {recent.length > 0 && <TaskGroup title="Recently logged" tasks={recent} timeZone={user.timeZone} />}
    </div>
  );
}
