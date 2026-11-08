"use client";

import { useActionState, useEffect, useId, useState, useTransition } from "react";
import { LoaderCircle, PauseCircle, PlayCircle } from "lucide-react";
import { parkVacancy, unparkVacancy } from "@/app/dashboard/vacancies/[id]/park-actions";
import { initialActionState } from "@/lib/action-state";
import type { VacancyStatus } from "@/lib/database.types";
import { formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, FormMessage, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { SubmitButton } from "@/components/ui/submit-button";

/**
 * Park a vacancy with a reason, or open it again (2.3). Parked is the
 * status on hold; the board stays as it is.
 */
export function ParkVacancyCard({
  vacancyId,
  status,
  parkReason,
  parkedAt,
}: {
  vacancyId: string;
  status: VacancyStatus;
  parkReason: string | null;
  parkedAt: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  if (status !== "open" && status !== "on_hold") return null;
  const parked = status === "on_hold";

  return (
    <Card>
      <CardHeader
        title={parked ? "Parked" : "Park this vacancy"}
        description={
          parked
            ? `Since ${formatDate(parkedAt, "an unknown date")}. The pipeline stays as it is.`
            : "Pause the search, for example when the client is on hold. The pipeline stays as it is."
        }
        actions={
          parked ? (
            <Button
              variant="secondary"
              size="sm"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await unparkVacancy(vacancyId);
                  setError(result.error);
                })
              }
            >
              {pending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <PlayCircle aria-hidden="true" />}
              Unpark
            </Button>
          ) : (
            <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
              <PauseCircle aria-hidden="true" />
              Park
            </Button>
          )
        }
      />
      {(parked || error) && (
        <CardBody>
          {parked && (
            <p className="text-sm whitespace-pre-line text-ink">
              {parkReason || <span className="text-muted">No reason given.</span>}
            </p>
          )}
          <FormMessage error={error} />
        </CardBody>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Park vacancy">
        {open && <ParkForm vacancyId={vacancyId} onDone={() => setOpen(false)} />}
      </Modal>
    </Card>
  );
}

function ParkForm({ vacancyId, onDone }: { vacancyId: string; onDone: () => void }) {
  const id = useId();
  const [state, formAction] = useActionState(parkVacancy, initialActionState);
  useEffect(() => {
    if (state.ok) onDone();
  }, [state, onDone]);
  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="vacancy_id" value={vacancyId} />
      <FormMessage error={state.error} />
      <Field label="Reason" htmlFor={`${id}-reason`} hint="Optional. Shown on the vacancy and the board." error={state.fieldErrors?.park_reason}>
        <Textarea
          id={`${id}-reason`}
          name="park_reason"
          rows={3}
          maxLength={2000}
          placeholder="For example: client freezes hiring until January."
          autoFocus
        />
      </Field>
      <div className="flex gap-3 max-sm:*:flex-1 sm:justify-end">
        <Button variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <SubmitButton pendingLabel="Parking">
          <PauseCircle aria-hidden="true" />
          Park
        </SubmitButton>
      </div>
    </form>
  );
}
