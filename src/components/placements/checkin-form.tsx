"use client";

import { useActionState, useState } from "react";
import { CalendarCheck, Plus, Star } from "lucide-react";
import { type ActionState, initialActionState } from "@/lib/action-state";
import { todayIso } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { formatShortDate } from "./dates";
import { PendingSubmit, submitWithoutReset } from "./form-utils";

type CheckinState = ActionState & { suggestedNext?: string };

const RATING_LABELS = ["", "Slecht", "Matig", "Voldoende", "Goed", "Uitstekend"];

/** "Check-in toevoegen" button with a modal; afterwards offers to plan the next one. */
export function AddCheckin({
  addCheckin,
  setNextCheckin,
  disabled = false,
}: {
  addCheckin: (state: CheckinState, formData: FormData) => Promise<CheckinState>;
  setNextCheckin: (state: ActionState, formData: FormData) => Promise<ActionState>;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);

  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        disabled={disabled}
        onClick={() => {
          setFormKey((k) => k + 1);
          setOpen(true);
        }}
      >
        <Plus aria-hidden="true" />
        Check-in toevoegen
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Check-in vastleggen"
        description="Hoe gaat het volgens de klant? Kort en concreet is genoeg."
      >
        <CheckinFlow
          key={formKey}
          addCheckin={addCheckin}
          setNextCheckin={setNextCheckin}
          onDone={() => setOpen(false)}
        />
      </Modal>
    </>
  );
}

function CheckinFlow({
  addCheckin,
  setNextCheckin,
  onDone,
}: {
  addCheckin: (state: CheckinState, formData: FormData) => Promise<CheckinState>;
  setNextCheckin: (state: ActionState, formData: FormData) => Promise<ActionState>;
  onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState<CheckinState, FormData>(
    addCheckin,
    initialActionState,
  );
  const errors = state.fieldErrors ?? {};

  if (state.ok) {
    return (
      <NextCheckinForm
        action={setNextCheckin}
        suggested={state.suggestedNext ?? todayIso()}
        onDone={onDone}
      />
    );
  }

  return (
    <form onSubmit={submitWithoutReset(formAction)} className="space-y-5" noValidate>
      <FormMessage error={state.error} />
      <Field label="Datum" htmlFor="checkin_date" required error={errors.checkin_date}>
        <Input id="checkin_date" name="checkin_date" type="date" required defaultValue={todayIso()} />
      </Field>
      <StarInput error={errors.rating} />
      <Field label="Notities" htmlFor="checkin_notes" error={errors.notes}>
        <Textarea
          id="checkin_notes"
          name="notes"
          rows={4}
          placeholder="Wat gaat goed, wat kan beter, afspraken."
        />
      </Field>
      <div className="flex justify-end gap-2 max-sm:*:flex-1">
        <Button variant="secondary" onClick={onDone}>
          Annuleren
        </Button>
        <PendingSubmit pending={pending} pendingLabel="Bezig met opslaan">
          Opslaan
        </PendingSubmit>
      </div>
    </form>
  );
}

function StarInput({ error }: { error?: string }) {
  const [value, setValue] = useState(0);
  const [hover, setHover] = useState(0);
  const shown = hover || value;

  return (
    <fieldset>
      <legend className="mb-1.5 block text-sm font-medium text-ink">Score</legend>
      <div className="flex items-center gap-3">
        <div className="flex" onMouseLeave={() => setHover(0)}>
          {[1, 2, 3, 4, 5].map((n) => (
            <label
              key={n}
              className="cursor-pointer rounded-md p-0.5 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand-500"
              onMouseEnter={() => setHover(n)}
            >
              <input
                type="radio"
                name="rating"
                value={n}
                checked={value === n}
                onChange={() => setValue(n)}
                className="sr-only"
              />
              <span className="sr-only">
                {n} van 5, {RATING_LABELS[n].toLowerCase()}
              </span>
              <Star
                aria-hidden="true"
                className={`size-7 transition pointer-coarse:size-9 ${
                  n <= shown ? "fill-accent-500 text-accent-500" : "text-brand-200"
                }`}
              />
            </label>
          ))}
        </div>
        <span className="text-sm text-muted" aria-live="polite">
          {shown ? RATING_LABELS[shown] : "Nog geen score"}
        </span>
      </div>
      {error && <p className="mt-1.5 text-xs font-medium text-danger">{error}</p>}
    </fieldset>
  );
}

function NextCheckinForm({
  action,
  suggested,
  onDone,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  suggested: string;
  onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState(action, initialActionState);
  const errors = state.fieldErrors ?? {};

  if (state.ok) {
    return (
      <div className="space-y-5">
        <FormMessage success="Check-in opgeslagen en de volgende staat gepland." />
        <div className="flex justify-end max-sm:*:flex-1">
          <Button onClick={onDone}>Sluiten</Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submitWithoutReset(formAction)} className="space-y-5" noValidate>
      <FormMessage success="Check-in opgeslagen." error={state.error} />
      <div className="flex items-start gap-3 rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-800">
        <CalendarCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <p>Plan meteen de volgende check-in. Wij stellen {formatShortDate(suggested)} voor, over een maand.</p>
      </div>
      <Field label="Volgende check-in" htmlFor="next_checkin_at" required error={errors.next_checkin_at}>
        <Input id="next_checkin_at" name="next_checkin_at" type="date" required defaultValue={suggested} />
      </Field>
      <label className="flex cursor-pointer items-center gap-2 text-sm text-ink pointer-coarse:min-h-11">
        <input
          type="checkbox"
          name="create_task"
          defaultChecked
          className="size-4 rounded border-border accent-brand-700"
        />
        Maak er een taak voor mij van
      </label>
      <div className="flex justify-end gap-2 max-sm:*:flex-1">
        <Button variant="secondary" onClick={onDone}>
          Niet nu
        </Button>
        <PendingSubmit pending={pending} pendingLabel="Bezig met plannen">
          Plannen
        </PendingSubmit>
      </div>
    </form>
  );
}
