import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/dashboard/page-header";
import { ListSkeleton } from "@/components/ui/skeleton";
import { SourceList } from "@/components/content/sources/source-list";
import { activeOptions, getContentWorkspace, requireModule } from "@/lib/content/data";
import { listSources } from "@/lib/content/sources";

export const metadata: Metadata = { title: "Sources" };

export default function SourcesPage({ params, searchParams }: PageProps<"/content/w/[slug]/sources">) {
  return (
    <Suspense fallback={<ListSkeleton rows={5} />}>
      <Sources params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Sources({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const archived = (await searchParams).archived === "1";
  const workspace = await getContentWorkspace(slug);
  requireModule(workspace, "sources");
  const sources = await listSources(workspace.id, { includeArchived: archived });
  return (
    <>
      <PageHeader
        eyebrow={workspace.name}
        title="Sources"
        description="Reddit threads, X posts, news and own experience that ideas and posts build on."
        actions={
          <Link href={archived ? `/content/w/${slug}/sources` : `/content/w/${slug}/sources?archived=1`} className="text-sm font-medium text-brand-700 hover:underline">
            {archived ? "Hide archived" : "Show archived"}
          </Link>
        }
      />
      <SourceList
        workspaceId={workspace.id}
        slug={slug}
        sources={sources}
        platforms={activeOptions(workspace, "platform").map((o) => ({ value: o.value, label: o.label }))}
        statusLabels={Object.fromEntries(workspace.statuses.map((s) => [s.key, s.label]))}
        canEdit={workspace.canWrite}
        showIdeas={workspace.modules.ideas && workspace.role !== "reviewer"}
      />
    </>
  );
}
