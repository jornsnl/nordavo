import type { Metadata } from "next";
import { Suspense } from "react";
import { CheckCheck, ClipboardList, Sun } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/dashboard/empty-state";
import { ListSkeleton } from "@/components/ui/skeleton";
import { FilterBar, type FilterDef } from "@/components/work/filter-bar";
import { PageTabs } from "@/components/work/page-tabs";
import { DueGroups, TaskGroup } from "@/components/work/task-row";
import { TaskBoard } from "@/components/work/task-board";
import { PriorityChips, ViewToggle } from "@/components/work/view-controls";
import {
  countReviews,
  listMyWorkspaces,
  listOverview,
  listProjects,
  requireWorkUser,
  type OverviewTab,
  type TaskFilters,
  type TaskListItem,
} from "@/lib/work/data";
import { isWorkPriority, isWorkStatus, workStatuses } from "@/lib/work/labels";
import { dueState } from "@/lib/work/time";

export const metadata: Metadata = { title: "My overview" };

type Search = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

type Tab = OverviewTab;

function parse(params: Search): { tab: Tab; view: "list" | "board"; filters: TaskFilters } {
  const tab = first(params.tab);
  const status = first(params.status);
  const priority = first(params.priority);
  const uuid = (v: string | undefined) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : undefined);
  return {
    tab: tab === "review" || tab === "today" ? tab : "mine",
    view: first(params.view) === "board" ? "board" : "list",
    filters: {
      workspace: uuid(first(params.workspace)),
      project: uuid(first(params.project)),
      status: isWorkStatus(status) ? status : undefined,
      priority: isWorkPriority(priority) ? priority : undefined,
    },
  };
}

export default function OverviewPage({ searchParams }: PageProps<"/work">) {
  return (
    <>
      <PageHeader
        eyebrow="Work"
        title="My overview"
        description="Everything on your plate, across every workspace and project you are in."
      />
      <Suspense fallback={<ListSkeleton rows={6} />}>
        <Overview searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Overview({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams;
  const { tab, view, filters } = parse(params);
  const user = await requireWorkUser();
  const [workspaces, reviewCount, tasks] = await Promise.all([listMyWorkspaces(), countReviews(), listOverview(tab, filters)]);
  const projects = (await Promise.all(workspaces.map((w) => listProjects(w.id)))).flat();

  const keep = new URLSearchParams();
  for (const key of ["workspace", "project", "status", "priority"] as const) {
    const value = filters[key];
    if (value) keep.set(key, value);
  }
  if (view === "board") keep.set("view", "board");
  const hrefFor = (t: Tab) => {
    const q = new URLSearchParams(keep);
    if (t !== "mine") q.set("tab", t);
    const s = q.toString();
    return s ? `/work?${s}` : "/work";
  };

  const filterDefs: FilterDef[] = [
    { name: "workspace", label: "Workspace", all: "All workspaces", options: workspaces.map((w) => ({ value: w.id, label: w.name })) },
    {
      name: "project",
      label: "Project",
      all: "All projects",
      options: projects
        .filter((p) => !filters.workspace || p.workspaceId === filters.workspace)
        .map((p) => ({
          value: p.id,
          label: filters.workspace || workspaces.length === 1 ? p.name : `${workspaces.find((w) => w.id === p.workspaceId)?.name} › ${p.name}`,
        })),
    },
    ...(tab === "review"
      ? []
      : [{ name: "status", label: "Status", all: "Open statuses", options: workStatuses.map((s) => ({ value: s.value, label: s.label })) }]),
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <PageTabs
          label="Overview"
          tabs={[
            { label: "My tasks", href: hrefFor("mine"), active: tab === "mine" },
            { label: "To review", href: hrefFor("review"), active: tab === "review", count: reviewCount },
            { label: "Today and overdue", href: hrefFor("today"), active: tab === "today" },
          ]}
        />
        <FilterBar filters={filterDefs} basePath="/work" />
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <PriorityChips basePath="/work" />
        <ViewToggle basePath="/work" view={view} />
      </div>

      {tasks.length === 0 ? (
        <Empty tab={tab} filtered={Object.values(filters).some(Boolean)} hasWorkspaces={workspaces.length > 0} />
      ) : view === "board" ? (
        <TaskBoard tasks={tasks} timeZone={user.timeZone} />
      ) : tab === "mine" ? (
        <DueGroups tasks={tasks} timeZone={user.timeZone} />
      ) : tab === "review" ? (
        <TaskGroup
          title="Waiting for your review"
          description="Approve, or send back with a comment"
          tasks={tasks}
          timeZone={user.timeZone}
        />
      ) : (
        <TodayGroups tasks={tasks} timeZone={user.timeZone} />
      )}
    </div>
  );
}

function TodayGroups({ tasks, timeZone }: { tasks: TaskListItem[]; timeZone: string }) {
  const overdue = tasks.filter((t) => dueState(t.dueAt, timeZone) === "overdue");
  const today = tasks.filter((t) => dueState(t.dueAt, timeZone) !== "overdue");
  return (
    <div className="space-y-4">
      {overdue.length > 0 && <TaskGroup title="Overdue" tone="danger" tasks={overdue} timeZone={timeZone} />}
      {today.length > 0 && <TaskGroup title="Due today" tasks={today} timeZone={timeZone} />}
    </div>
  );
}

function Empty({ tab, filtered, hasWorkspaces }: { tab: OverviewTab; filtered: boolean; hasWorkspaces: boolean }) {
  if (!hasWorkspaces) {
    return (
      <EmptyState
        icon={ClipboardList}
        title="No workspace yet"
        description="You will see your tasks here once someone invites you to a workspace or project."
      />
    );
  }
  if (tab === "review") {
    return <EmptyState icon={CheckCheck} title="Nothing to review" description="Tasks someone sends to review with you as reviewer show up here." />;
  }
  if (tab === "today") {
    return <EmptyState icon={Sun} title="Nothing due today" description="No open tasks of yours are due today or overdue." />;
  }
  return (
    <EmptyState
      icon={ClipboardList}
      title={filtered ? "No tasks match these filters" : "No open tasks"}
      description={filtered ? "Change or clear the filters to see more." : "Tasks you own show up here, sorted by deadline."}
    />
  );
}
