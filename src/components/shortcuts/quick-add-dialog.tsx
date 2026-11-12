"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { usePathname } from "next/navigation";
import { LoaderCircle, Plus } from "lucide-react";
import { quickAddContextAction, quickAddPeopleAction, type QuickAddContext } from "@/app/work/quick-add-actions";
import { submitTaskOp } from "@/lib/offline/sync";
import type { TaskListItem } from "@/lib/work/data";
import { localInputToUtc } from "@/lib/work/time";
import { projectFromPath } from "@/lib/shortcuts";
import { toast } from "@/components/ui/toaster";

type Person = { id: string; name: string; email: string | null };

let cachedContext: QuickAddContext | null = null;
const peopleCache = new Map<string, Person[]>();

/**
 * Quick add, like Todoist (feedback Julius): "q" from any screen opens this
 * small window. Type a title and press Enter: saved and closed. Date,
 * project and owner are optional; Esc closes without saving. It goes
 * through the offline outbox like the other quick adds, so it also works
 * without a connection.
 */
export function QuickAddDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const id = useId();
  const pathname = usePathname();
  const dialog = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const [context, setContext] = useState<QuickAddContext | null>(cachedContext);
  const [failed, setFailed] = useState(false);
  // What you picked this time; null is the default (this page's project or the inbox, and you as owner).
  const [chosenProject, setChosenProject] = useState<string | null>(null);
  const [chosenOwner, setChosenOwner] = useState<string | null>(null);
  const [peopleByProject, setPeopleByProject] = useState<Record<string, Person[]>>({});

  const close = () => {
    setChosenProject(null);
    setChosenOwner(null);
    onClose();
  };

  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (open && !node.open) {
      node.showModal();
      titleRef.current?.focus();
    }
    if (!open && node.open) node.close();
  }, [open]);

  // Load the projects once, the first time the window opens.
  useEffect(() => {
    if (!open || context) return;
    let live = true;
    quickAddContextAction()
      .then((next) => {
        cachedContext = next;
        if (live) setContext(next);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [open, context]);

  const here = projectFromPath(pathname);
  const defaultProject = context
    ? (here && context.projects.find((p) => p.id === here)?.id) ||
      (context.inboxProjectId && context.projects.find((p) => p.id === context.inboxProjectId)?.id) ||
      context.projects[0]?.id ||
      ""
    : "";
  const projectId = chosenProject ?? defaultProject;
  const ownerId = chosenOwner ?? context?.user.id ?? "";
  const people = peopleByProject[projectId] ?? peopleCache.get(projectId) ?? [];

  useEffect(() => {
    if (!open || !projectId || peopleCache.has(projectId)) return;
    let live = true;
    quickAddPeopleAction(projectId)
      .then((list) => {
        peopleCache.set(projectId, list);
        if (live) setPeopleByProject((current) => ({ ...current, [projectId]: list }));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [open, projectId]);

  const me = context?.user;
  const owners: Person[] = me ? [{ id: me.id, name: `${me.name} (you)`, email: me.email }, ...people.filter((p) => p.id !== me.id)] : people;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!context || !me) return;
    const form = event.currentTarget;
    const title = titleRef.current?.value.trim() ?? "";
    const project = context.projects.find((p) => p.id === projectId);
    if (!title || !project) {
      titleRef.current?.focus();
      return;
    }
    const day = (form.elements.namedItem("due_date") as HTMLInputElement | null)?.value ?? "";
    // A day means the end of the working day, 17:00 in your time zone (as on the record pages).
    const dueAt = day ? localInputToUtc(`${day}T17:00`, me.timeZone) : null;
    const owner = owners.find((p) => p.id === ownerId);
    const taskId = crypto.randomUUID();
    const now = new Date().toISOString();
    const record: TaskListItem = {
      id: taskId,
      title,
      status: "todo",
      priority: "normal",
      dueAt,
      parentId: null,
      parentTitle: null,
      isLog: false,
      reviewerId: me.id,
      createdBy: me.id,
      updatedAt: now,
      completedAt: null,
      taskType: null,
      labels: [],
      startOn: null,
      estimateMinutes: null,
      project: { id: project.id, name: project.name },
      workspace: project.workspace,
      assignees: owner ? [{ id: owner.id, name: owner.id === me.id ? me.name : owner.name, email: owner.email }] : [],
      subtasks: { total: 0, done: 0 },
      record: null,
    };
    close();
    form.reset();
    try {
      await submitTaskOp({
        op: "task.create",
        payload: { id: taskId, project_id: project.id, title, assignees: owner ? [owner.id] : [], status: "todo", priority: "normal", due_at: dueAt },
        record,
      });
      toast(navigator.onLine ? `Added "${title}" to ${project.name}.` : `Added "${title}" on this device. It is sent when you are back online.`);
    } catch {
      toast("This task could not be saved on this device.", { tone: "error" });
    }
  }

  return (
    <dialog
      ref={dialog}
      aria-labelledby={`${id}-title`}
      onClose={close}
      onClick={(event) => {
        if (event.target === dialog.current) close();
      }}
      className="sheet-up mx-auto mt-[12dvh] mb-auto w-[calc(100%-1.5rem)] max-w-lg rounded-2xl border border-border bg-card p-0 text-ink shadow-2xl backdrop:bg-brand-950/50"
    >
      {open && (
        <form onSubmit={save} className="space-y-3 p-4" noValidate>
          <h2 id={`${id}-title`} className="flex items-center justify-between font-display text-sm font-semibold text-brand-900">
            Quick add
            <span className="text-xs font-normal text-muted pointer-coarse:hidden">Enter saves, Esc closes</span>
          </h2>
          <label htmlFor={`${id}-input`} className="sr-only">
            Task title
          </label>
          <input
            ref={titleRef}
            id={`${id}-input`}
            name="title"
            required
            maxLength={300}
            autoComplete="off"
            enterKeyHint="done"
            placeholder="What needs to happen?"
            className="block w-full rounded-xl border border-border bg-white px-3.5 py-3 text-base text-ink outline-none placeholder:text-muted/60 focus:border-brand-500 focus:ring-4 focus:ring-brand-100"
          />
          {failed ? (
            <p role="alert" className="text-sm text-danger">
              Your projects could not be loaded. Check your connection and press q again.
            </p>
          ) : !context ? (
            <p className="flex items-center gap-2 text-sm text-muted">
              <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
              Loading your projects
            </p>
          ) : context.projects.length === 0 ? (
            <p className="text-sm text-muted">You have no project to add tasks to yet.</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-3">
              <label className="min-w-0 text-xs font-medium text-muted">
                Project
                <select
                  name="project"
                  value={projectId}
                  onChange={(e) => {
                    setChosenProject(e.target.value);
                    // Someone else may not be in that project: back to you.
                    setChosenOwner(null);
                  }}
                  className="mt-1 block w-full truncate rounded-lg border border-border bg-white px-2 py-1.5 text-sm text-ink"
                >
                  {context.projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="min-w-0 text-xs font-medium text-muted">
                Date
                <input name="due_date" type="date" className="mt-1 block w-full rounded-lg border border-border bg-white px-2 py-1.5 text-sm text-ink" />
              </label>
              <label className="min-w-0 text-xs font-medium text-muted">
                Owner
                <select
                  name="owner"
                  value={ownerId}
                  onChange={(e) => setChosenOwner(e.target.value)}
                  className="mt-1 block w-full truncate rounded-lg border border-border bg-white px-2 py-1.5 text-sm text-ink"
                >
                  <option value="">Nobody</option>
                  {owners.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={close}
              className="rounded-xl px-3 py-2 text-sm font-medium text-muted hover:bg-surface pointer-coarse:min-h-11"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!context || context.projects.length === 0}
              className="inline-flex items-center gap-1.5 rounded-xl bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50 pointer-coarse:min-h-11"
            >
              <Plus className="size-4" aria-hidden="true" />
              Add task
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
