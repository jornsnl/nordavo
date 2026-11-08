"use client";

import { useActionState, useEffect, useId, useRef } from "react";
import { addStageNote } from "@/app/dashboard/vacancies/[id]/pipeline/recruitment-actions";
import { initialActionState } from "@/lib/action-state";
import type { NoteKind } from "@/lib/database.types";
import { noteKinds } from "@/lib/labels";
import { Field, FormMessage, Select, Textarea } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";

export type NoteTarget = { value: string; label: string };

/**
 * A note with a kind (call, screening call, ...). On an application the
 * database records the stage it is in. With `targets` the writer chooses
 * what the note is about: the candidate in general or one application.
 */
export function StageNoteForm({
  applicationId,
  candidateId,
  targets,
  defaultKind = "note",
  stageLabel,
  onSaved,
}: {
  applicationId?: string;
  candidateId?: string;
  /** Values "candidate" or "application:<id>". */
  targets?: NoteTarget[];
  defaultKind?: NoteKind;
  /** Shown as "Recorded in <stage>". */
  stageLabel?: string;
  onSaved?: () => void;
}) {
  const id = useId();
  const form = useRef<HTMLFormElement>(null);
  const [state, formAction] = useActionState(addStageNote, initialActionState);
  const error = state.fieldErrors?.body ?? state.error;

  useEffect(() => {
    if (state.ok) {
      form.current?.reset();
      onSaved?.();
    }
  }, [state, onSaved]);

  return (
    <form ref={form} action={formAction} className="space-y-3">
      {applicationId ? (
        <>
          <input type="hidden" name="entity_type" value="application" />
          <input type="hidden" name="entity_id" value={applicationId} />
        </>
      ) : (
        <>
          <input type="hidden" name="entity_type" value="candidate" />
          <input type="hidden" name="entity_id" value={candidateId} />
        </>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Kind" htmlFor={`${id}-kind`}>
          <Select id={`${id}-kind`} name="kind" defaultValue={defaultKind}>
            {noteKinds.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </Select>
        </Field>
        {targets && targets.length > 1 && (
          <Field label="About" htmlFor={`${id}-about`} hint="A vacancy records the stage the candidate is in there.">
            <Select id={`${id}-about`} name="about" defaultValue={targets[0]?.value}>
              {targets.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>
      <Field
        label="Note"
        htmlFor={`${id}-body`}
        hint={stageLabel ? `Recorded in ${stageLabel}.` : undefined}
        error={state.fieldErrors?.body}
      >
        <Textarea
          id={`${id}-body`}
          name="body"
          rows={3}
          required
          maxLength={10000}
          placeholder="For example: called, notice period 30 days, prefers Bangalore."
          aria-invalid={state.fieldErrors?.body ? true : undefined}
        />
      </Field>
      <div aria-live="polite">
        <FormMessage error={state.fieldErrors?.body ? undefined : error} success={state.ok ? state.message : undefined} />
      </div>
      <div className="flex justify-end max-sm:*:flex-1">
        <SubmitButton size="sm" pendingLabel="Saving">
          Add note
        </SubmitButton>
      </div>
    </form>
  );
}
