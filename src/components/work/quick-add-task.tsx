"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { toast } from "@/components/ui/toaster";
import { submitTaskOp } from "@/lib/offline/sync";
import type { TaskListItem } from "@/lib/work/data";

export type QuickAddProject = { id: string; name: string; workspace: { id: string; name: string; slug: string } };

/**
 * Add a task in one line: a title, Enter. Works without a connection too:
 * the task gets its id here (crypto.randomUUID), shows up in the list at
 * once, and reaches the server with that same id, once.
 * It is yours (owner and reviewer), To do, normal priority; the rest is on
 * the task page.
 */
export function QuickAddTask({
  projects,
  user,
  defaultProjectId,
  autoFocus = false,
}: {
  projects: QuickAddProject[];
  user: { id: string; name: string; email: string | null };
  defaultProjectId?: string;
  /** The capture page: the field has the focus as soon as it opens. */
  autoFocus?: boolean;
}) {
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [projectId, setProjectId] = useState(
    defaultProjectId && projects.some((p) => p.id === defaultProjectId) ? defaultProjectId : (projects[0]?.id ?? ""),
  );
  const [busy, setBusy] = useState(false);
  if (projects.length === 0) return null;

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = input.current?.value.trim() ?? "";
    const project = projects.find((p) => p.id === projectId);
    if (!title || !project) return;
    setBusy(true);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const record: TaskListItem = {
      id,
      title,
      status: "todo",
      priority: "normal",
      dueAt: null,
      parentId: null,
      parentTitle: null,
      isLog: false,
      reviewerId: user.id,
      createdBy: user.id,
      updatedAt: now,
      completedAt: null,
      taskType: null,
      labels: [],
      startOn: null,
      estimateMinutes: null,
      project: { id: project.id, name: project.name },
      workspace: project.workspace,
      assignees: [{ id: user.id, name: user.name, email: user.email }],
      subtasks: { total: 0, done: 0 },
      record: null,
    };
    try {
      await submitTaskOp({
        op: "task.create",
        payload: { id, project_id: project.id, title, assignees: [user.id], status: "todo", priority: "normal" },
        record,
      });
      if (input.current) input.current.value = "";
      toast(navigator.onLine ? `Added "${title}".` : `Added "${title}" on this device. It is sent when you are back online.`);
    } catch {
      toast("This task could not be saved on this device.", { tone: "error" });
    } finally {
      setBusy(false);
      input.current?.focus();
    }
  }

  return (
    <form onSubmit={add} className="flex min-w-0 items-center gap-2 rounded-2xl border border-border bg-card p-2 shadow-xs">
      {projects.length > 1 && (
        <label className="min-w-0 shrink basis-36 sm:basis-48">
          <span className="sr-only">Project</span>
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="w-full truncate rounded-xl border border-border bg-white px-2.5 py-2 text-sm"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label htmlFor={inputId} className="sr-only">
        New task
      </label>
      <input
        id={inputId}
        ref={input}
        name="title"
        required
        maxLength={300}
        placeholder="Add a task"
        enterKeyHint="done"
        autoComplete="off"
        autoFocus={autoFocus}
        className="min-w-0 flex-1 rounded-xl bg-transparent px-2.5 py-2 text-sm outline-none placeholder:text-muted/70"
      />
      <button
        type="submit"
        disabled={busy}
        aria-label="Add task"
        className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-700 text-white hover:bg-brand-800 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
      >
        <Plus className="size-5" aria-hidden="true" />
      </button>
    </form>
  );
}
