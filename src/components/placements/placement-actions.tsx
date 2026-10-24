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
    // Phones: Bewerken on its own row, the status changes share the next one.
    <div className="flex flex-wrap gap-2 max-sm:w-full">
      <ButtonLink href={`/dashboard/plaatsingen/${placementId}/bewerken`} variant="secondary" className="max-sm:basis-full">
        <Pencil aria-hidden="true" />
        Bewerken
      </ButtonLink>
      {status === "active" && (
        <Button variant="secondary" onClick={() => setDialog("notice")} className="max-sm:flex-1">
          <LogOut aria-hidden="true" />
          Opzeggen
        </Button>
      )}
      {status !== "ended" && (
        <Button variant="secondary" onClick={() => setDialog("end")} className="max-sm:flex-1">
          <CircleStop aria-hidden="true" />
          Beëindigen
        </Button>
      )}
      <Button variant="ghost" onClick={() => setDialog("delete")} aria-label="Plaatsing verwijderen">
        <Trash2 aria-hidden="true" />
      </Button>

      <Modal
        open={dialog === "notice"}
        onClose={close}
        title="Plaatsing opzeggen"
        description="De opzegtermijn is één maand. Pas de laatste werkdag aan als jullie iets anders afspreken."
      >
        <NoticeForm action={giveNotice} onDone={close} />
      </Modal>

      <Modal
        open={dialog === "end"}
        onClose={close}
        title="Plaatsing beëindigen"
        description="De plaatsing stopt en verdwijnt uit de lopende plaatsingen."
      >
        <EndForm action={end} defaultEnd={endDate ?? todayIso()} onDone={close} />
      </Modal>

      <Modal open={dialog === "delete"} onClose={close} title="Plaatsing verwijderen">
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
      <Field label="Opgezegd op" htmlFor="notice_given_at" required error={errors.notice_given_at}>
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
        label="Laatste werkdag"
        htmlFor="end_date"
        required
        error={errors.end_date}
        hint="Standaard één maand na de opzegging."
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
          Annuleren
        </Button>
        <PendingSubmit pending={pending} pendingLabel="Bezig">
          Opzeggen
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
      <Field label="Einddatum" htmlFor="end_end_date" required error={errors.end_date}>
        <Input id="end_end_date" name="end_date" type="date" required defaultValue={defaultEnd} />
      </Field>
      <div className="flex justify-end gap-2 max-sm:*:flex-1">
        <Button variant="secondary" onClick={onDone}>
          Annuleren
        </Button>
        <PendingSubmit pending={pending} pendingLabel="Bezig">
          Beëindigen
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
        Je verwijdert de plaatsing, alle check-ins en de gekoppelde taken. Dit kun je niet
        terugdraaien. Is de samenwerking gestopt? Kies dan liever voor beëindigen.
      </p>
      <div className="flex justify-end gap-2 max-sm:*:flex-1">
        <Button variant="secondary" onClick={onCancel}>
          Annuleren
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
          {pending ? "Bezig met verwijderen" : "Verwijderen"}
        </Button>
      </div>
    </div>
  );
}
