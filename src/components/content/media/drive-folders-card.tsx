import { Suspense } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ListSkeleton } from "@/components/ui/skeleton";
import { createClient } from "@/lib/supabase/server";
import { DRIVE_SETUP_HELP, driveServiceEmail, hasGoogleDrive } from "@/lib/content/drive";
import { DriveFolderList, type DriveFolderItem } from "./drive-folder-list";

/**
 * Google Drive folders of a media library, imported and kept in sync
 * (workspaceId null: the company library). For the workspace settings page
 * and the company library; only who may manage the library sees the buttons
 * work (the actions check again).
 */
export function DriveFoldersCard({ workspaceId }: { workspaceId: string | null }) {
  return (
    <Card>
      <CardHeader
        title="Google Drive folders"
        description="New photos, videos and PDFs in these folders and their subfolders are imported automatically by the sync job, or right away with Sync now."
      />
      <CardBody>
        <Suspense fallback={<ListSkeleton rows={2} />}>
          <Folders workspaceId={workspaceId} />
        </Suspense>
      </CardBody>
    </Card>
  );
}

async function Folders({ workspaceId }: { workspaceId: string | null }) {
  const supabase = await createClient();
  let query = supabase
    .from("content_drive_folders")
    .select("id, folder_id, name, last_synced_at, last_result")
    .order("created_at");
  query = workspaceId ? query.eq("workspace_id", workspaceId) : query.is("workspace_id", null);
  const { data } = await query;
  const folders: DriveFolderItem[] = (data ?? []).map((f) => ({
    id: f.id,
    folderId: f.folder_id,
    name: f.name,
    lastSyncedAt: f.last_synced_at,
    lastResult: f.last_result,
  }));
  const email = driveServiceEmail();
  return (
    <div className="space-y-4">
      {!hasGoogleDrive() ? (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">{DRIVE_SETUP_HELP}</p>
      ) : (
        email && (
          <p className="text-sm text-muted">
            Share a folder as viewer with <span className="font-mono text-xs text-ink select-all">{email}</span>, then paste its link.
          </p>
        )
      )}
      <DriveFolderList workspaceId={workspaceId} folders={folders} enabled={hasGoogleDrive()} />
    </div>
  );
}
