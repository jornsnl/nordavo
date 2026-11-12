import { Suspense } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ListSkeleton } from "@/components/ui/skeleton";
import { createClient } from "@/lib/supabase/server";
import { DRIVE_SETUP_HELP } from "@/lib/content/drive";
import { serviceAccountStatus } from "@/lib/integrations/google-sheets";
import { DriveConnectionTest } from "./drive-connection-test";
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
  const status = serviceAccountStatus();
  return (
    <div className="space-y-4">
      <DriveKeyStatus status={status} />
      <DriveFolderList workspaceId={workspaceId} folders={folders} enabled={status.ok} />
    </div>
  );
}

/** Whether the service account key is set and readable, and which address to share folders with. */
function DriveKeyStatus({ status }: { status: ReturnType<typeof serviceAccountStatus> }) {
  if (!status.configured) {
    return (
      <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
        <p className="font-medium">Service account key: not configured</p>
        <p className="mt-1">{DRIVE_SETUP_HELP} An admin sets it at the hosting provider and as a GitHub Actions secret (docs/content.md).</p>
      </div>
    );
  }
  if (!status.ok) {
    return (
      <div className="rounded-xl bg-danger-bg px-4 py-3 text-sm text-danger">
        <p className="font-medium">Service account key: set, but not readable</p>
        <p className="mt-1">{status.error}</p>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border px-4 py-3">
      <div className="min-w-0 text-sm">
        <p className="font-medium text-ink">
          Service account key: configured{status.format === "base64" ? " (base64)" : ""}
          {status.projectId && <span className="font-normal text-muted"> · project {status.projectId}</span>}
        </p>
        <p className="mt-1 text-muted">
          Share a folder as viewer with <span className="font-mono text-xs break-all text-ink select-all">{status.email}</span>, then paste its link.
        </p>
      </div>
      <DriveConnectionTest />
    </div>
  );
}
