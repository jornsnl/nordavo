import type { Metadata } from "next";
import { Suspense } from "react";
import { CheckCheck, ClipboardList, Sun } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/dashboard/empty-state";
import { ListSkeleton } from "@/components/ui/skeleton";
import { FilterBar, type FilterDef } from "@/components/work/filter-bar";
import { PageTabs } from "@/components/work/page-tabs";
import { LiveTasks } from "@/components/work/live-task-lists";
import { QuickAddTask } from "@/components/work/quick-add-task";
import { quickAddProjects } from "@/lib/work/quick-add";
import type { TaskView } from "@/lib/offline/overlay";
import { PriorityChips, ViewToggle } from "@/components/work/view-controls";
import {
  countReviews,
  getInboxProjectId,
  listLabels,
  listMyWorkspaces,
  listOverview,
  listProjects,
  requireWorkUser,
  type OverviewTab,
  type TaskFilters,
} from "@/lib/work/data";
import {
  isWorkPriority,
  isWorkStatus,
  openStatuses,
  parseWorkView,
  planningParams,
  taskTypeFilterOptions,
  workStatuses,
  type WorkView,
} from "@/lib/work/labels";
import { dayIn, localInputToUtc } from "@/lib/work/time";

export const metadata: Metadata = { title: "My overview" };

type Search = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

type Tab = OverviewTab;

function parse(params: Search): { tab: Tab; view: WorkView; filters: TaskFilters } {
  const tab = first(params.tab);
  const status = first(params.status);
  const priority = first(params.priority);
  const uuid = (v: string | undefined) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : undefined);
  return {
    tab: tab === "review" || tab === "today" ? tab : "mine",
    view: parseWorkView(first(params.view)),
    filters: {
      workspace: uuid(first(params.workspace)),
      project: uuid(first(params.project)),
      status: isWorkStatus(status) ? status : undefined,
      priority: isWorkPriority(priority) ? priority : undefined,
      ...planningParams(first(params.type), first(params.label)),
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
  // The inbox first, so a quick add without a choice lands there.
  const inboxProjectId = await getInboxProjectId();
  const [workspaces, reviewCount, tasks, labels] = await Promise.all([
    listMyWorkspaces(),
    countReviews(),
    listOverview(tab, filters),
    listLabels(filters.project ? { projectId: filters.project } : {}),
  ]);
  const projects = (await Promise.all(workspaces.map((w) => listProjects(w.id)))).flat();

  const keep = new URLSearchParams();
  for (const key of ["workspace", "project", "status", "priority"] as const) {
    const value = filters[key];
    if (value) keep.set(key, value);
  }
  if (filters.taskType) keep.set("type", filters.taskType);
  if (filters.label) keep.set("label", filters.label);
  if (view !== "list") keep.set("view", view);
  const hrefFor = (t: Tab) => {
    const q = new URLSearchParams(keep);
    if (t !== "mine") q.set("tab", t);
    const s = q.toString();
    return s ? `/work?${s}` : "/work";
  };

  // Which tasks this list shows, so tasks made or changed on this device land right (offline sync).
  const taskView: TaskView = {
    ...(tab === "review" ? { reviewer: user.id, statuses: ["review"] } : { assignee: user.id }),
    workspaceId: filters.workspace,
    projectId: filters.project,
    priority: filters.priority,
    taskType: filters.taskType,
    label: filters.label,
    ...(tab !== "review" ? { statuses: filters.status ? [filters.status] : openStatuses } : {}),
    ...(tab === "today"
      ? {
          statuses: (filters.status ? [filters.status] : openStatuses).filter((s) => s !== "review"),
          dueBefore: localInputToUtc(`${dayIn(new Date(), user.timeZone)}T23:59`, user.timeZone) ?? undefined,
        }
      : {}),
  };

  const filterDefs: FilterDef[] = [
    { name: "workspace", label: "Workspace", all: "All workspaces", options: workspaces.map((w) => ({ value: w.id, label: w.name })) },
    {
      name: "project",
      label: "Project",
      all: "All projects",
      searchable: true,
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
    { name: "type", label: "Type", all: "Any type", options: taskTypeFilterOptions },
    ...(labels.length ? [{ name: "label", label: "Label", all: "Any label", options: labels.map((l) => ({ value: l, label: l })) }] : []),
  ];

  return (
    <div className="space-y-5">
      {/* Tabs and filters each on their own row, so neither is squeezed. */}
      <div className="flex flex-col gap-3">
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
      <div className="flex items-center justify-between gap-3">
        <PriorityChips basePath="/work" />
        <ViewToggle basePath="/work" view={view} />
      </div>

      {tab === "mine" && (
        <QuickAddTask
          projects={quickAddProjects(projects, workspaces, inboxProjectId).filter((p) => !filters.project || p.id === filters.project)}
          user={{ id: user.id, name: user.name, email: user.email }}
          defaultProjectId={filters.project ?? inboxProjectId ?? undefined}
        />
      )}

      <LiveTasks
        tasks={tasks}
        view={taskView}
        layout={view !== "list" ? view : tab === "mine" ? "due" : tab === "review" ? "group" : "today"}
        title="Waiting for your review"
        description="Approve, or send back with a comment"
        timeZone={user.timeZone}
        empty={<Empty tab={tab} filtered={Object.values(filters).some(Boolean)} hasWorkspaces={workspaces.length > 0} />}
      />
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
