"use client";

import { useActionState, useId, useState, useTransition } from "react";
import { Pencil, Trash2 } from "lucide-react";
import type { EntityType } from "@/lib/database.types";
import { initialActionState, type ActionState } from "@/lib/action-state";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { FormMessage, Textarea } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { addNote, deleteNote, updateNote } from "./actions";

export function NoteComposer({ entityType, entityId }: { entityType: EntityType; entityId: string }) {
  const id = useId();
  const [state, formAction] = useActionState(addNote, initialActionState);
  const error = state.fieldErrors?.body ?? state.error;

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="entityType" value={entityType} />
      <input type="hidden" name="entityId" value={entityId} />
      <label htmlFor={`${id}-body`} className="sr-only">
        Nieuwe notitie
      </label>
      <Textarea
        id={`${id}-body`}
        name="body"
        rows={3}
        required
        placeholder="Schrijf een notitie, bijvoorbeeld wat je met de klant hebt besproken."
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
      />
      {error && (
        <p id={`${id}-error`} className="text-xs font-medium text-danger">
          {error}
        </p>
      )}
      <div className="flex justify-end max-sm:*:flex-1">
        <SubmitButton size="sm" pendingLabel="Opslaan">
          Notitie opslaan
        </SubmitButton>
      </div>
    </form>
  );
}

export function NoteItem({
  note,
}: {
  note: {
    id: string;
    body: string;
    authorName: string;
    timeAgo: string;
    edited: boolean;
    createdAtTitle: string;
    isOwn: boolean;
  };
}) {
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleteError, setDeleteError] = useState<string>();
  const [deleting, startDelete] = useTransition();
  const [state, formAction] = useActionState(async (prev: ActionState, formData: FormData) => {
    const result = await updateNote(prev, formData);
    if (result.ok) setEditing(false);
    return result;
  }, initialActionState);

  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex items-center gap-2">
        <Avatar name={note.authorName} size="sm" />
        <div className="min-w-0 flex-1 text-xs">
          <span className="font-medium text-ink">{note.authorName}</span>{" "}
          <time className="text-muted" title={note.createdAtTitle}>
            {note.timeAgo}
            {note.edited && " (bewerkt)"}
          </time>
        </div>
        {note.isOwn && !editing && (
          <div className="flex shrink-0">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="flex size-8 items-center justify-center rounded-lg text-muted hover:bg-brand-50 hover:text-ink active:bg-brand-50 pointer-coarse:size-10 focus-visible:outline-2 focus-visible:outline-brand-500"
              aria-label="Notitie bewerken"
            >
              <Pencil className="size-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="flex size-8 items-center justify-center rounded-lg text-muted hover:bg-danger-bg hover:text-danger active:bg-danger-bg active:text-danger pointer-coarse:size-10 focus-visible:outline-2 focus-visible:outline-brand-500"
              aria-label="Notitie verwijderen"
            >
              <Trash2 className="size-3.5" aria-hidden="true" />
            </button>
          </div>
        )}
      </div>

      {editing ? (
        <form action={formAction} className="mt-2 space-y-2">
          <input type="hidden" name="id" value={note.id} />
          <label htmlFor={`${id}-edit`} className="sr-only">
            Notitie bewerken
          </label>
          <Textarea id={`${id}-edit`} name="body" rows={4} defaultValue={note.body} required />
          <FormMessage error={state.fieldErrors?.body ?? state.error} />
          <div className="flex justify-end gap-2 max-sm:*:flex-1">
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
              Annuleren
            </Button>
            <SubmitButton size="sm">Opslaan</SubmitButton>
          </div>
        </form>
      ) : (
        <p className="mt-1.5 pl-9 text-sm leading-relaxed break-words whitespace-pre-line text-ink">{note.body}</p>
      )}

      {confirming && (
        <div className="mt-2 ml-9 flex flex-wrap items-center gap-2 rounded-xl bg-danger-bg px-3 py-2 text-sm" role="group" aria-label="Verwijderen bevestigen">
          <span className="text-danger">Notitie verwijderen?</span>
          <Button
            variant="danger"
            size="sm"
            disabled={deleting}
            onClick={() =>
              startDelete(async () => {
                const result = await deleteNote(note.id);
                if (result.error) setDeleteError(result.error);
                else setConfirming(false);
              })
            }
          >
            Verwijderen
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
            Annuleren
          </Button>
        </div>
      )}
      {deleteError && (
        <div className="mt-2 ml-9">
          <FormMessage error={deleteError} />
        </div>
      )}
    </li>
  );
}
