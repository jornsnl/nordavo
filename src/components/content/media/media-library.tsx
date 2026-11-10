import { ImageIcon } from "lucide-react";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { uploadMediaAction } from "@/app/content/actions/media";
import { listMedia } from "@/lib/content/media";
import type { MediaFilters } from "@/lib/content/media-utils";
import { dayKey, type FieldDef } from "@/lib/content/rules";
import { MediaFilterBar } from "./media-filters";
import { MediaGrid } from "./media-grid";
import { UploadForm } from "./upload-form";

/** A whole media library (a workspace, or the company library with workspaceId null). */
export async function MediaLibrary({
  workspaceId,
  filters,
  canEdit,
  fields,
  reuseMonths,
}: {
  workspaceId: string | null;
  filters: MediaFilters;
  canEdit: boolean;
  fields: FieldDef[];
  reuseMonths: number;
}) {
  const { items, facets, total } = await listMedia(workspaceId, filters);
  const filtered = Object.values(filters).some(Boolean);
  return (
    <div className="space-y-6">
      {canEdit && (
        <Card>
          <CardHeader title="Add files" description="Upload here, or link a Google Drive folder in Settings to import a whole photoshoot." />
          <CardBody>
            <UploadForm action={uploadMediaAction.bind(null, workspaceId)} folders={facets.folders} />
          </CardBody>
        </Card>
      )}
      <section>
        <MediaFilterBar filters={filters} facets={facets} />
        <p className="mb-3 text-sm text-muted">
          {filtered ? `${items.length} of ${total} files` : `${total} ${total === 1 ? "file" : "files"}`}
        </p>
        {items.length === 0 ? (
          <EmptyState
            icon={ImageIcon}
            title={filtered ? "No files match" : "No files yet"}
            description={filtered ? "Try another filter." : "Upload photos or link a Google Drive folder."}
          />
        ) : (
          <MediaGrid items={items} canEdit={canEdit} fields={fields} reuseMonths={reuseMonths} today={dayKey()} />
        )}
      </section>
    </div>
  );
}
