import type { Metadata } from "next";
import { Suspense } from "react";
import { Search } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Input } from "@/components/ui/field";
import { ListSkeleton } from "@/components/ui/skeleton";
import { TaskGroup } from "@/components/work/task-row";
import { requireWorkUser, searchTasks } from "@/lib/work/data";

export const metadata: Metadata = { title: "Search" };

export default function SearchPage({ searchParams }: PageProps<"/work/search">) {
  return (
    <>
      <PageHeader eyebrow="Work" title="Search" description="Titles, descriptions and comments, within everything you can open." />
      <Suspense fallback={<ListSkeleton rows={4} />}>
        <Results searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Results({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = (await searchParams).q;
  const q = (Array.isArray(raw) ? raw[0] : raw)?.trim().slice(0, 100) ?? "";
  const user = await requireWorkUser();
  const tasks = q.length >= 2 ? await searchTasks(q) : [];

  return (
    <div className="space-y-5">
      <form action="/work/search" role="search" className="flex gap-2">
        <label htmlFor="q" className="sr-only">
          Search tasks
        </label>
        <Input id="q" name="q" type="search" defaultValue={q} placeholder="Search tasks" autoFocus enterKeyHint="search" />
      </form>
      {q.length < 2 ? (
        <EmptyState icon={Search} title="Search your tasks" description="Type at least 2 characters." />
      ) : tasks.length === 0 ? (
        <EmptyState icon={Search} title="Nothing found" description={`No tasks match "${q}".`} />
      ) : (
        <TaskGroup title={`Results for "${q}"`} tasks={tasks} timeZone={user.timeZone} />
      )}
    </div>
  );
}
