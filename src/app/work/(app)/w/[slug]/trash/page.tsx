import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { ArrowLeft, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Card } from "@/components/ui/card";
import { ListSkeleton } from "@/components/ui/skeleton";
import { RestoreButton } from "@/components/work/restore-button";
import { restoreTaskAction } from "@/app/work/actions";
import { getWorkspace, listTrash, requireWorkUser } from "@/lib/work/data";
import { formatDateIn } from "@/lib/work/time";

export const metadata: Metadata = { title: "Trash" };

export default function TrashPage({ params }: PageProps<"/work/w/[slug]/trash">) {
  return (
    <Suspense fallback={<ListSkeleton rows={5} />}>
      <Trash params={params} />
    </Suspense>
  );
}

async function Trash({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await requireWorkUser();
  const workspace = await getWorkspace(slug);
  const tasks = await listTrash(workspace.id);

  return (
    <>
      <Link href={`/work/w/${slug}`} className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-brand-700">
        <ArrowLeft className="size-4" aria-hidden="true" />
        {workspace.name}
      </Link>
      <PageHeader
        eyebrow={workspace.name}
        title="Trash"
        description="Archived tasks stay here for 30 days, then they and their files are deleted for good."
      />
      {tasks.length === 0 ? (
        <EmptyState icon={Trash2} title="The trash is empty" description="Archived tasks show up here." />
      ) : (
        <Card>
          <ul className="divide-y divide-border">
            {tasks.map((task) => {
              const purgeOn = new Date(new Date(task.archivedAt).getTime() + 30 * 86_400_000).toISOString();
              return (
                <li key={task.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:px-5">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-muted">{task.project.name}</p>
                    <Link href={`/work/tasks/${task.id}`} className="font-medium text-ink hover:text-brand-700">
                      {task.title}
                    </Link>
                    <p className="text-xs text-muted">
                      Archived {formatDateIn(task.archivedAt, user.timeZone)}, deleted on {formatDateIn(purgeOn, user.timeZone)}
                    </p>
                  </div>
                  <RestoreButton run={restoreTaskAction.bind(null, task.id)} />
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </>
  );
}
