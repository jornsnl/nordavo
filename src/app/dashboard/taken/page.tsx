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
  title: "Taken",
};

type Filters = {
  view: "lijst" | "bord";
  scope: "mine" | "all";
  priority?: TaskPriority;
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function parseFilters(params: Record<string, string | string[] | undefined>): Filters {
  const priority = first(params.priority);
  return {
    view: first(params.view) === "bord" ? "bord" : "lijst",
    scope: first(params.scope) === "all" ? "all" : "mine",
    priority: isTaskPriority(priority) ? priority : undefined,
  };
}

function hrefFor(filters: Filters, change: Partial<Filters>) {
  const next = { ...filters, ...change };
  const params = new URLSearchParams();
  if (next.view === "bord") params.set("view", "bord");
  if (next.scope === "all") params.set("scope", "all");
  if (next.priority) params.set("priority", next.priority);
  const query = params.toString();
  return query ? `/dashboard/taken?${query}` : "/dashboard/taken";
}

export default function TasksPage({ searchParams }: PageProps<"/dashboard/taken">) {
  return (
    <>
      <PageHeader
        eyebrow="Werk"
        title="Taken"
        description="Alles wat nog moet gebeuren, voor klanten, vacatures en kandidaten."
        actions={
          <Suspense
            fallback={
              <Button disabled>
                <Plus aria-hidden="true" />
                Nieuwe taak
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

async function TasksView({ searchParams }: { searchParams: PageProps<"/dashboard/taken">["searchParams"] }) {
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
          title={filters.priority || filters.scope === "mine" ? "Geen taken gevonden" : "Nog geen taken"}
          description={
            filters.scope === "mine"
              ? "Er staan geen taken op jouw naam met deze filters. Kijk bij alle taken of maak er een aan."
              : "Maak een taak aan om bij te houden wat er nog moet gebeuren."
          }
        />
      ) : filters.view === "bord" ? (
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

/** Te laat, Vandaag, Deze week (tot en met zondag), Later, Zonder datum. */
function groupByDue(tasks: TaskItem[], today: string): TaskGroup[] {
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 = zondag
  const endOfWeek = addDays(today, (7 - weekday) % 7);
  const rank = { high: 0, normal: 1, low: 2 } as const;
  const byDue = (a: TaskItem, b: TaskItem) =>
    (a.dueDate ?? "").localeCompare(b.dueDate ?? "") || rank[a.priority] - rank[b.priority];

  const groups: TaskGroup[] = [
    { key: "overdue", label: "Te laat", tone: "danger", tasks: [] },
    { key: "today", label: "Vandaag", tasks: [] },
    { key: "week", label: "Deze week", tasks: [] },
    { key: "later", label: "Later", tasks: [] },
    { key: "none", label: "Zonder datum", tasks: [] },
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
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          label="Wiens taken"
          options={[
            { label: "Mijn taken", href: hrefFor(filters, { scope: "mine" }), active: filters.scope === "mine" },
            { label: "Alle taken", href: hrefFor(filters, { scope: "all" }), active: filters.scope === "all" },
          ]}
        />
        <Segmented
          label="Prioriteit"
          options={[
            { label: "Alle", href: hrefFor(filters, { priority: undefined }), active: !filters.priority },
            ...[...taskPriorities].reverse().map((p) => ({
              label: p.label,
              href: hrefFor(filters, { priority: p.value }),
              active: filters.priority === p.value,
            })),
          ]}
        />
      </div>
      <Segmented
        label="Weergave"
        options={[
          {
            label: "Lijst",
            icon: <List className="size-4" aria-hidden="true" />,
            href: hrefFor(filters, { view: "lijst" }),
            active: filters.view === "lijst",
          },
          {
            label: "Bord",
            icon: <Columns3 className="size-4" aria-hidden="true" />,
            href: hrefFor(filters, { view: "bord" }),
            active: filters.view === "bord",
          },
        ]}
      />
    </div>
  );
}

function Segmented({
  label,
  options,
}: {
  label: string;
  options: { label: string; href: string; active: boolean; icon?: ReactNode }[];
}) {
  return (
    <nav aria-label={label} className="inline-flex w-fit max-w-full overflow-x-auto rounded-xl border border-border bg-white p-1 shadow-xs">
      {options.map((option) => (
        <Link
          key={option.label}
          href={option.href}
          scroll={false}
          aria-current={option.active ? "page" : undefined}
          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap transition focus-visible:outline-2 focus-visible:outline-brand-500 ${
            option.active ? "bg-brand-700 text-white" : "text-muted hover:bg-brand-50 hover:text-brand-900"
          }`}
        >
          {option.icon}
          {option.label}
        </Link>
      ))}
    </nav>
  );
}
