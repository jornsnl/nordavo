import type { EntityType } from "@/lib/database.types";
import { requireStaff } from "@/lib/auth";
import { listEntityActivity } from "@/lib/data/activity";
import { listAttachments } from "@/lib/data/attachments";
import { listNotes } from "@/lib/data/notes";
import { listStaff, listTasksForEntity } from "@/lib/data/tasks";
import { MAX_UPLOAD_BYTES } from "@/lib/storage";
import { formatDateTime, todayIso } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { TaskCheckbox } from "@/components/tasks/task-checkbox";
import { AssigneeLabel, DueLabel, PriorityBadge } from "@/components/tasks/task-meta";
import { ActivityTimeline } from "./activity-timeline";
import { AttachmentRow, AttachmentUploader } from "./attachment-items";
import { ExtrasTabs } from "./extras-tabs";
import { formatBytes, timeAgo } from "./format";
import { NoteComposer, NoteItem } from "./note-items";
import { QuickTaskForm } from "./quick-task-form";

export type EntityRef = { entityType: EntityType; entityId: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Tasks, notes, attachments and activity for one record, shown on every
 * detail page (client, vacancy, candidate, placement).
 *
 * Contract: an async Server Component. Render it inside a <Suspense>
 * boundary; it calls requireStaff() itself.
 */
export async function EntityExtras({ entityType, entityId }: EntityRef) {
  const user = await requireStaff();
  if (!UUID.test(entityId)) return null;

  const [tasks, notes, attachments, activity, staff] = await Promise.all([
    listTasksForEntity(entityType, entityId),
    listNotes(entityType, entityId),
    listAttachments(entityType, entityId),
    listEntityActivity(entityType, entityId),
    listStaff(),
  ]);
  const now = new Date();
  const today = todayIso();
  const openTasks = tasks.filter((t) => t.status !== "done");
  const doneTasks = tasks.filter((t) => t.status === "done");

  return (
    <Card className="overflow-hidden">
      <h2 className="sr-only">Taken, notities, bijlagen en activiteit</h2>
      <ExtrasTabs
        label="Extra informatie"
        tabs={[
          {
            key: "tasks",
            label: "Taken",
            count: openTasks.length,
            content: (
              <div className="space-y-4">
                {tasks.length === 0 ? (
                  <p className="text-sm text-muted">Nog geen taken voor dit record.</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {[...openTasks, ...doneTasks].map((task) => {
                      const done = task.status === "done";
                      return (
                        <li key={task.id} className="flex items-start gap-2.5 py-2.5 first:pt-0">
                          <TaskCheckbox taskId={task.id} title={task.title} done={done} />
                          <div className="min-w-0 flex-1">
                            <p
                              className={`text-sm break-words ${
                                done ? "text-muted line-through" : "font-medium text-ink"
                              }`}
                            >
                              {task.title}
                            </p>
                            {!done && (
                              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                                <DueLabel dueDate={task.dueDate} today={today} />
                                <PriorityBadge priority={task.priority} />
                                <AssigneeLabel name={task.assigneeName} />
                              </div>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
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
            label: "Notities",
            count: notes.length,
            content: (
              <div className="space-y-4">
                <NoteComposer entityType={entityType} entityId={entityId} />
                {notes.length === 0 ? (
                  <p className="text-sm text-muted">Nog geen notities. Leg hier vast wat je bespreekt.</p>
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
            label: "Bijlagen",
            count: attachments.length,
            content: (
              <div className="space-y-4">
                <AttachmentUploader entityType={entityType} entityId={entityId} maxBytes={MAX_UPLOAD_BYTES} />
                {attachments.length === 0 ? (
                  <p className="text-sm text-muted">Nog geen bestanden. Denk aan een cv, contract of functieprofiel.</p>
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
            label: "Activiteit",
            content: <ActivityTimeline items={activity} entityType={entityType} entityId={entityId} now={now} />,
          },
        ]}
      />
    </Card>
  );
}
