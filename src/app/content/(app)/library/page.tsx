import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/dashboard/page-header";
import { ListSkeleton } from "@/components/ui/skeleton";
import { MediaLibrary } from "@/components/content/media/media-library";
import { DriveFoldersCard } from "@/components/content/media/drive-folders-card";
import { requireContentUser } from "@/lib/content/data";
import { parseMediaFilters } from "@/lib/content/media-utils";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Company media library" };

export default function LibraryPage({ searchParams }: PageProps<"/content/library">) {
  return (
    <Suspense fallback={<ListSkeleton rows={6} />}>
      <Library searchParams={searchParams} />
    </Suspense>
  );
}

async function Library({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireContentUser();
  const supabase = await createClient();
  const [{ data: canView }, { data: canEdit }] = await Promise.all([
    supabase.rpc("content_has_any_role"),
    supabase.rpc("content_can_edit_media", { p_workspace: null }),
  ]);
  if (!canView) notFound();
  const filters = parseMediaFilters(await searchParams);
  return (
    <>
      <PageHeader
        eyebrow="Content"
        title="Company media library"
        description="Shared with every workspace, for example the Nordavo photoshoot. Authors and reviewers describe files; admins link Google Drive folders."
      />
      <MediaLibrary workspaceId={null} filters={filters} canEdit={canEdit === true} fields={[]} reuseMonths={6} />
      {user.isAdmin && (
        <div className="mt-6">
          <DriveFoldersCard workspaceId={null} />
        </div>
      )}
    </>
  );
}
