"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { CircleStop, LogOut, Pencil, Trash2 } from "lucide-react";
import { type ActionState, initialActionState } from "@/lib/action-state";
import { todayIso } from "@/lib/format";
import type { PlacementStatus } from "@/lib/database.types";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field, FormMessage, Input } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { addMonths } from "./dates";
import { PendingSubmit, submitWithoutReset } from "./form-utils";

type FormAction = (state: ActionState, formData: FormData) => Promise<ActionState>;

/** Edit, give notice, end and delete, for the placement detail header. */
export function PlacementActions({
  placementId,
  status,
  endDate,
  giveNotice,
  end,
  remove,
}: {
  placementId: string;
  status: PlacementStatus;
  endDate: string | null;
  giveNotice: FormAction;
  end: FormAction;
  remove: () => Promise<ActionState>;
}) {
  const [dialog, setDialog] = useState<"notice" | "end" | "delete" | null>(null);
  const close = () => setDialog(null);

  return (
    // Phones: Edit on its own row, the status changes share the next one.
    <div className="flex flex-wrap gap-2 max-sm:w-full">
      <ButtonLink href={`/dashboard/placements/${placementId}/edit`} variant="secondary" className="max-sm:basis-full">
        <Pencil aria-hidden="true" />
        Edit
      </ButtonLink>
      {status === "active" && (
        <Button variant="secondary" onClick={() => setDialog("notice")} className="max-sm:flex-1">
          <LogOut aria-hidden="true" />
          Give notice
        </Button>
      )}
      {status !== "ended" && (
        <Button variant="secondary" onClick={() => setDialog("end")} className="max-sm:flex-1">
          <CircleStop aria-hidden="true" />
          End
        </Button>
      )}
      <Button variant="ghost" onClick={() => setDialog("delete")} aria-label="Delete placement">
        <Trash2 aria-hidden="true" />
      </Button>

      <Modal
        open={dialog === "notice"}
        onClose={close}
        title="Give notice on placement"
        description="The notice period is one month. Change the last working day if you agree on something else."
      >
        <NoticeForm action={giveNotice} onDone={close} />
      </Modal>

      <Modal
        open={dialog === "end"}
        onClose={close}
        title="End placement"
        description="The placement stops and disappears from the running placements."
      >
        <EndForm action={end} defaultEnd={endDate ?? todayIso()} onDone={close} />
      </Modal>

      <Modal open={dialog === "delete"} onClose={close} title="Delete placement">
        <DeleteConfirm remove={remove} onCancel={close} />
      </Modal>
    </div>
  );
}

function useCloseOnSuccess(state: ActionState, onDone: () => void) {
  useEffect(() => {
    if (state.ok) onDone();
  }, [state, onDone]);
}

function NoticeForm({ action, onDone }: { action: FormAction; onDone: () => void }) {
  const [state, formAction, pending] = useActionState(action, initialActionState);
  const [noticeDate, setNoticeDate] = useState(todayIso());
  const [endDate, setEndDate] = useState(addMonths(todayIso(), 1));
  const [endTouched, setEndTouched] = useState(false);
  const errors = state.fieldErrors ?? {};
  useCloseOnSuccess(state, onDone);

  return (
    <form onSubmit={submitWithoutReset(formAction)} className="space-y-5" noValidate>
      <FormMessage error={state.error} />
      <Field label="Notice given on" htmlFor="notice_given_at" required error={errors.notice_given_at}>
        <Input
          id="notice_given_at"
          name="notice_given_at"
          type="date"
          required
          value={noticeDate}
          onChange={(event) => {
            const value = event.target.value;
            setNoticeDate(value);
            if (!endTouched && value) setEndDate(addMonths(value, 1));
          }}
        />
      </Field>
      <Field
        label="Last working day"
        htmlFor="end_date"
        required
        error={errors.end_date}
        hint="By default one month after the notice."
      >
        <Input
          id="end_date"
          name="end_date"
          type="date"
          required
          value={endDate}
          onChange={(event) => {
            setEndDate(event.target.value);
            setEndTouched(true);
          }}
        />
      </Field>
      <div className="flex justify-end gap-2 max-sm:*:flex-1">
        <Button variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <PendingSubmit pending={pending} pendingLabel="Working">
          Give notice
        </PendingSubmit>
      </div>
    </form>
  );
}

function EndForm({
  action,
  defaultEnd,
  onDone,
}: {
  action: FormAction;
  defaultEnd: string;
  onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState(action, initialActionState);
  const errors = state.fieldErrors ?? {};
  useCloseOnSuccess(state, onDone);

  return (
    <form onSubmit={submitWithoutReset(formAction)} className="space-y-5" noValidate>
      <FormMessage error={state.error} />
      <Field label="End date" htmlFor="end_end_date" required error={errors.end_date}>
        <Input id="end_end_date" name="end_date" type="date" required defaultValue={defaultEnd} />
      </Field>
      <div className="flex justify-end gap-2 max-sm:*:flex-1">
        <Button variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <PendingSubmit pending={pending} pendingLabel="Working">
          End
        </PendingSubmit>
      </div>
    </form>
  );
}

function DeleteConfirm({
  remove,
  onCancel,
}: {
  remove: () => Promise<ActionState>;
  onCancel: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();

  return (
    <div className="space-y-5">
      <FormMessage error={error} />
      <p className="text-sm text-muted">
        This deletes the placement, all check-ins and the linked tasks. You cannot
        undo this. Has the collaboration stopped? Then choose End instead.
      </p>
      <div className="flex justify-end gap-2 max-sm:*:flex-1">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="danger"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await remove();
              if (result?.error) setError(result.error);
            })
          }
        >
          <Trash2 aria-hidden="true" />
          {pending ? "Deleting" : "Delete"}
        </Button>
      </div>
    </div>
  );
}
