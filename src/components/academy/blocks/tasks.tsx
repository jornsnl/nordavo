"use client";

import { useEffect, useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { deleteTask, listBlockTasks, reorderTasks, saveTask } from "@/app/dashboard/academy/learn-actions";
import type { AcademyTaskRow } from "@/lib/academy/database";
import { DEADLINE_PRESETS, taskDeadlineText } from "@/lib/academy/learn/tasks";
import type { TaskState } from "@/lib/academy/learn/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input, Textarea } from "@/components/ui/field";
import { TaskCheckList, type TaskItem } from "@/components/academy/learn/task-list";
import type { BlockEditorProps, BlockViewerProps } from "./types";

// Tasks block (Academy: takenblok). The editor manages the block's own rows
// in academy_tasks (saved one by one, not with "Save block"); the viewer
// shows the learner's task instances (own and shared) from academy_my_tasks().

type Draft = {
  id: string | null;
  title: string;
  description: string;
  offset: string;
  shared: boolean;
  placementOnly: boolean;
  required: boolean;
};

const emptyDraft: Draft = { id: null, title: "", description: "", offset: "", shared: false, placementOnly: false, required: true };

function toDraft(row: AcademyTaskRow): Draft {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? "",
    offset: row.deadline_offset_days === null ? "" : String(row.deadline_offset_days),
    shared: row.shared,
    placementOnly: row.placement_only,
    required: row.required,
  };
}

function TaskForm({ blockId, draft, onSaved, onCancel }: { blockId: string; draft: Draft; onSaved: (row: AcademyTaskRow) => void; onCancel?: () => void }) {
  const [value, setValue] = useState(draft);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | undefined>();
  const id = value.id ?? `new-${blockId}`;
  const offset = value.offset.trim() === "" ? null : Number(value.offset);
  const label = offset !== null && Number.isFinite(offset) ? taskDeadlineText(offset, "en") : null;

  function submit() {
    setError(undefined);
    start(async () => {
      const result = await saveTask({
        blockId,
        id: value.id,
        title: value.title,
        description: value.description || null,
        deadlineOffsetDays: offset !== null && Number.isFinite(offset) ? offset : null,
        shared: value.shared,
        placementOnly: value.placementOnly,
        required: value.required,
      });
      if (result.error || !result.task) {
        setError(result.error);
        return;
      }
      onSaved(result.task);
      if (!value.id) setValue(emptyDraft);
    });
  }

  return (
    <div className="space-y-3 rounded-xl border border-border bg-surface/50 p-3">
      <Field label="Task" htmlFor={`t-title-${id}`}>
        <Input
          id={`t-title-${id}`}
          value={value.title}
          maxLength={500}
          placeholder="For example: put the overlap window in your calendar"
          onChange={(e) => setValue({ ...value, title: e.target.value })}
        />
      </Field>
      <Field label="Explanation (optional)" htmlFor={`t-desc-${id}`}>
        <Textarea id={`t-desc-${id}`} rows={2} value={value.description} maxLength={5000} onChange={(e) => setValue({ ...value, description: e.target.value })} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Deadline (days after the start date)"
          htmlFor={`t-offset-${id}`}
          hint={label ? `Shown as "${label}", and as a real date in each person's time zone.` : "Empty: no deadline. 0 is day 1, the start date."}
        >
          <Input
            id={`t-offset-${id}`}
            type="number"
            inputMode="numeric"
            min={-365}
            max={3650}
            value={value.offset}
            onChange={(e) => setValue({ ...value, offset: e.target.value })}
            className="sm:w-32"
          />
        </Field>
        <div className="flex flex-wrap items-end gap-1.5 pb-1">
          {DEADLINE_PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => setValue({ ...value, offset: String(p.offset) })}
              className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                value.offset === String(p.offset) ? "border-brand-500 bg-brand-50 text-brand-900" : "border-border text-muted hover:border-brand-200"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={value.required} onChange={(e) => setValue({ ...value, required: e.target.checked })} className="size-4 accent-brand-700" />
          Required
        </label>
        <label className="flex items-center gap-2" title="Candidates see it once they are placed.">
          <input
            type="checkbox"
            checked={value.placementOnly || value.shared}
            disabled={value.shared}
            onChange={(e) => setValue({ ...value, placementOnly: e.target.checked })}
            className="size-4 accent-brand-700"
          />
          Only with a placement
        </label>
        <label className="flex items-center gap-2" title="One status per placement: the client ticks it off, the developer and Nordavo see it.">
          <input type="checkbox" checked={value.shared} onChange={(e) => setValue({ ...value, shared: e.target.checked })} className="size-4 accent-brand-700" />
          Shared within the placement
        </label>
      </div>
      <FormMessage error={error} />
      <div className="flex gap-2">
        <Button size="sm" disabled={pending || !value.title.trim()} onClick={submit}>
          {value.id ? "Save task" : (
            <>
              <Plus aria-hidden="true" />
              Add task
            </>
          )}
        </Button>
        {onCancel && (
          <Button size="sm" variant="ghost" disabled={pending} onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}

export function TasksEditor({ block, disabled }: BlockEditorProps) {
  const [rows, setRows] = useState<AcademyTaskRow[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ error?: string; success?: string }>({});

  useEffect(() => {
    let live = true;
    void listBlockTasks(block.id).then((list) => {
      if (live) setRows(list);
    });
    return () => {
      live = false;
    };
  }, [block.id]);

  function move(index: number, delta: number) {
    if (!rows) return;
    const next = [...rows];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item);
    setRows(next);
    start(async () => {
      const result = await reorderTasks(block.id, next.map((r) => r.id));
      setMessage({ error: result.error });
    });
  }

  function remove(row: AcademyTaskRow) {
    if (!window.confirm(`Delete "${row.title}"? Ticks on it are deleted too.`)) return;
    start(async () => {
      const result = await deleteTask(row.id);
      if (result.ok) setRows((list) => (list ?? []).filter((r) => r.id !== row.id));
      setMessage({ error: result.error, success: result.message });
    });
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">Tasks are saved one by one. A deadline counts from the person&apos;s start date (shared tasks: the placement start).</p>
      {rows === null ? (
        <p className="text-sm text-muted">Loading tasks…</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row, index) =>
            editing === row.id ? (
              <li key={row.id}>
                <TaskForm
                  blockId={block.id}
                  draft={toDraft(row)}
                  onCancel={() => setEditing(null)}
                  onSaved={(saved) => {
                    setRows((list) => (list ?? []).map((r) => (r.id === saved.id ? saved : r)));
                    setEditing(null);
                  }}
                />
              </li>
            ) : (
              <li key={row.id} className="flex items-start gap-2 rounded-xl border border-border px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-brand-900">{row.title}</p>
                  <p className="mt-1 flex flex-wrap gap-1.5">
                    {row.deadline_offset_days !== null && <Badge tone="brand">{taskDeadlineText(row.deadline_offset_days, "en")}</Badge>}
                    {row.required ? <Badge tone="accent">Required</Badge> : <Badge>Optional</Badge>}
                    {row.shared && <Badge tone="warning">Shared</Badge>}
                    {row.placement_only && !row.shared && <Badge>Only with a placement</Badge>}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  <Button size="sm" variant="ghost" aria-label="Move up" disabled={disabled || pending || index === 0} onClick={() => move(index, -1)}>
                    <ArrowUp aria-hidden="true" />
                  </Button>
                  <Button size="sm" variant="ghost" aria-label="Move down" disabled={disabled || pending || index === rows.length - 1} onClick={() => move(index, 1)}>
                    <ArrowDown aria-hidden="true" />
                  </Button>
                  <Button size="sm" variant="ghost" disabled={disabled || pending} onClick={() => setEditing(row.id)}>
                    Edit
                  </Button>
                  <Button size="sm" variant="ghost" aria-label="Delete" disabled={disabled || pending} onClick={() => remove(row)}>
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>
              </li>
            ),
          )}
        </ul>
      )}
      <FormMessage error={message.error} success={message.success} />
      <TaskForm blockId={block.id} draft={emptyDraft} onSaved={(saved) => setRows((list) => [...(list ?? []), saved])} />
    </div>
  );
}

function tasksFromState(state: BlockViewerProps["state"]): TaskState[] {
  if (!state || typeof state !== "object" || Array.isArray(state)) return [];
  const tasks = (state as { tasks?: unknown }).tasks;
  return Array.isArray(tasks) ? (tasks as TaskState[]) : [];
}

export function TasksViewer({ state, locale, timeZone, preview }: BlockViewerProps) {
  const items: TaskItem[] = tasksFromState(state).map((task) => ({
    taskId: task.taskId,
    placementId: task.placementId,
    title: task.title,
    description: task.description,
    required: task.required,
    shared: task.shared,
    placementLabel: task.placementLabel,
    deadlineOffsetDays: task.deadlineOffsetDays,
    dueAt: task.dueAt,
    doneAt: task.doneAt,
    doneByName: task.doneByName,
    canTick: task.canTick,
  }));
  return <TaskCheckList items={items} locale={locale} timeZone={timeZone} preview={preview} />;
}
