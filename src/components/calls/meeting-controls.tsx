"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { Check, CalendarPlus, LoaderCircle, Search, ThumbsDown, ThumbsUp, UserX, X } from "lucide-react";
import { type ActionState, initialActionState } from "@/lib/action-state";
import type { MeetingStatus } from "@/lib/sales/database";
import { todayIso } from "@/lib/format";
import {
  type CompanyHit,
  addMeeting,
  searchMeetingCompanies,
  setMeetingStatus,
  updateMeetingFee,
} from "@/app/dashboard/meetings/actions";
import { PendingSubmit, submitWithoutReset } from "@/components/placements/form-utils";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input, Select, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { SearchSelect } from "@/components/ui/search-select";

/** Mark held or no show, approve or reject (admins), and the fee (admins). */
export function MeetingActions({
  meetingId,
  status,
  fee,
  isAdmin,
}: {
  meetingId: string;
  status: MeetingStatus;
  fee: number;
  isAdmin: boolean;
}) {
  const [result, setResult] = useState<ActionState>({});
  const [pending, startTransition] = useTransition();
  const [editingFee, setEditingFee] = useState(false);
  const [feeValue, setFeeValue] = useState(String(fee));

  function run(fn: () => Promise<ActionState>) {
    setResult({});
    startTransition(async () => {
      const r = await fn();
      setResult(r.error ? r : {});
      if (r.ok) setEditingFee(false);
    });
  }

  const set = (s: MeetingStatus) => () => run(() => setMeetingStatus(meetingId, s));

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1.5 pointer-coarse:[&_button]:min-h-10">
        {status === "planned" && (
          <>
            <Button size="sm" variant="secondary" onClick={set("held")} disabled={pending}>
              <Check aria-hidden="true" />
              Held
            </Button>
            <Button size="sm" variant="ghost" onClick={set("no_show")} disabled={pending}>
              <UserX aria-hidden="true" />
              No show
            </Button>
            <Button size="sm" variant="ghost" onClick={set("cancelled")} disabled={pending}>
              <X aria-hidden="true" />
              Cancel
            </Button>
          </>
        )}
        {isAdmin && (status === "held" || status === "planned" || status === "no_show") && (
          <>
            <Button size="sm" onClick={set("approved")} disabled={pending}>
              <ThumbsUp aria-hidden="true" />
              Approve
            </Button>
            <Button size="sm" variant="ghost" onClick={set("rejected")} disabled={pending}>
              <ThumbsDown aria-hidden="true" />
              Reject
            </Button>
          </>
        )}
        {(status === "no_show" || status === "cancelled" || (isAdmin && (status === "approved" || status === "rejected"))) && (
          <Button size="sm" variant="ghost" onClick={set(status === "approved" || status === "rejected" ? "held" : "planned")} disabled={pending}>
            Undo
          </Button>
        )}
        {isAdmin && !editingFee && (
          <Button size="sm" variant="ghost" onClick={() => setEditingFee(true)} disabled={pending}>
            Fee
          </Button>
        )}
        {pending && <LoaderCircle className="size-4 animate-spin self-center text-muted" aria-hidden="true" />}
      </div>
      {editingFee && (
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => updateMeetingFee(meetingId, feeValue));
          }}
        >
          <label htmlFor={`fee-${meetingId}`} className="sr-only">
            Fee in EUR
          </label>
          <Input id={`fee-${meetingId}`} inputMode="decimal" value={feeValue} onChange={(e) => setFeeValue(e.target.value)} className="w-24" />
          <Button size="sm" type="submit" disabled={pending}>
            Save
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditingFee(false)}>
            Cancel
          </Button>
        </form>
      )}
      {result.error && <p className="text-xs text-danger">{result.error}</p>}
    </div>
  );
}

/** Add a meeting by hand: company (search), contact, caller, date, time and the reason of the call. */
export function AddMeetingButton({ callers }: { callers: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  return (
    <>
      <Button
        onClick={() => {
          setAttempt((n) => n + 1);
          setOpen(true);
        }}
      >
        <CalendarPlus aria-hidden="true" />
        Add meeting
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Add meeting" description="For a meeting that was not planned on the call screen or in Cal.com.">
        <AddMeetingForm key={attempt} callers={callers} onDone={() => setOpen(false)} />
      </Modal>
    </>
  );
}

function AddMeetingForm({ callers, onDone }: { callers: { id: string; name: string }[]; onDone: () => void }) {
  const [state, formAction, pending] = useActionState(addMeeting, initialActionState);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<CompanyHit[]>([]);
  const [company, setCompany] = useState<CompanyHit | null>(null);
  const [searching, startSearch] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const errors = state.fieldErrors ?? {};

  useEffect(() => {
    if (state.ok) onDone();
  }, [state, onDone]);

  function search(value: string) {
    setQuery(value);
    clearTimeout(timer.current);
    if (value.trim().length < 2) {
      setHits([]);
      return;
    }
    timer.current = setTimeout(() => {
      startSearch(async () => setHits(await searchMeetingCompanies(value)));
    }, 250);
  }

  return (
    <form onSubmit={submitWithoutReset(formAction)} className="space-y-5" noValidate>
      <FormMessage error={state.error} />
      {company ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2 text-sm">
          <span>
            <span className="font-medium text-ink">{company.name}</span>
            {company.city && <span className="text-muted"> · {company.city}</span>}
          </span>
          <Button size="sm" variant="ghost" onClick={() => setCompany(null)}>
            Change
          </Button>
          <input type="hidden" name="company_id" value={company.id} />
        </div>
      ) : (
        <Field label="Company" htmlFor="meeting-company" required error={errors.company_id}>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
            <Input
              id="meeting-company"
              value={query}
              onChange={(e) => search(e.target.value)}
              placeholder="Search by name or website"
              className="pl-9"
              autoComplete="off"
            />
            {searching && <LoaderCircle className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted" aria-hidden="true" />}
          </div>
          {hits.length > 0 && (
            <ul className="mt-1 max-h-56 overflow-y-auto rounded-xl border border-border">
              {hits.map((h) => (
                <li key={h.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setCompany(h);
                      setHits([]);
                    }}
                    className="flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-brand-50"
                  >
                    <span className="font-medium text-ink">{h.name}</span>
                    <span className="text-xs text-muted">{h.city}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Field>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Contact" htmlFor="meeting-contact">
          <SearchSelect
            key={company?.id ?? "none"}
            id="meeting-contact"
            name="contact_id"
            disabled={!company}
            placeholder="No contact"
            searchPlaceholder="Search contacts"
            options={(company?.contacts ?? []).map((c) => ({ value: c.id, label: c.name, hint: c.title ?? undefined }))}
          />
        </Field>
        <Field label="Caller" htmlFor="meeting-caller" hint="The caller earns their fee once the meeting is approved.">
          <Select id="meeting-caller" name="caller_id" defaultValue="">
            <option value="">No caller (the team)</option>
            {callers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Date" htmlFor="meeting-date" required error={errors.date}>
          <Input id="meeting-date" name="date" type="date" defaultValue={todayIso()} required />
        </Field>
        <Field label="Time (Amsterdam)" htmlFor="meeting-time" error={errors.time}>
          <Input id="meeting-time" name="time" type="time" defaultValue="10:00" />
        </Field>
      </div>
      <Field label="Reason of the call" htmlFor="meeting-reason" error={errors.reason}>
        <Textarea id="meeting-reason" name="reason" rows={3} maxLength={2000} placeholder="For example: two Python developers, start in January" />
      </Field>
      <div className="flex justify-end max-sm:*:w-full">
        <PendingSubmit pending={pending} pendingLabel="Saving" disabled={!company}>
          Add meeting
        </PendingSubmit>
      </div>
    </form>
  );
}
