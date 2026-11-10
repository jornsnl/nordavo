import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/dashboard/page-header";
import { ListSkeleton } from "@/components/ui/skeleton";
import { SeriesList } from "@/components/content/sources/series-list";
import { getContentWorkspace, requireModule } from "@/lib/content/data";
import { listSeries } from "@/lib/content/sources";

export const metadata: Metadata = { title: "Series" };

export default function SeriesPage({ params, searchParams }: PageProps<"/content/w/[slug]/series">) {
  return (
    <Suspense fallback={<ListSkeleton rows={4} />}>
      <Series params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Series({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const archived = (await searchParams).archived === "1";
  const workspace = await getContentWorkspace(slug);
  requireModule(workspace, "series");
  const series = await listSeries(workspace.id, { includeArchived: archived });
  return (
    <>
      <PageHeader
        eyebrow={workspace.name}
        title="Series"
        description="Groups of posts, with how many are live against the plan."
        actions={
          <Link href={archived ? `/content/w/${slug}/series` : `/content/w/${slug}/series?archived=1`} className="text-sm font-medium text-brand-700 hover:underline">
            {archived ? "Hide archived" : "Show archived"}
          </Link>
        }
      />
      <SeriesList
        workspaceId={workspace.id}
        slug={slug}
        series={series}
        statusLabels={Object.fromEntries(workspace.statuses.map((s) => [s.key, s.label]))}
        canEdit={workspace.canManage}
      />
    </>
  );
}
