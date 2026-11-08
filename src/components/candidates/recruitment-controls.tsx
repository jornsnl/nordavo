"use client";

import { useActionState, useEffect, useId, useState, useTransition } from "react";
import { LoaderCircle, PauseCircle, PlayCircle, Star, StarOff } from "lucide-react";
import { parkCandidate, unparkCandidate } from "@/app/dashboard/candidates/[id]/park-actions";
import { setTopper } from "@/app/dashboard/vacancies/[id]/pipeline/recruitment-actions";
import { initialActionState } from "@/lib/action-state";
import type { ApplicationStage } from "@/lib/database.types";
import { formatDate } from "@/lib/format";
import { applicationStages, optionFor } from "@/lib/labels";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { SubmitButton } from "@/components/ui/submit-button";

// ---------------------------------------------------------------------------
// Topper (2.13)
// ---------------------------------------------------------------------------

export function TopperControl({
  candidateId,
  name,
  isTopper,
  reason,
  byName,
  at,
}: {
  candidateId: string;
  name: string;
  isTopper: boolean;
  reason: string | null;
  byName: string | null;
  at: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(setTopper, initialActionState);

  return (
    <div className="space-y-3">
      {isTopper ? (
        <div className="rounded-xl border border-amber-600/20 bg-amber-50 p-3">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-amber-900">
            <Star className="size-4 fill-amber-400 text-amber-500" aria-hidden="true" />
            Topper
          </p>
          <p className="mt-1 text-sm whitespace-pre-line text-ink">{reason}</p>
          <p className="mt-1 text-xs text-muted">
            Marked by {byName ?? "the team"}
            {at ? ` on ${formatDate(at)}` : ""}. Stays on the candidate for every vacancy.
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted">
          Mark someone as a topper when, after video, screening, CV score, test and interview, we really trust them.
        </p>
      )}
      <FormMessage error={state.error} success={state.ok ? state.message : undefined} />
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
          <Star aria-hidden="true" />
          {isTopper ? "Change reason" : "Mark as topper"}
        </Button>
        {isTopper && (
          <form action={formAction}>
            <input type="hidden" name="candidate_id" value={candidateId} />
            <input type="hidden" name="is_topper" value="false" />
            <SubmitButton variant="ghost" size="sm" pendingLabel="Removing">
              <StarOff aria-hidden="true" />
              Remove mark
            </SubmitButton>
          </form>
        )}
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title="Mark as topper" description={name}>
        {open && <TopperForm candidateId={candidateId} reason={reason} onDone={() => setOpen(false)} />}
      </Modal>
    </div>
  );
}

function TopperForm({ candidateId, reason, onDone }: { candidateId: string; reason: string | null; onDone: () => void }) {
  const id = useId();
  const [state, formAction] = useActionState(setTopper, initialActionState);
  useEffect(() => {
    if (state.ok) onDone();
  }, [state, onDone]);
  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="candidate_id" value={candidateId} />
      <input type="hidden" name="is_topper" value="true" />
      <FormMessage error={state.fieldErrors?.topper_reason ? undefined : state.error} />
      <Field label="Why" htmlFor={`${id}-reason`} required error={state.fieldErrors?.topper_reason} hint="A short reason, for the next client.">
        <Textarea
          id={`${id}-reason`}
          name="topper_reason"
          rows={3}
          maxLength={1000}
          required
          defaultValue={reason ?? ""}
          placeholder="For example: excellent English, 4 years Python, strong test."
          autoFocus
        />
      </Field>
      <div className="flex gap-3 max-sm:*:flex-1 sm:justify-end">
        <Button variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <SubmitButton pendingLabel="Saving">
          <Star aria-hidden="true" />
          Mark as topper
        </SubmitButton>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Parking a candidate (2.3)
// ---------------------------------------------------------------------------

export type ParkableApplication = { id: string; vacancyTitle: string; stage: ApplicationStage };

export function ParkCandidateControl({
  candidateId,
  name,
  parked,
  reason,
  parkedAt,
  activeApplications,
}: {
  candidateId: string;
  name: string;
  parked: boolean;
  reason: string | null;
  parkedAt: string | null;
  activeApplications: ParkableApplication[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();

  return (
    <div className="space-y-3">
      {parked ? (
        <div className="rounded-xl border border-amber-600/20 bg-amber-50 p-3">
          <p className="text-sm font-semibold text-amber-900">Parked{parkedAt ? ` since ${formatDate(parkedAt)}` : ""}</p>
          <p className="mt-1 text-sm whitespace-pre-line text-ink">{reason || <span className="text-muted">No reason given.</span>}</p>
        </div>
      ) : (
        <p className="text-sm text-muted">Often handier than rejecting: park the candidate with a reason and pick them up later.</p>
      )}
      <FormMessage error={error} />
      {parked ? (
        <Button
          variant="secondary"
          size="sm"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await unparkCandidate(candidateId);
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
          Park candidate
        </Button>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Park candidate" description={name}>
        {open && (
          <ParkForm candidateId={candidateId} activeApplications={activeApplications} onDone={() => setOpen(false)} />
        )}
      </Modal>
    </div>
  );
}

function ParkForm({
  candidateId,
  activeApplications,
  onDone,
}: {
  candidateId: string;
  activeApplications: ParkableApplication[];
  onDone: () => void;
}) {
  const id = useId();
  const [state, formAction] = useActionState(parkCandidate, initialActionState);
  const [alsoApplications, setAlsoApplications] = useState(activeApplications.length > 0);
  useEffect(() => {
    if (state.ok) onDone();
  }, [state, onDone]);

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="candidate_id" value={candidateId} />
      <FormMessage error={state.error} />
      <Field label="Reason" htmlFor={`${id}-reason`} hint="Optional." error={state.fieldErrors?.park_reason}>
        <Textarea
          id={`${id}-reason`}
          name="park_reason"
          rows={3}
          maxLength={2000}
          placeholder="For example: wants to stay at the current employer until March."
          autoFocus
        />
      </Field>
      {activeApplications.length > 0 && (
        <div className="space-y-3 rounded-xl border border-border bg-surface/60 p-3">
          <label className="flex items-start gap-2 text-sm text-ink">
            <input
              type="checkbox"
              name="park_applications"
              checked={alsoApplications}
              onChange={(e) => setAlsoApplications(e.target.checked)}
              className="mt-0.5 size-4 accent-brand-600"
            />
            <span>
              Also park {activeApplications.length === 1 ? "the active application" : `the ${activeApplications.length} active applications`}
              <ul className="mt-1 list-disc pl-5 text-xs text-muted">
                {activeApplications.map((a) => (
                  <li key={a.id}>
                    {a.vacancyTitle}, {optionFor(applicationStages, a.stage).label}
                  </li>
                ))}
              </ul>
            </span>
          </label>
          {alsoApplications && (
            <Field label="Look again on" htmlFor={`${id}-until`} hint="Optional, shown on the parked cards." error={state.fieldErrors?.park_until}>
              <Input id={`${id}-until`} name="park_until" type="date" />
            </Field>
          )}
        </div>
      )}
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
