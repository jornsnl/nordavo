import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/dashboard/page-header";
import { ListSkeleton } from "@/components/ui/skeleton";
import { MediaLibrary } from "@/components/content/media/media-library";
import { getContentWorkspace, requireModule } from "@/lib/content/data";
import { parseMediaFilters } from "@/lib/content/media-utils";

export const metadata: Metadata = { title: "Media" };

export default function MediaPage({ params, searchParams }: PageProps<"/content/w/[slug]/media">) {
  return (
    <Suspense fallback={<ListSkeleton rows={6} />}>
      <Media params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Media({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const workspace = await getContentWorkspace(slug);
  requireModule(workspace, "media");
  const filters = parseMediaFilters(await searchParams);
  return (
    <>
      <PageHeader
        eyebrow={workspace.name}
        title="Media library"
        description={
          <>
            Photos, videos and documents of this workspace. The shared{" "}
            <Link href="/content/library" className="font-medium text-brand-700 hover:underline">
              company library
            </Link>{" "}
            is available to every workspace.
          </>
        }
      />
      <MediaLibrary
        workspaceId={workspace.id}
        filters={filters}
        canEdit={workspace.canWrite}
        fields={workspace.fields.media.filter((f) => !f.archived)}
        reuseMonths={workspace.mediaReuseMonths}
      />
    </>
  );
}
