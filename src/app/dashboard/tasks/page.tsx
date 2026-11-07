import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import { CheckSquare, Columns3, List, Plus } from "lucide-react";
import { requireStaff } from "@/lib/auth";
import type { TaskPriority } from "@/lib/database.types";
import { isTaskPriority, listStaff, listTasks, type TaskItem } from "@/lib/data/tasks";
import { todayIso } from "@/lib/format";
import { taskPriorities } from "@/lib/labels";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Button } from "@/components/ui/button";
import { ListSkeleton } from "@/components/ui/skeleton";
import { NewTaskButton } from "@/components/tasks/task-form";
import { TaskBoard } from "@/components/tasks/task-board";
import { TaskList, type TaskGroup } from "@/components/tasks/task-list";

export const metadata: Metadata = {
  title: "Tasks",
};

type Filters = {
  view: "list" | "board";
  scope: "mine" | "all";
  priority?: TaskPriority;
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function parseFilters(params: Record<string, string | string[] | undefined>): Filters {
  const priority = first(params.priority);
  const view = first(params.view);
  return {
    // "bord" is the old Dutch value, still accepted for saved links.
    view: view === "board" || view === "bord" ? "board" : "list",
    scope: first(params.scope) === "all" ? "all" : "mine",
    priority: isTaskPriority(priority) ? priority : undefined,
  };
}

function hrefFor(filters: Filters, change: Partial<Filters>) {
  const next = { ...filters, ...change };
  const params = new URLSearchParams();
  if (next.view === "board") params.set("view", "board");
  if (next.scope === "all") params.set("scope", "all");
  if (next.priority) params.set("priority", next.priority);
  const query = params.toString();
  return query ? `/dashboard/tasks?${query}` : "/dashboard/tasks";
}

export default function TasksPage({ searchParams }: PageProps<"/dashboard/tasks">) {
  return (
    <>
      <PageHeader
        eyebrow="Work"
        title="Tasks"
        description="Everything that still needs doing, for clients, vacancies and candidates."
        actions={
          <Suspense
            fallback={
              <Button disabled>
                <Plus aria-hidden="true" />
                New task
              </Button>
            }
          >
            <NewTaskAction />
          </Suspense>
        }
      />
      <Suspense fallback={<ListSkeleton rows={6} />}>
        <TasksView searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function NewTaskAction() {
  const user = await requireStaff();
  const staff = await listStaff();
  return <NewTaskButton staff={staff} currentUserId={user.id} />;
}

async function TasksView({ searchParams }: { searchParams: PageProps<"/dashboard/tasks">["searchParams"] }) {
  const user = await requireStaff();
  const filters = parseFilters(await searchParams);
  const [tasks, staff] = await Promise.all([
    listTasks({
      assigneeId: filters.scope === "mine" ? user.id : undefined,
      priority: filters.priority,
    }),
    listStaff(),
  ]);
  const today = todayIso();

  return (
    <div className="space-y-6">
      <FilterBar filters={filters} />

      {tasks.length === 0 ? (
        <EmptyState
          icon={CheckSquare}
          title={filters.priority || filters.scope === "mine" ? "No tasks found" : "No tasks yet"}
          description={
            filters.scope === "mine"
              ? "No tasks assigned to you match these filters. Look at all tasks or create one."
              : "Create a task to keep track of what still needs doing."
          }
        />
      ) : filters.view === "board" ? (
        <TaskBoard tasks={tasks} staff={staff} currentUserId={user.id} today={today} />
      ) : (
        <TaskList
          groups={groupByDue(tasks.filter((t) => t.status !== "done"), today)}
          done={tasks.filter((t) => t.status === "done")}
          staff={staff}
          currentUserId={user.id}
          today={today}
        />
      )}
    </div>
  );
}

function addDays(iso: string, days: number) {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Overdue, Today, This week (up to and including Sunday), Later, No date. */
function groupByDue(tasks: TaskItem[], today: string): TaskGroup[] {
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  const endOfWeek = addDays(today, (7 - weekday) % 7);
  const rank = { high: 0, normal: 1, low: 2 } as const;
  const byDue = (a: TaskItem, b: TaskItem) =>
    (a.dueDate ?? "").localeCompare(b.dueDate ?? "") || rank[a.priority] - rank[b.priority];

  const groups: TaskGroup[] = [
    { key: "overdue", label: "Overdue", tone: "danger", tasks: [] },
    { key: "today", label: "Today", tasks: [] },
    { key: "week", label: "This week", tasks: [] },
    { key: "later", label: "Later", tasks: [] },
    { key: "none", label: "No date", tasks: [] },
  ];
  const [overdue, todayGroup, week, later, none] = groups;

  for (const task of tasks) {
    const due = task.dueDate;
    if (!due) none.tasks.push(task);
    else if (due < today) overdue.tasks.push(task);
    else if (due === today) todayGroup.tasks.push(task);
    else if (due <= endOfWeek) week.tasks.push(task);
    else later.tasks.push(task);
  }
  for (const group of groups) group.tasks.sort(byDue);
  return groups.filter((g) => g.tasks.length > 0);
}

function FilterBar({ filters }: { filters: Filters }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
      {/* On phones the filters form one strip that scrolls sideways. */}
      <div className="-mx-4 flex scrollbar-none items-center gap-3 overflow-x-auto overscroll-x-contain px-4 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
        <Segmented
          label="Whose tasks"
          options={[
            { label: "My tasks", href: hrefFor(filters, { scope: "mine" }), active: filters.scope === "mine" },
            { label: "All tasks", href: hrefFor(filters, { scope: "all" }), active: filters.scope === "all" },
          ]}
        />
        <Segmented
          label="Priority"
          options={[
            { label: "All", href: hrefFor(filters, { priority: undefined }), active: !filters.priority },
            ...[...taskPriorities].reverse().map((p) => ({
              label: p.label,
              href: hrefFor(filters, { priority: p.value }),
              active: filters.priority === p.value,
            })),
          ]}
        />
      </div>
      <Segmented
        label="View"
        className="max-sm:w-full max-sm:*:flex-1 max-sm:*:justify-center"
        options={[
          {
            label: "List",
            icon: <List className="size-4" aria-hidden="true" />,
            href: hrefFor(filters, { view: "list" }),
            active: filters.view === "list",
          },
          {
            label: "Board",
            icon: <Columns3 className="size-4" aria-hidden="true" />,
            href: hrefFor(filters, { view: "board" }),
            active: filters.view === "board",
          },
        ]}
      />
    </div>
  );
}

function Segmented({
  label,
  options,
  className = "",
}: {
  label: string;
  options: { label: string; href: string; active: boolean; icon?: ReactNode }[];
  className?: string;
}) {
  return (
    <nav
      aria-label={label}
      className={`relative inline-flex w-fit max-w-full shrink-0 overflow-x-auto rounded-xl border border-border bg-white p-1 shadow-xs ${className}`}
    >
      {options.map((option) => (
        <Link
          key={option.label}
          href={option.href}
          scroll={false}
          aria-current={option.active ? "page" : undefined}
          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap transition pointer-coarse:min-h-9 focus-visible:outline-2 focus-visible:outline-brand-500 ${
            option.active ? "bg-brand-700 text-white" : "text-muted hover:bg-brand-50 hover:text-brand-900 active:bg-brand-50"
          }`}
        >
          {option.icon}
          {option.label}
        </Link>
      ))}
    </nav>
  );
}
