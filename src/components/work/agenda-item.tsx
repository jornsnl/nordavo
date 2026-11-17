"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Check, ListPlus, MessageSquareText, RotateCcw, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input, Select, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { toast } from "@/components/ui/toaster";
import { PendingSubmit, submitWithoutReset } from "@/components/placements/form-utils";
import { useWorkAction } from "@/components/work/forms";
import { makeTaskAction, updateAgendaItemAction, type AgendaItemFields } from "@/app/work/meeting-actions";
import type { AgendaItem } from "@/lib/work/meeting-data";
import { agendaStatus, bySource, carriedLabel } from "@/lib/work/meeting-labels";
import { workOption, workPriorities, workStatuses } from "@/lib/work/labels";
import type { Person } from "@/lib/work/data";
import { formatDateIn } from "@/lib/work/time";

/**
 * One point of an agenda. While the round is open it can be marked
 * discussed, dropped, given a decision or note, and turned into a task for
 * whoever picks it up. In an earlier round it only shows what happened.
 */
export function AgendaItemCard({
  item,
  people,
  currentUserId,
  timeZone,
  readOnly = false,
}: {
  item: AgendaItem;
  people: Person[];
  currentUserId: string;
  timeZone: string;
  readOnly?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [making, setMaking] = useState(false);
  const status = agendaStatus(item.status);
  const moved = carriedLabel(item.carriedCount);

  function change(fields: AgendaItemFields, done?: () => void) {
    startTransition(async () => {
      const result = await updateAgendaItemAction(item.id, fields);
      if ("error" in result) toast(result.error, { tone: "error" });
      else done?.();
    });
  }

  return (
    <li className={`rounded-2xl border border-border bg-card p-4 shadow-xs ${item.status === "dropped" ? "opacity-70" : ""}`}>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <h3 className={`min-w-0 flex-1 text-[15px] font-semibold ${item.status === "dropped" ? "line-through" : ""}`}>{item.title}</h3>
        <div className="flex flex-wrap items-center gap-1.5">
          {moved && <Badge tone="accent">{moved}</Badge>}
          <Badge tone={status.tone}>{status.label}</Badge>
        </div>
      </div>
      {item.note && <p className="mt-1 text-sm whitespace-pre-line text-muted">{item.note}</p>}
      <p className="mt-1.5 text-xs text-muted">
        {item.addedBy ? `Brought up by ${item.addedBy.name}` : "Brought up"}
        {bySource(item.source)} · {formatDateIn(item.createdAt, timeZone)}
        {item.forwardedToOpenedAt && ` · moved to the round of ${formatDateIn(item.forwardedToOpenedAt, timeZone)}`}
      </p>

      {item.decision && !editing && (
        <div className="mt-3 rounded-xl bg-brand-50 px-3 py-2 text-sm">
          <p className="text-xs font-semibold tracking-wide text-brand-700 uppercase">Decision</p>
          <p className="whitespace-pre-line">{item.decision}</p>
          {item.decidedBy && (
            <p className="mt-1 text-xs text-muted">
              {item.decidedBy.name}
              {item.decidedAt && ` · ${formatDateIn(item.decidedAt, timeZone)}`}
            </p>
          )}
        </div>
      )}

      {item.task && (
        <p className="mt-3 text-sm">
          <span className="text-muted">Task: </span>
          <Link href={`/work/tasks/${item.task.id}`} className="font-medium text-brand-700 underline-offset-2 hover:underline">
            {item.task.title}
          </Link>
          <span className="text-xs text-muted"> · {workOption(workStatuses, item.task.status).label}</span>
        </p>
      )}

      {editing && (
        <form
          className="mt-3 space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            const decision = String(new FormData(event.currentTarget).get("decision") ?? "");
            change({ decision }, () => setEditing(false));
          }}
        >
          <label htmlFor={`decision-${item.id}`} className="sr-only">
            Decision or note
          </label>
          <Textarea id={`decision-${item.id}`} name="decision" rows={3} maxLength={5000} defaultValue={item.decision ?? ""} placeholder="What was decided, or a short note" autoFocus />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={pending}>
              Save
            </Button>
          </div>
        </form>
      )}

      {!readOnly && !editing && (
        <div className="mt-3 flex flex-wrap gap-2">
          {item.status === "open" ? (
            <Button size="sm" variant="secondary" disabled={pending} onClick={() => change({ status: "discussed" })}>
              <Check aria-hidden="true" />
              Discussed
            </Button>
          ) : (
            <Button size="sm" variant="secondary" disabled={pending} onClick={() => change({ status: "open" })}>
              <RotateCcw aria-hidden="true" />
              Reopen
            </Button>
          )}
          {item.status !== "dropped" && (
            <Button size="sm" variant="secondary" disabled={pending} onClick={() => change({ status: "dropped" })}>
              <X aria-hidden="true" />
              Drop
            </Button>
          )}
          <Button size="sm" variant="secondary" disabled={pending} onClick={() => setEditing(true)}>
            <MessageSquareText aria-hidden="true" />
            {item.decision ? "Edit decision" : "Decision"}
          </Button>
          {!item.task && item.status !== "dropped" && (
            <Button size="sm" disabled={pending} onClick={() => setMaking(true)}>
              <ListPlus aria-hidden="true" />
              Make task
            </Button>
          )}
        </div>
      )}

      {making && <MakeTaskModal item={item} people={people} currentUserId={currentUserId} onClose={() => setMaking(false)} />}
    </li>
  );
}

function MakeTaskModal({ item, people, currentUserId, onClose }: { item: AgendaItem; people: Person[]; currentUserId: string; onClose: () => void }) {
  const { state, formAction, pending, errors } = useWorkAction(makeTaskAction.bind(null, item.id), onClose);
  return (
    <Modal open onClose={onClose} title="Make task" description="A normal task in the inbox of the person who picks it up. The point links to it.">
      <form onSubmit={submitWithoutReset(formAction)} className="space-y-4 p-1" noValidate>
        <FormMessage error={state.error} />
        <Field label="Title" htmlFor={`task-title-${item.id}`} error={errors.title}>
          <Input id={`task-title-${item.id}`} name="title" maxLength={300} defaultValue={item.title} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Owner" htmlFor={`task-owner-${item.id}`} required error={errors.owner_id}>
            <Select id={`task-owner-${item.id}`} name="owner_id" defaultValue={currentUserId} required>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.id === currentUserId ? `${p.name} (you)` : p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Deadline" htmlFor={`task-due-${item.id}`} hint="Your time zone" error={errors.due_at}>
            <Input id={`task-due-${item.id}`} name="due_at" type="datetime-local" />
          </Field>
        </div>
        <Field label="Priority" htmlFor={`task-priority-${item.id}`}>
          <Select id={`task-priority-${item.id}`} name="priority" defaultValue="normal">
            {workPriorities.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex justify-end gap-2 max-sm:*:flex-1">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <PendingSubmit pending={pending} pendingLabel="Making">
            Make task
          </PendingSubmit>
        </div>
      </form>
    </Modal>
  );
}
