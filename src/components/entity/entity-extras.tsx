import type { EntityType } from "@/lib/database.types";
import { requireStaff } from "@/lib/auth";
import { listEntityActivity } from "@/lib/data/activity";
import { listAttachments } from "@/lib/data/attachments";
import { listNotes } from "@/lib/data/notes";
import { listStaff } from "@/lib/data/staff";
import { recordKey } from "@/lib/data/search";
import { MAX_UPLOAD_BYTES } from "@/lib/storage";
import { formatDateTime } from "@/lib/format";
import { listRecordTasks } from "@/lib/work/data";
import { openStatuses } from "@/lib/work/labels";
import { loadPrimaryContacts } from "@/lib/work/records";
import { safeTimeZone } from "@/lib/work/time";
import { Card } from "@/components/ui/card";
import { ActivityTimeline } from "./activity-timeline";
import { AttachmentRow, AttachmentUploader } from "./attachment-items";
import { ExtrasTabs } from "./extras-tabs";
import { formatBytes, timeAgo } from "./format";
import { NoteComposer, NoteItem } from "./note-items";
import { QuickTaskForm } from "./quick-task-form";
import { RecordTaskRows } from "./record-tasks";

export type EntityRef = { entityType: EntityType; entityId: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Tasks, notes, attachments and activity for one record, shown on every
 * detail page (client, lead, vacancy, candidate, placement). The tasks are
 * Work tasks linked to the record (project "Portal records" by default).
 *
 * Contract: an async Server Component. Render it inside a <Suspense>
 * boundary; it calls requireStaff() itself.
 */
export async function EntityExtras({ entityType, entityId }: EntityRef) {
  const user = await requireStaff();
  if (!UUID.test(entityId)) return null;

  const [tasks, notes, attachments, activity, staff, contacts] = await Promise.all([
    listRecordTasks(entityType, entityId),
    listNotes(entityType, entityId),
    listAttachments(entityType, entityId),
    listEntityActivity(entityType, entityId),
    listStaff(),
    loadPrimaryContacts(user, [{ type: entityType, id: entityId }]),
  ]);
  const now = new Date();
  const timeZone = safeTimeZone(user.timeZone);
  const openTasks = tasks.filter((t) => openStatuses.includes(t.status));

  return (
    <Card className="overflow-hidden">
      <h2 className="sr-only">Tasks, notes, attachments and activity</h2>
      <ExtrasTabs
        label="More information"
        tabs={[
          {
            key: "tasks",
            label: "Tasks",
            count: openTasks.length,
            content: (
              <div className="space-y-4">
                <RecordTaskRows
                  tasks={tasks}
                  timeZone={timeZone}
                  contact={contacts.get(recordKey(entityType, entityId)) ?? null}
                />
                <QuickTaskForm
                  entityType={entityType}
                  entityId={entityId}
                  staff={staff}
                  currentUserId={user.id}
                />
              </div>
            ),
          },
          {
            key: "notes",
            label: "Notes",
            count: notes.length,
            content: (
              <div className="space-y-4">
                <NoteComposer entityType={entityType} entityId={entityId} />
                {notes.length === 0 ? (
                  <p className="text-sm text-muted">No notes yet. Write down here what you discuss.</p>
                ) : (
                  <ul className="divide-y divide-border border-t border-border pt-3">
                    {notes.map((note) => (
                      <NoteItem
                        key={note.id}
                        note={{
                          id: note.id,
                          body: note.body,
                          authorName: note.authorName,
                          timeAgo: timeAgo(note.createdAt, now),
                          createdAtTitle: formatDateTime(note.createdAt),
                          edited: new Date(note.updatedAt).getTime() - new Date(note.createdAt).getTime() > 60_000,
                          isOwn: note.authorId === user.id,
                        }}
                      />
                    ))}
                  </ul>
                )}
              </div>
            ),
          },
          {
            key: "files",
            label: "Attachments",
            count: attachments.length,
            content: (
              <div className="space-y-4">
                <AttachmentUploader entityType={entityType} entityId={entityId} maxBytes={MAX_UPLOAD_BYTES} />
                {attachments.length === 0 ? (
                  <p className="text-sm text-muted">No files yet. Think of a CV, contract or job profile.</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {attachments.map((attachment) => (
                      <AttachmentRow
                        key={attachment.id}
                        attachment={{
                          id: attachment.id,
                          fileName: attachment.fileName,
                          size: formatBytes(attachment.sizeBytes),
                          uploaderName: attachment.uploaderName,
                          timeAgo: timeAgo(attachment.createdAt, now),
                        }}
                      />
                    ))}
                  </ul>
                )}
              </div>
            ),
          },
          {
            key: "activity",
            label: "Activity",
            content: <ActivityTimeline items={activity} entityType={entityType} entityId={entityId} now={now} />,
          },
        ]}
      />
    </Card>
  );
}
