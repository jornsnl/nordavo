"use client";

import { useActionState, useEffect, useId, useState, useTransition } from "react";
import { LoaderCircle, PauseCircle, PlayCircle } from "lucide-react";
import { parkVacancy, unparkVacancy, updateHoldReason } from "@/app/dashboard/vacancies/[id]/park-actions";
import { initialActionState } from "@/lib/action-state";
import type { VacancyStatus } from "@/lib/database.types";
import { formatDate, todayIso } from "@/lib/format";
import { holdSummary, type HoldPeriod } from "@/lib/recruitment/vacancy-time";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, FormMessage, Input, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { SubmitButton } from "@/components/ui/submit-button";

type Hold = HoldPeriod & { id?: string; reason?: string };

function days(n: number) {
  return n === 1 ? "1 day" : `${n} days`;
}

/**
 * On hold (feedback round 3): put a vacancy on hold with a required reason
 * and a start date, or resume it. While on hold the clock (days open, lead
 * time) stands still; every period is kept with its reason.
 */
export function ParkVacancyCard({
  vacancyId,
  status,
  parkReason,
  parkedAt,
  holds = [],
  hasCompany = false,
}: {
  vacancyId: string;
  status: VacancyStatus;
  parkReason: string | null;
  parkedAt: string | null;
  holds?: Hold[];
  /** The vacancy belongs to a company in the sales pipeline, which can be parked too. */
  hasCompany?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  if (status !== "open" && status !== "on_hold" && holds.length === 0) return null;
  const onHold = status === "on_hold";
  const summary = holdSummary(holds);
  const past = holds.filter((h) => h.ended_on);

  return (
    <Card>
      <CardHeader
        title={onHold ? "On hold" : "Put on hold"}
        description={
          onHold
            ? `Since ${formatDate(summary.open?.started_on ?? parkedAt, "an unknown date")}${summary.current !== null ? `, ${days(summary.current)}` : ""}. Days open and lead time stand still.`
            : status === "open"
              ? "Pause the search, for example when the client freezes hiring. The clock stops until you resume."
              : `Was on hold for ${days(summary.total)} in total.`
        }
        actions={
          onHold ? (
            <Button
              variant="secondary"
              size="sm"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await unparkVacancy(vacancyId);
                  setError(result.error);
                  setMessage(result.message);
                })
              }
            >
              {pending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <PlayCircle aria-hidden="true" />}
              Resume
            </Button>
          ) : status === "open" ? (
            <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
              <PauseCircle aria-hidden="true" />
              Put on hold
            </Button>
          ) : undefined
        }
      />
      {(onHold || error || message || past.length > 0) && (
        <CardBody className="space-y-4">
          {onHold && (
            <div>
              <h3 className="text-xs font-medium tracking-wide text-muted uppercase">Reason</h3>
              {editing ? (
                <ReasonForm vacancyId={vacancyId} reason={parkReason ?? ""} onDone={() => setEditing(false)} />
              ) : (
                <p className="mt-1 text-sm whitespace-pre-line text-ink">
                  {parkReason}{" "}
                  <button type="button" onClick={() => setEditing(true)} className="text-xs font-medium text-brand-700 hover:underline">
                    Change
                  </button>
                </p>
              )}
            </div>
          )}
          {past.length > 0 && (
            <div>
              <h3 className="text-xs font-medium tracking-wide text-muted uppercase">Earlier on hold ({days(summary.total - (summary.current ?? 0))})</h3>
              <ul className="mt-2 space-y-1.5 text-sm">
                {past.map((h, i) => (
                  <li key={h.id ?? i} className="text-ink">
                    <span className="tabular-nums text-muted">
                      {formatDate(h.started_on)} to {formatDate(h.ended_on)}
                    </span>
                    {h.reason ? `: ${h.reason}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <FormMessage error={error} success={message} />
        </CardBody>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Put vacancy on hold">
        {open && <HoldForm vacancyId={vacancyId} hasCompany={hasCompany} onDone={() => setOpen(false)} />}
      </Modal>
    </Card>
  );
}

function ReasonForm({ vacancyId, reason, onDone }: { vacancyId: string; reason: string; onDone: () => void }) {
  const id = useId();
  const [state, formAction] = useActionState(updateHoldReason, initialActionState);
  useEffect(() => {
    if (state.ok) onDone();
  }, [state, onDone]);
  return (
    <form action={formAction} className="mt-2 space-y-3">
      <input type="hidden" name="vacancy_id" value={vacancyId} />
      <Field label="Reason" htmlFor={`${id}-reason`} required error={state.fieldErrors?.park_reason ?? state.error}>
        <Textarea id={`${id}-reason`} name="park_reason" rows={3} maxLength={2000} defaultValue={reason} required autoFocus />
      </Field>
      <div className="flex gap-2 sm:justify-end">
        <Button variant="secondary" size="sm" onClick={onDone}>
          Cancel
        </Button>
        <SubmitButton size="sm" pendingLabel="Saving">
          Save
        </SubmitButton>
      </div>
    </form>
  );
}

function HoldForm({ vacancyId, hasCompany, onDone }: { vacancyId: string; hasCompany: boolean; onDone: () => void }) {
  const id = useId();
  const [state, formAction] = useActionState(parkVacancy, initialActionState);
  const [parkCompany, setParkCompany] = useState(false);
  useEffect(() => {
    if (state.ok) onDone();
  }, [state, onDone]);
  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="vacancy_id" value={vacancyId} />
      <FormMessage error={state.error} />
      <Field label="Reason" htmlFor={`${id}-reason`} required hint="Shown on the vacancy and the board." error={state.fieldErrors?.park_reason}>
        <Textarea
          id={`${id}-reason`}
          name="park_reason"
          rows={3}
          maxLength={2000}
          required
          placeholder="For example: client freezes hiring until January."
          autoFocus
        />
      </Field>
      <Field label="On hold since" htmlFor={`${id}-start`} required hint="Today, or the day the client paused." error={state.fieldErrors?.hold_start}>
        <Input id={`${id}-start`} name="hold_start" type="date" max={todayIso()} defaultValue={todayIso()} required />
      </Field>
      {hasCompany && (
        <div className="space-y-3 rounded-xl border border-border bg-surface/50 p-3">
          <label className="flex items-start gap-2.5 text-sm">
            <input type="checkbox" checked={parkCompany} onChange={(e) => setParkCompany(e.target.checked)} className="mt-0.5 size-4 accent-brand-700" />
            <span>
              <span className="font-medium text-ink">Also park the company in the sales pipeline</span>
              <span className="block text-xs text-muted">Stage Parked, back as a next action on the date you choose.</span>
            </span>
          </label>
          {parkCompany && (
            <Field label="Get in touch again on" htmlFor={`${id}-until`} required error={state.fieldErrors?.park_company_until}>
              <Input id={`${id}-until`} name="park_company_until" type="date" min={todayIso()} required />
            </Field>
          )}
        </div>
      )}
      <div className="flex gap-3 max-sm:*:flex-1 sm:justify-end">
        <Button variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <SubmitButton pendingLabel="Saving">
          <PauseCircle aria-hidden="true" />
          Put on hold
        </SubmitButton>
      </div>
    </form>
  );
}
