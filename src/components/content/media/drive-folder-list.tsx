"use client";

import { useRef } from "react";
import { FolderOpen, RefreshCw, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input } from "@/components/ui/field";
import { PendingSubmit } from "@/components/placements/form-utils";
import { addDriveFolderAction, removeDriveFolderAction, syncDriveFolderAction } from "@/app/content/actions/media";
import { formatDateTime } from "@/lib/format";
import { useContentButton, useContentForm } from "./use-content-action";

export type DriveFolderItem = {
  id: string;
  folderId: string;
  name: string | null;
  lastSyncedAt: string | null;
  lastResult: string | null;
};

export function DriveFolderList({
  workspaceId,
  folders,
  enabled,
}: {
  workspaceId: string | null;
  folders: DriveFolderItem[];
  enabled: boolean;
}) {
  const form = useRef<HTMLFormElement>(null);
  const { state, formAction, pending, errors } = useContentForm(addDriveFolderAction.bind(null, workspaceId), () => form.current?.reset());
  const button = useContentButton();

  return (
    <div className="space-y-4">
      {folders.length > 0 && (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {folders.map((folder) => (
            <li key={folder.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <FolderOpen className="size-5 shrink-0 text-brand-600" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <a
                  href={`https://drive.google.com/drive/folders/${folder.folderId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate text-sm font-medium text-brand-700 hover:underline"
                >
                  {folder.name ?? folder.folderId}
                </a>
                <p className="text-xs text-muted">
                  {folder.lastSyncedAt ? `Synced ${formatDateTime(folder.lastSyncedAt)}: ${folder.lastResult ?? ""}` : "Not synced yet"}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!enabled || button.pending}
                  onClick={() => button.run(() => syncDriveFolderAction(folder.id))}
                >
                  <RefreshCw className={button.pending ? "animate-spin" : ""} aria-hidden="true" />
                  Sync now
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={button.pending}
                  onClick={() => {
                    if (confirm("Unlink this folder? Files already imported stay in the library.")) {
                      button.run(() => removeDriveFolderAction(folder.id));
                    }
                  }}
                >
                  <Unlink aria-hidden="true" />
                  Unlink
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <form ref={form} action={formAction} className="flex flex-wrap items-end gap-3">
        <Field label="Folder link" htmlFor={`drive-folder-${workspaceId ?? "company"}`} error={errors.folder} className="min-w-64 flex-1">
          <Input
            id={`drive-folder-${workspaceId ?? "company"}`}
            name="folder"
            placeholder="https://drive.google.com/drive/folders/..."
            disabled={!enabled}
            required
          />
        </Field>
        <PendingSubmit pending={pending} pendingLabel="Linking" variant="secondary" disabled={!enabled}>
          Link folder
        </PendingSubmit>
      </form>
      {state.error && <FormMessage error={state.error} />}
    </div>
  );
}
