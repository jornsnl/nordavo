import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { ChevronRight, CornerDownRight, Undo2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ListSkeleton } from "@/components/ui/skeleton";
import { TaskForm } from "@/components/work/forms";
import { Markdown } from "@/components/work/markdown";
import {
  CommentForm,
  DescriptionEditor,
  FileRow,
  FileUpload,
  MoveTaskForm,
  StatusControl,
  TaskActionButtons,
  TaskFieldsForm,
} from "@/components/work/task-controls";
import { DueLabel, LabelChips, PriorityBadge, StatusBadge, TaskRow, TypeChip, priorityBorder } from "@/components/work/task-row";
import { RecordLinkForm } from "@/components/work/record-link-form";
import { PrimaryContactDetails, RecordChip } from "@/components/work/task-record";
import {
  addCommentAction,
  archiveTaskAction,
  createTaskAction,
  duplicateTaskAction,
  moveTaskAction,
  removeFileAction,
  restoreTaskAction,
  setStatusAction,
  updateTaskAction,
  uploadFileAction,
} from "@/app/work/actions";
import { setTaskRecordAction } from "@/app/work/record-actions";
import {
  getTask,
  listLabels,
  listMoveTargets,
  listProjectPeople,
  listProjects,
  requireWorkUser,
  type ActivityItem,
  type Person,
} from "@/lib/work/data";
import { formatEstimate, workOption, workPriorities, workStatuses, workTaskTypeLabel } from "@/lib/work/labels";
import { formatAgo, formatDateTimeIn, utcToLocalInput } from "@/lib/work/time";

export const metadata: Metadata = { title: "Task" };

export default function TaskPage({ params }: PageProps<"/work/tasks/[id]">) {
  return (
    <Suspense fallback={<ListSkeleton rows={8} />}>
      <TaskDetailView params={params} />
    </Suspense>
  );
}

function formatBytes(n: number | null) {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

async function TaskDetailView({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireWorkUser();
  const task = await getTask(id);
  const tz = user.timeZone;
  // From your inbox or a private workspace a task can move to any project you can open (sorting).
  const sortable = task.workspace.kind !== "shared";
  const [people, projects, labelSuggestions] = await Promise.all([
    listProjectPeople(task.project.id),
    sortable ? listMoveTargets() : task.workspace.role === "guest" ? Promise.resolve([]) : listProjects(task.workspace.id),
    listLabels({ projectId: task.project.id }),
  ]);
  const peopleOptions = people.map((p) => ({ id: p.id, name: p.name, role: p.role }));
  const archived = Boolean(task.archivedAt);

  return (
    <article className="space-y-5">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-sm text-muted">
        <Link href={`/work/w/${task.workspace.slug}`} className="hover:text-brand-700">
          {task.workspace.name}
        </Link>
        <ChevronRight className="size-3.5" aria-hidden="true" />
        <Link href={`/work/projects/${task.project.id}`} className="hover:text-brand-700">
          {task.project.name}
        </Link>
        {task.parent && (
          <>
            <ChevronRight className="size-3.5" aria-hidden="true" />
            <Link href={`/work/tasks/${task.parent.id}`} className="hover:text-brand-700">
              {task.parent.title}
            </Link>
          </>
        )}
      </nav>

      <header className={`space-y-3 pl-4 ${priorityBorder(task.priority)}`}>
        <h1 className="font-display text-2xl font-bold tracking-tight text-brand-900 sm:text-3xl">{task.title}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={task.status} />
          <PriorityBadge priority={task.priority} />
          <DueLabel dueAt={task.dueAt} timeZone={tz} done={task.status === "done"} />
          <TypeChip type={task.taskType} />
          {task.estimateMinutes && <span className="text-xs text-muted">Estimate {formatEstimate(task.estimateMinutes)}</span>}
          <LabelChips labels={task.labels} />
          {task.isLog && <Badge>Logged work</Badge>}
          {archived && <Badge tone="danger">In the trash</Badge>}
        </div>
      </header>

      {/* The record and its primary contact: only ever loaded for the team with that module (never for guests). */}
      {(task.record || (task.linkTypes.length > 0 && task.can.edit && !task.parent)) && (
        <Card>
          <CardHeader
            title="Linked record"
            description={task.record ? undefined : "Hang this task on a client, lead, vacancy, candidate or placement."}
          />
          <CardBody className="space-y-4">
            {task.record && (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <RecordChip record={task.record} className="text-sm" />
                {task.primaryContact && (
                  <div className="rounded-xl bg-surface px-3 py-2.5 sm:min-w-64">
                    <p className="mb-1.5 text-xs font-semibold tracking-wide text-muted uppercase">Primary contact</p>
                    <PrimaryContactDetails contact={task.primaryContact} />
                  </div>
                )}
              </div>
            )}
            {task.can.edit && task.linkTypes.length > 0 && (task.record ? task.linkTypes.includes(task.record.type) : !task.parent) && (
              <details className="group" open={!task.record}>
                <summary className="w-fit cursor-pointer list-none text-sm font-medium text-brand-700 group-open:mb-3 pointer-coarse:min-h-11">
                  {task.record ? "Change or remove the record" : "Link a record"}
                </summary>
                <RecordLinkForm
                  action={setTaskRecordAction.bind(null, task.id)}
                  initial={task.record ? { type: task.record.type, id: task.record.id, label: task.record.label ?? "Deleted record" } : null}
                  types={task.linkTypes}
                />
              </details>
            )}
          </CardBody>
        </Card>
      )}

      {archived ? (
        <Card>
          <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted">
              Archived {formatAgo(task.archivedAt!, tz)}. It is deleted for good 30 days after archiving.
            </p>
            <form
              action={async () => {
                "use server";
                await restoreTaskAction(task.id);
              }}
            >
              <button type="submit" className="inline-flex items-center gap-2 rounded-xl bg-brand-700 px-4 py-2 text-sm font-semibold text-white">
                <Undo2 className="size-4" aria-hidden="true" />
                Restore
              </button>
            </form>
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardBody className="space-y-2">
            <StatusControl
              action={setStatusAction.bind(null, task.id)}
              status={task.status}
              can={task.can}
              hasReviewer={Boolean(task.reviewer)}
            />
            <p className="text-xs text-muted">
              {task.status === "review"
                ? `Waiting for ${task.reviewer?.name ?? "the reviewer"} since ${formatAgo(task.reviewRequestedAt ?? task.createdAt, tz)}.`
                : `Reviewer: ${task.reviewer?.name ?? "nobody yet"}. Only the reviewer or an admin can mark it as done.`}
            </p>
          </CardBody>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-5">
          <Card>
            <CardHeader title="Description" />
            <CardBody>
              <DescriptionEditor
                action={updateTaskAction.bind(null, task.id)}
                title={task.title}
                description={task.description}
                editable={task.can.edit}
              />
            </CardBody>
          </Card>

          {!task.parent && (
            <Card>
              <CardHeader
                title="Subtasks"
                description={
                  task.subtasks.length
                    ? `${task.subtasks.filter((s) => s.status === "done").length} of ${task.subtasks.length} done`
                    : undefined
                }
              />
              {task.subtasks.length > 0 && (
                <ul className="divide-y divide-border border-b border-border">
                  {task.subtasks.map((sub) => (
                    <TaskRow key={sub.id} task={sub} timeZone={tz} showContext={false} />
                  ))}
                </ul>
              )}
              {task.can.addSubtask && (
                <details className="group px-4 py-3 sm:px-5">
                  <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-brand-700">
                    <CornerDownRight className="size-4" aria-hidden="true" />
                    Add a subtask
                  </summary>
                  <div className="pt-4">
                    <TaskForm
                      action={createTaskAction.bind(null, task.project.id)}
                      people={peopleOptions}
                      currentUserId={user.id}
                      parentId={task.id}
                      submitLabel="Add subtask"
                    />
                  </div>
                </details>
              )}
            </Card>
          )}

          <Card>
            <CardHeader title="Files" />
            <CardBody className="space-y-3">
              {task.attachments.length > 0 ? (
                <ul className="divide-y divide-border">
                  {task.attachments.map((file) => (
                    <FileRow
                      key={file.id}
                      id={file.id}
                      name={file.fileName}
                      meta={[formatBytes(file.sizeBytes), file.uploadedBy?.name, formatAgo(file.createdAt, tz)].filter(Boolean).join(" · ")}
                      remove={
                        task.can.edit && (file.uploadedBy?.id === user.id || task.workspace.role === "admin")
                          ? removeFileAction.bind(null, file.id, task.id)
                          : undefined
                      }
                    />
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">No files yet.</p>
              )}
              {task.can.edit && <FileUpload action={uploadFileAction.bind(null, task.id)} />}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Comments" description="Progress goes here. Mention someone with @." />
            <CardBody className="space-y-5">
              {task.comments.length === 0 && <p className="text-sm text-muted">No comments yet.</p>}
              <ol className="space-y-4">
                {task.comments.map((comment) => (
                  <li
                    key={comment.id}
                    className={comment.kind === "returned" ? "rounded-xl border border-amber-600/20 bg-amber-50 p-3" : ""}
                  >
                    <p className="mb-1 text-xs text-muted">
                      <span className="font-semibold text-ink">{comment.author?.name ?? "Someone"}</span>
                      {comment.kind === "returned" && " sent it back"} ·{" "}
                      <time dateTime={comment.createdAt} title={formatDateTimeIn(comment.createdAt, tz)}>
                        {formatAgo(comment.createdAt, tz)}
                      </time>
                    </p>
                    <Markdown text={comment.body} />
                  </li>
                ))}
              </ol>
              {task.can.edit && <CommentForm action={addCommentAction.bind(null, task.id)} people={peopleOptions.filter((p) => p.id !== user.id)} />}
            </CardBody>
          </Card>
        </div>

        <aside className="space-y-5">
          <Card>
            <CardHeader title="Details" />
            <CardBody>
              <TaskFieldsForm
                action={updateTaskAction.bind(null, task.id)}
                people={peopleOptions}
                priority={task.priority}
                dueLocal={utcToLocalInput(task.dueAt, tz)}
                reviewerId={task.reviewer?.id ?? null}
                assigneeIds={task.assignees.map((a) => a.id)}
                timeZone={tz}
                editable={task.can.edit}
                taskType={task.taskType}
                labels={task.labels}
                startOn={task.startOn}
                estimate={formatEstimate(task.estimateMinutes)}
                labelSuggestions={labelSuggestions}
              />
              <dl className="mt-5 space-y-2 border-t border-border pt-4 text-xs text-muted">
                <div className="flex justify-between gap-3">
                  <dt>Made by</dt>
                  <dd className="text-right text-ink">
                    {task.creator?.name ?? "Unknown"}, {formatDateTimeIn(task.createdAt, tz)}
                  </dd>
                </div>
                {task.completedAt && (
                  <div className="flex justify-between gap-3">
                    <dt>Done</dt>
                    <dd className="text-right text-ink">{formatDateTimeIn(task.completedAt, tz)}</dd>
                  </div>
                )}
              </dl>
            </CardBody>
          </Card>

          {task.can.edit && !task.parent && (projects.length > 1 || task.can.archive) && (
            <Card>
              <CardHeader title="More" />
              <CardBody className="space-y-4">
                {projects.length > 1 && (
                  <MoveTaskForm
                    action={moveTaskAction.bind(null, task.id)}
                    projects={projects.filter((p) => !p.archived).map((p) => ({ id: p.id, name: p.name }))}
                    currentProjectId={task.project.id}
                  />
                )}
                <TaskActionButtons
                  duplicate={duplicateTaskAction.bind(null, task.id)}
                  archive={task.can.archive ? archiveTaskAction.bind(null, task.id, task.project.id) : undefined}
                />
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader title="Activity" />
            <CardBody>
              <ol className="space-y-3">
                {task.activity.map((entry) => (
                  <li key={entry.id} className="text-xs">
                    <p className="text-ink">
                      <span className="font-semibold">{entry.actor?.name ?? "System"}</span> {describeActivity(entry, task.assignees, people, tz)}
                    </p>
                    <time className="text-muted" dateTime={entry.createdAt} title={formatDateTimeIn(entry.createdAt, tz)}>
                      {formatAgo(entry.createdAt, tz)}
                    </time>
                  </li>
                ))}
              </ol>
            </CardBody>
          </Card>
        </aside>
      </div>
    </article>
  );
}

function describeActivity(entry: ActivityItem, assignees: Person[], people: Person[], tz: string): string {
  const d = entry.details;
  const name = (id: unknown) =>
    typeof id === "string" ? ([...assignees, ...people].find((p) => p.id === id)?.name ?? "someone") : "nobody";
  switch (entry.action) {
    case "created":
      return "created the task";
    case "imported":
      return "imported the task from ClickUp";
    case "commented":
      return d.kind === "returned" ? "sent it back with a comment" : "commented";
    case "owner_added":
      return `added ${name(d.user_id)} as owner`;
    case "owner_removed":
      return `removed ${name(d.user_id)} as owner`;
    case "file_added":
      return `added ${String(d.file_name ?? "a file")}`;
    case "file_removed":
      return `removed ${String(d.file_name ?? "a file")}`;
    case "updated": {
      const parts: string[] = [];
      const change = (key: string) => d[key] as { from?: unknown; to?: unknown } | undefined;
      const status = change("status");
      if (status) parts.push(`moved it to ${workOption(workStatuses, status.to as never).label}`);
      const priority = change("priority");
      if (priority) parts.push(`set priority to ${workOption(workPriorities, priority.to as never).label}`);
      const due = change("due_at");
      if (due) parts.push(due.to ? `set the deadline to ${formatDateTimeIn(String(due.to), tz)}` : "removed the deadline");
      if (change("reviewer_id")) parts.push(`made ${name(change("reviewer_id")?.to)} reviewer`);
      const type = change("task_type");
      if (type) parts.push(type.to ? `set the type to ${workTaskTypeLabel(type.to as never) ?? String(type.to)}` : "removed the type");
      if (change("labels")) {
        const labels = (change("labels")?.to as string[] | null) ?? [];
        parts.push(labels.length ? `set the labels to ${labels.join(", ")}` : "removed the labels");
      }
      const start = change("start_on");
      if (start) parts.push(start.to ? `set the start date to ${String(start.to)}` : "removed the start date");
      const estimate = change("estimate_minutes");
      if (estimate) parts.push(estimate.to ? `estimated it at ${formatEstimate(Number(estimate.to))}` : "removed the estimate");
      if (change("title")) parts.push("renamed it");
      if (d.description) parts.push("edited the description");
      if (change("project_id")) parts.push("moved it to another project");
      if (d.record) parts.push("changed the linked record");
      const archived = change("archived_at");
      if (archived) parts.push(archived.to ? "archived it" : "restored it");
      return parts.join(", ") || "updated the task";
    }
    default:
      return entry.action.replace(/_/g, " ");
  }
}
