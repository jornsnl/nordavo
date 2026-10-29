"use client";

import { startTransition, useRef, useState, useTransition } from "react";
import { Archive, Copy, Download, FileUp, Pencil, Trash2 } from "lucide-react";
import type { WorkStatus } from "@/lib/work/database";
import { workPriorities } from "@/lib/work/labels";
import { mentionToken } from "@/lib/work/mentions";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input, Select, Textarea } from "@/components/ui/field";
import { PendingSubmit, submitWithoutReset } from "@/components/placements/form-utils";
import { PeoplePicker, useWorkAction, type PersonOption, type WorkAction } from "@/components/work/forms";
import { Markdown } from "@/components/work/markdown";

type Move = { to: WorkStatus; label: string; variant?: "primary" | "secondary" | "danger"; needsComment?: boolean; hint?: string };

/** The status buttons that make sense for this user right now; the database checks the same rules. */
export function statusMoves(status: WorkStatus, can: { approve: boolean; cancel: boolean }): Move[] {
  const moves: Move[] = [];
  switch (status) {
    case "todo":
      moves.push({ to: "in_progress", label: "Start" }, { to: "review", label: "Send to review", variant: "secondary" });
      break;
    case "in_progress":
      moves.push({ to: "review", label: "Send to review" }, { to: "todo", label: "Back to To do", variant: "secondary" });
      break;
    case "review":
      if (can.approve) {
        moves.push(
          { to: "done", label: "Approve" },
          { to: "in_progress", label: "Send back", variant: "secondary", needsComment: true, hint: "Say what still needs to happen. The owners get a mail." },
        );
      } else {
        moves.push({ to: "in_progress", label: "Pull back from review", variant: "secondary", needsComment: true, hint: "Say why you take it back." });
      }
      break;
    case "done":
      if (can.approve) {
        moves.push({ to: "in_progress", label: "Reopen", variant: "secondary", needsComment: true, hint: "Say what still needs to happen." });
      }
      break;
    case "cancelled":
      moves.push({ to: "todo", label: "Reopen", variant: "secondary" });
      break;
  }
  if (can.cancel && status !== "done" && status !== "cancelled") {
    moves.push({ to: "cancelled", label: "Cancel task", variant: "secondary" });
  }
  return moves;
}

export function StatusControl({
  action,
  status,
  can,
  hasReviewer,
}: {
  action: WorkAction;
  status: WorkStatus;
  can: { approve: boolean; cancel: boolean };
  hasReviewer: boolean;
}) {
  const [selected, setSelected] = useState<Move | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const { state, formAction, pending } = useWorkAction(action, () => setSelected(null));
  const moves = statusMoves(status, can);
  if (moves.length === 0) return null;

  return (
    <form
      ref={formRef}
      onSubmit={(event) => {
        // Keep the clicked button's status in the form data.
        event.preventDefault();
        const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
        const formData = new FormData(event.currentTarget, submitter);
        startTransition(() => formAction(formData));
      }}
      className="space-y-3"
    >
      <FormMessage error={state.error} />
      {!selected ? (
        <div className="flex flex-wrap gap-2 max-sm:*:flex-1">
          {moves.map((move) => (
            <Button
              key={move.to + move.label}
              type={move.needsComment ? "button" : "submit"}
              name={move.needsComment ? undefined : "status"}
              value={move.needsComment ? undefined : move.to}
              variant={move.variant ?? "primary"}
              disabled={pending || (move.to === "review" && !hasReviewer)}
              onClick={move.needsComment ? () => setSelected(move) : undefined}
            >
              {move.label}
            </Button>
          ))}
        </div>
      ) : (
        <div className="space-y-3 rounded-xl border border-accent-500/30 bg-accent-100/40 p-3">
          <input type="hidden" name="status" value={selected.to} />
          <Field label={`${selected.label}: comment`} htmlFor="status_comment" required hint={selected.hint}>
            <Textarea id="status_comment" name="comment" rows={3} required autoFocus />
          </Field>
          <div className="flex flex-wrap gap-2 max-sm:*:flex-1">
            <PendingSubmit pending={pending}>{selected.label}</PendingSubmit>
            <Button variant="ghost" onClick={() => setSelected(null)}>
              Never mind
            </Button>
          </div>
        </div>
      )}
    </form>
  );
}

/** Title and description, shown as text until you click Edit. */
export function DescriptionEditor({
  action,
  title,
  description,
  editable,
}: {
  action: WorkAction;
  title: string;
  description: string | null;
  editable: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const { state, formAction, pending, errors } = useWorkAction(action, () => setEditing(false));

  if (!editing) {
    return (
      <div className="space-y-3">
        {description ? <Markdown text={description} /> : <p className="text-sm text-muted">No description yet.</p>}
        {editable && (
          <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
            <Pencil aria-hidden="true" />
            Edit title and description
          </Button>
        )}
      </div>
    );
  }
  return (
    <form onSubmit={submitWithoutReset(formAction)} className="space-y-4">
      <FormMessage error={state.error} />
      <Field label="Title" htmlFor="edit_title" required error={errors.title}>
        <Input id="edit_title" name="title" defaultValue={title} maxLength={300} required />
      </Field>
      <Field label="Description" htmlFor="edit_description" hint="Markdown works: **bold**, - lists, [links](https://…)">
        <Textarea id="edit_description" name="description" defaultValue={description ?? ""} rows={10} />
      </Field>
      <div className="flex gap-2 max-sm:*:flex-1">
        <PendingSubmit pending={pending} pendingLabel="Saving">
          Save
        </PendingSubmit>
        <Button variant="ghost" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function TaskFieldsForm({
  action,
  people,
  priority,
  dueLocal,
  reviewerId,
  assigneeIds,
  timeZone,
  editable,
}: {
  action: WorkAction;
  people: PersonOption[];
  priority: string;
  dueLocal: string;
  reviewerId: string | null;
  assigneeIds: string[];
  timeZone: string;
  editable: boolean;
}) {
  const { state, formAction, pending } = useWorkAction(action);
  return (
    <form onSubmit={submitWithoutReset(formAction)} className="space-y-4">
      <fieldset disabled={!editable} className="space-y-4">
        <FormMessage error={state.error} success={state.ok ? state.message : undefined} />
        <input type="hidden" name="assignees_present" value="1" />
        <PeoplePicker name="assignees" label="Owners" people={people} defaultSelected={assigneeIds} />
        <Field label="Reviewer" htmlFor="field_reviewer" hint="Approves the work on Review">
          <Select id="field_reviewer" name="reviewer_id" defaultValue={reviewerId ?? ""}>
            {!reviewerId && <option value="">Pick a reviewer</option>}
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Priority" htmlFor="field_priority">
            <Select id="field_priority" name="priority" defaultValue={priority}>
              {workPriorities.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Deadline" htmlFor="field_due" hint={timeZone.replace(/_/g, " ")}>
            <Input id="field_due" name="due_at" type="datetime-local" defaultValue={dueLocal} />
          </Field>
        </div>
        {editable && (
          <div className="flex justify-end max-sm:*:w-full">
            <PendingSubmit pending={pending} size="sm" pendingLabel="Saving">
              Save details
            </PendingSubmit>
          </div>
        )}
      </fieldset>
    </form>
  );
}

export function MoveTaskForm({ action, projects, currentProjectId }: { action: WorkAction; projects: { id: string; name: string }[]; currentProjectId: string }) {
  const { state, formAction, pending } = useWorkAction(action);
  const others = projects.filter((p) => p.id !== currentProjectId);
  if (others.length === 0) return null;
  return (
    <form onSubmit={submitWithoutReset(formAction)} className="space-y-2">
      <Field label="Move to project" htmlFor="move_project" hint="Subtasks move along">
        <Select id="move_project" name="project_id" defaultValue="">
          <option value="" disabled>
            Pick a project
          </option>
          {others.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </Field>
      <PendingSubmit pending={pending} size="sm" variant="secondary">
        Move
      </PendingSubmit>
      {state.error && <p className="text-xs text-danger">{state.error}</p>}
    </form>
  );
}

/** Buttons that call a bound server action and may return an error. */
export function TaskActionButtons({
  duplicate,
  archive,
}: {
  duplicate?: () => Promise<{ error?: string } | void>;
  archive?: () => Promise<{ error?: string } | void>;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<{ error?: string } | void>, confirmText?: string) => () => {
    if (confirmText && !window.confirm(confirmText)) return;
    start(async () => {
      const result = await fn();
      if (result && "error" in result && result.error) setError(result.error);
    });
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {duplicate && (
          <Button size="sm" variant="secondary" disabled={pending} onClick={run(duplicate)}>
            <Copy aria-hidden="true" />
            Duplicate
          </Button>
        )}
        {archive && (
          <Button
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={run(archive, "Move this task and its subtasks to the trash? It can be restored for 30 days.")}
          >
            <Archive aria-hidden="true" />
            Archive
          </Button>
        )}
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

export function FileUpload({ action }: { action: WorkAction }) {
  const formRef = useRef<HTMLFormElement>(null);
  const { state, formAction, pending } = useWorkAction(action, () => formRef.current?.reset());
  return (
    <form ref={formRef} onSubmit={submitWithoutReset(formAction)} className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          type="file"
          name="file"
          required
          className="block w-full text-sm text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-brand-700"
        />
        <PendingSubmit pending={pending} size="sm" pendingLabel="Uploading">
          <FileUp aria-hidden="true" />
          Upload
        </PendingSubmit>
      </div>
      <p className="text-xs text-muted">Up to 25 MB. Only people with access to this task can open it, through a link that works for one minute.</p>
      {state.error && <p className="text-xs text-danger">{state.error}</p>}
    </form>
  );
}

export function FileRow({
  id,
  name,
  meta,
  remove,
}: {
  id: string;
  name: string;
  meta: string;
  remove?: () => Promise<{ error?: string } | void>;
}) {
  const [pending, start] = useTransition();
  return (
    <li className="flex items-center gap-3 py-2">
      <a
        href={`/work/files/${id}`}
        className="flex min-w-0 flex-1 items-center gap-2 text-sm font-medium text-brand-700 hover:underline"
        target="_blank"
        rel="noopener"
      >
        <Download className="size-4 shrink-0" aria-hidden="true" />
        <span className="truncate">{name}</span>
      </a>
      <span className="hidden shrink-0 text-xs text-muted sm:inline">{meta}</span>
      {remove && (
        <button
          type="button"
          disabled={pending}
          onClick={() => window.confirm(`Remove ${name}?`) && start(async () => void (await remove()))}
          className="flex size-8 items-center justify-center rounded-lg text-muted hover:bg-danger-bg hover:text-danger"
          aria-label={`Remove ${name}`}
        >
          <Trash2 className="size-4" aria-hidden="true" />
        </button>
      )}
    </li>
  );
}

/**
 * Comment box with @mentions: type @ and a few letters, pick a person, and
 * the text gets @[Name](id). Mentioned people get a mail right away.
 */
export function CommentForm({ action, people }: { action: WorkAction; people: PersonOption[] }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [query, setQuery] = useState<string | null>(null);
  const [highlight, setHighlight] = useState(0);
  const { state, formAction, pending } = useWorkAction(action, () => {
    formRef.current?.reset();
    setQuery(null);
  });

  const matches =
    query === null ? [] : people.filter((p) => p.name.toLowerCase().includes(query.toLowerCase())).slice(0, 6);

  function onInput() {
    const el = ref.current;
    if (!el) return;
    const before = el.value.slice(0, el.selectionStart ?? el.value.length);
    const match = /(?:^|\s)@([\p{L}\p{N}._-]{0,30})$/u.exec(before);
    setQuery(match ? match[1] : null);
    setHighlight(0);
  }

  function pick(person: PersonOption) {
    const el = ref.current;
    if (!el) return;
    const cursor = el.selectionStart ?? el.value.length;
    const before = el.value.slice(0, cursor).replace(/@([\p{L}\p{N}._-]{0,30})$/u, "");
    const token = `${mentionToken(person.name, person.id)} `;
    el.value = before + token + el.value.slice(cursor);
    const at = before.length + token.length;
    el.setSelectionRange(at, at);
    el.focus();
    setQuery(null);
  }

  return (
    <form ref={formRef} onSubmit={submitWithoutReset(formAction)} className="space-y-2">
      <FormMessage error={state.error} />
      <div className="relative">
        <label htmlFor="comment_body" className="sr-only">
          Comment
        </label>
        <Textarea
          ref={ref}
          id="comment_body"
          name="body"
          rows={3}
          placeholder="Progress, a question, or @name to ask someone"
          onInput={onInput}
          onKeyDown={(e) => {
            if (matches.length === 0) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setHighlight((h) => (h + 1) % matches.length);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHighlight((h) => (h - 1 + matches.length) % matches.length);
            } else if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault();
              pick(matches[highlight]);
            } else if (e.key === "Escape") {
              setQuery(null);
            }
          }}
          aria-autocomplete="list"
          aria-controls={matches.length ? "mention-list" : undefined}
        />
        {matches.length > 0 && (
          <ul
            id="mention-list"
            role="listbox"
            className="absolute bottom-full left-0 z-10 mb-1 w-64 overflow-hidden rounded-xl border border-border bg-white py-1 shadow-lg"
          >
            {matches.map((person, i) => (
              <li key={person.id} role="option" aria-selected={i === highlight}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(person);
                  }}
                  className={`w-full px-3 py-2 text-left text-sm ${i === highlight ? "bg-brand-50 text-brand-900" : "text-ink"}`}
                >
                  {person.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex justify-end max-sm:*:w-full">
        <PendingSubmit pending={pending} size="sm" pendingLabel="Posting">
          Comment
        </PendingSubmit>
      </div>
    </form>
  );
}
