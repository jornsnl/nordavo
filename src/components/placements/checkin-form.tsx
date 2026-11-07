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

const RATING_LABELS = ["", "Poor", "Fair", "Sufficient", "Good", "Excellent"];

/** "Add check-in" button with a modal; afterwards offers to plan the next one. */
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
        Add check-in
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Record check-in"
        description="How is it going according to the client? Short and concrete is enough."
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
      <Field label="Date" htmlFor="checkin_date" required error={errors.checkin_date}>
        <Input id="checkin_date" name="checkin_date" type="date" required defaultValue={todayIso()} />
      </Field>
      <StarInput error={errors.rating} />
      <Field label="Notes" htmlFor="checkin_notes" error={errors.notes}>
        <Textarea
          id="checkin_notes"
          name="notes"
          rows={4}
          placeholder="What goes well, what can be better, agreements."
        />
      </Field>
      <div className="flex justify-end gap-2 max-sm:*:flex-1">
        <Button variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <PendingSubmit pending={pending} pendingLabel="Saving">
          Save
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
                {n} of 5, {RATING_LABELS[n].toLowerCase()}
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
          {shown ? RATING_LABELS[shown] : "No score yet"}
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
        <FormMessage success="Check-in saved and the next one is planned." />
        <div className="flex justify-end max-sm:*:flex-1">
          <Button onClick={onDone}>Close</Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submitWithoutReset(formAction)} className="space-y-5" noValidate>
      <FormMessage success="Check-in saved." error={state.error} />
      <div className="flex items-start gap-3 rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-800">
        <CalendarCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <p>Plan the next check-in right away. We suggest {formatShortDate(suggested)}, in a month.</p>
      </div>
      <Field label="Next check-in" htmlFor="next_checkin_at" required error={errors.next_checkin_at}>
        <Input id="next_checkin_at" name="next_checkin_at" type="date" required defaultValue={suggested} />
      </Field>
      <label className="flex cursor-pointer items-center gap-2 text-sm text-ink pointer-coarse:min-h-11">
        <input
          type="checkbox"
          name="create_task"
          defaultChecked
          className="size-4 rounded border-border accent-brand-700"
        />
        Make it a task for me
      </label>
      <div className="flex justify-end gap-2 max-sm:*:flex-1">
        <Button variant="secondary" onClick={onDone}>
          Not now
        </Button>
        <PendingSubmit pending={pending} pendingLabel="Planning">
          Plan
        </PendingSubmit>
      </div>
    </form>
  );
}
