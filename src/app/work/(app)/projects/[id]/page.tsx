import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { ArrowLeft, FolderOpen, Lock, Settings } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { ListSkeleton } from "@/components/ui/skeleton";
import { FilterBar } from "@/components/work/filter-bar";
import { NewTaskButton } from "@/components/work/forms";
import { Markdown } from "@/components/work/markdown";
import { PageTabs } from "@/components/work/page-tabs";
import { TaskGroup } from "@/components/work/task-row";
import { createTaskAction } from "@/app/work/actions";
import { getProject, listProjectPeople, listProjectTasks, requireWorkUser, type TaskListItem } from "@/lib/work/data";
import type { WorkStatus } from "@/lib/work/database";
import { isWorkPriority, isWorkStatus, workPriorities, workStatuses } from "@/lib/work/labels";

export const metadata: Metadata = { title: "Project" };

type Search = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default function ProjectPage({ params, searchParams }: PageProps<"/work/projects/[id]">) {
  return (
    <Suspense fallback={<ListSkeleton rows={6} />}>
      <Project params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Project({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Search> }) {
  const { id } = await params;
  const query = await searchParams;
  const user = await requireWorkUser();
  const project = await getProject(id);

  const status = first(query.status);
  const priority = first(query.priority);
  const owner = first(query.owner);
  const showDone = first(query.done) === "1";
  const [tasks, people] = await Promise.all([
    listProjectTasks(id, {
      status: isWorkStatus(status) ? status : undefined,
      priority: isWorkPriority(priority) ? priority : undefined,
      owner: owner && /^[0-9a-f-]{36}$/i.test(owner) ? owner : undefined,
      showDone,
    }),
    listProjectPeople(id),
  ]);

  const base = `/work/projects/${id}`;
  const withDone = (on: boolean) => {
    const q = new URLSearchParams();
    if (isWorkStatus(status)) q.set("status", status);
    if (isWorkPriority(priority)) q.set("priority", priority);
    if (owner) q.set("owner", owner);
    if (on) q.set("done", "1");
    const s = q.toString();
    return s ? `${base}?${s}` : base;
  };

  const order: WorkStatus[] = ["review", "in_progress", "todo", "done", "cancelled"];
  const byStatus = new Map<WorkStatus, TaskListItem[]>();
  for (const task of tasks) byStatus.set(task.status, [...(byStatus.get(task.status) ?? []), task]);

  return (
    <>
      <Link
        href={`/work/w/${project.workspace.slug}`}
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-brand-700 pointer-coarse:min-h-11"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {project.workspace.name}
      </Link>
      <PageHeader
        eyebrow={project.workspace.name}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {project.name}
            {project.visibility === "private" && (
              <Badge tone="warning">
                <Lock className="size-3" aria-hidden="true" />
                Private
              </Badge>
            )}
            {project.archived && <Badge>Archived</Badge>}
          </span>
        }
        actions={
          <>
            {!project.archived && (
              <NewTaskButton
                action={createTaskAction.bind(null, id)}
                people={people.map((p) => ({ id: p.id, name: p.name, role: p.role }))}
                currentUserId={user.id}
              />
            )}
            {project.canManage && (
              <ButtonLink href={`${base}/settings`} variant="secondary">
                <Settings aria-hidden="true" />
                Settings and people
              </ButtonLink>
            )}
          </>
        }
      />
      {project.description && (
        <div className="mb-6 max-w-3xl">
          <Markdown text={project.description} className="text-muted" />
        </div>
      )}

      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <PageTabs
          label="Finished tasks"
          tabs={[
            { label: "Open", href: withDone(false), active: !showDone },
            { label: "Everything", href: withDone(true), active: showDone },
          ]}
        />
        <FilterBar
          basePath={base}
          filters={[
            { name: "status", label: "Status", all: "Any status", options: workStatuses.map((s) => ({ value: s.value, label: s.label })) },
            { name: "owner", label: "Owner", all: "Any owner", options: people.map((p) => ({ value: p.id, label: p.name })) },
            { name: "priority", label: "Priority", all: "Any priority", options: workPriorities.map((p) => ({ value: p.value, label: p.label })) },
          ]}
        />
      </div>

      {tasks.length === 0 ? (
        <EmptyState
          icon={FolderOpen}
          title="No tasks here"
          description={project.archived ? "This project is archived." : "Create a task, or change the filters."}
        />
      ) : (
        <div className="space-y-4">
          {order
            .filter((s) => byStatus.has(s))
            .map((s) => (
              <TaskGroup
                key={s}
                title={workStatuses.find((o) => o.value === s)!.label}
                tasks={byStatus.get(s)!}
                timeZone={user.timeZone}
                showContext={false}
              />
            ))}
        </div>
      )}
    </>
  );
}
