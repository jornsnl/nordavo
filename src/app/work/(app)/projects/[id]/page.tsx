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
import { LiveTasks } from "@/components/work/live-task-lists";
import { QuickAddTask } from "@/components/work/quick-add-task";
import type { TaskView } from "@/lib/offline/overlay";
import { PriorityChips, ViewToggle } from "@/components/work/view-controls";
import { createTaskAction } from "@/app/work/actions";
import { getProject, listLabels, listProjectPeople, listProjectTasks, requireWorkUser } from "@/lib/work/data";
import {
  isWorkPriority,
  isWorkStatus,
  openStatuses,
  parseWorkView,
  planningParams,
  taskTypeFilterOptions,
  workStatuses,
} from "@/lib/work/labels";
import { linkableRecordTypes } from "@/lib/work/records";

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
  const view = parseWorkView(first(query.view));
  const planning = planningParams(first(query.type), first(query.label));
  const [tasks, people, labels] = await Promise.all([
    listProjectTasks(id, {
      status: isWorkStatus(status) ? status : undefined,
      priority: isWorkPriority(priority) ? priority : undefined,
      owner: owner && /^[0-9a-f-]{36}$/i.test(owner) ? owner : undefined,
      showDone,
      ...planning,
    }),
    listProjectPeople(id),
    listLabels({ projectId: id }),
  ]);

  const base = `/work/projects/${id}`;
  const withDone = (on: boolean) => {
    const q = new URLSearchParams();
    if (isWorkStatus(status)) q.set("status", status);
    if (isWorkPriority(priority)) q.set("priority", priority);
    if (owner) q.set("owner", owner);
    if (planning.taskType) q.set("type", planning.taskType);
    if (planning.label) q.set("label", planning.label);
    if (on) q.set("done", "1");
    if (view !== "list") q.set("view", view);
    const s = q.toString();
    return s ? `${base}?${s}` : base;
  };

  const open = tasks.filter((t) => openStatuses.includes(t.status));
  const done = tasks.filter((t) => t.status === "done");
  const cancelled = tasks.filter((t) => t.status === "cancelled");

  // Which tasks each list shows, so tasks made or changed on this device land right (offline sync).
  const statusFilter = isWorkStatus(status) ? status : undefined;
  const scope: TaskView = {
    projectId: id,
    priority: isWorkPriority(priority) ? priority : undefined,
    assignee: owner && /^[0-9a-f-]{36}$/i.test(owner) ? owner : undefined,
    taskType: planning.taskType,
    label: planning.label,
  };
  const only = (statuses: typeof openStatuses): TaskView => ({
    ...scope,
    statuses: statusFilter ? statuses.filter((s) => s === statusFilter) : statuses,
  });
  const allStatuses = showDone ? [...openStatuses, "done" as const, "cancelled" as const] : openStatuses;
  const noTasks = (
    <EmptyState
      icon={FolderOpen}
      title="No tasks here"
      description={project.archived ? "This project is archived." : "Create a task, or change the filters."}
    />
  );

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
                recordTypes={linkableRecordTypes(user)}
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

      {/* Tabs and filters each on their own row, so neither is squeezed. */}
      <div className="mb-5 flex flex-col gap-3">
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
            { name: "type", label: "Type", all: "Any type", options: taskTypeFilterOptions },
            ...(labels.length ? [{ name: "label", label: "Label", all: "Any label", options: labels.map((l) => ({ value: l, label: l })) }] : []),
          ]}
        />
      </div>
      <div className="mb-5 flex items-center justify-between gap-3">
        <PriorityChips basePath={base} />
        <ViewToggle basePath={base} view={view} />
      </div>

      {!project.archived && (
        <div className="mb-4">
          <QuickAddTask
            projects={[{ id, name: project.name, workspace: { id: project.workspace.id, name: project.workspace.name, slug: project.workspace.slug } }]}
            user={{ id: user.id, name: user.name, email: user.email }}
          />
        </div>
      )}

      {view !== "list" ? (
        <LiveTasks tasks={tasks} view={only(allStatuses)} layout={view} timeZone={user.timeZone} showContext={false} empty={noTasks} />
      ) : (
        <div className="space-y-4">
          <LiveTasks tasks={open} view={only(openStatuses)} layout="due" timeZone={user.timeZone} showContext={false} empty={tasks.length === 0 ? noTasks : null} />
          {showDone && (
            <>
              <LiveTasks tasks={done} view={only(["done"])} layout="group" title="Done" timeZone={user.timeZone} showContext={false} empty={null} />
              <LiveTasks tasks={cancelled} view={only(["cancelled"])} layout="group" title="Cancelled" timeZone={user.timeZone} showContext={false} empty={null} />
            </>
          )}
        </div>
      )}
    </>
  );
}
