import type { Metadata } from "next";
import { Suspense } from "react";
import { CheckCheck, ClipboardList, Sun } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/dashboard/empty-state";
import { ListSkeleton } from "@/components/ui/skeleton";
import { FilterBar, type FilterDef } from "@/components/work/filter-bar";
import { PageTabs } from "@/components/work/page-tabs";
import { TaskGroup } from "@/components/work/task-row";
import { PortalTaskGroup } from "@/components/work/portal-task-group";
import { isStaff } from "@/lib/auth";
import { listMyPortalTasks } from "@/lib/work/portal-tasks";
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
import { isWorkPriority, isWorkStatus, workPriorities, workStatuses } from "@/lib/work/labels";
import { dueState } from "@/lib/work/time";

export const metadata: Metadata = { title: "My overview" };

type Search = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

/** "portal" is the read only list of CRM tasks, for staff only. */
type Tab = OverviewTab | "portal";

function parse(params: Search): { tab: Tab; filters: TaskFilters } {
  const tab = first(params.tab);
  const status = first(params.status);
  const priority = first(params.priority);
  const uuid = (v: string | undefined) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : undefined);
  return {
    tab: tab === "review" || tab === "today" || tab === "portal" ? tab : "mine",
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
  const parsed = parse(params);
  const user = await requireWorkUser();
  const staff = isStaff(user);
  // Guests never get the portal tab; a hand typed ?tab=portal falls back to My tasks.
  const tab: Tab = parsed.tab === "portal" && !staff ? "mine" : parsed.tab;
  const filters = parsed.filters;
  const [workspaces, reviewCount, tasks, portalTasks] = await Promise.all([
    listMyWorkspaces(),
    countReviews(),
    tab === "portal" ? Promise.resolve([] as TaskListItem[]) : listOverview(tab, filters),
    staff ? listMyPortalTasks(user) : Promise.resolve([]),
  ]);
  const projects = (await Promise.all(workspaces.map((w) => listProjects(w.id)))).flat();

  const keep = new URLSearchParams();
  for (const key of ["workspace", "project", "status", "priority"] as const) {
    const value = filters[key];
    if (value) keep.set(key, value);
  }
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
    { name: "priority", label: "Priority", all: "Any priority", options: workPriorities.map((p) => ({ value: p.value, label: p.label })) },
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
            ...(staff
              ? [{ label: "Portal tasks", href: hrefFor("portal"), active: tab === "portal", count: portalTasks.length }]
              : []),
          ]}
        />
        {tab !== "portal" && <FilterBar filters={filterDefs} basePath="/work" />}
      </div>

      {tab === "portal" ? (
        <PortalTaskGroup tasks={portalTasks} />
      ) : tasks.length === 0 ? (
        <Empty tab={tab} filtered={Object.values(filters).some(Boolean)} hasWorkspaces={workspaces.length > 0} />
      ) : tab === "mine" ? (
        <GroupedByProject tasks={tasks} timeZone={user.timeZone} />
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

/** Mijn taken: grouped per workspace and project, each group sorted by deadline. */
function GroupedByProject({ tasks, timeZone }: { tasks: TaskListItem[]; timeZone: string }) {
  const groups = new Map<string, { title: string; tasks: TaskListItem[]; firstDue: string }>();
  for (const task of tasks) {
    const key = task.project.id;
    const group = groups.get(key) ?? { title: `${task.workspace.name} › ${task.project.name}`, tasks: [], firstDue: "~" };
    group.tasks.push(task);
    if (task.dueAt && task.dueAt < group.firstDue) group.firstDue = task.dueAt;
    groups.set(key, group);
  }
  const ordered = [...groups.values()].sort((a, b) => a.firstDue.localeCompare(b.firstDue) || a.title.localeCompare(b.title));
  return (
    <div className="space-y-4">
      {ordered.map((group) => (
        <TaskGroup key={group.title} title={group.title} tasks={group.tasks} timeZone={timeZone} showContext={false} />
      ))}
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
