"use client";

import { useState, type FormEvent } from "react";
import { LoaderCircle } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input, Select, Textarea } from "@/components/ui/field";
import { defaultNotNowDate, nextSteps, outcomeProblem, wrongPersonReasons, type OutcomeFields } from "@/lib/sales/call-outcome";
import type { CallOptions } from "@/lib/sales/call-session";
import type { CallOutcome } from "@/lib/sales/database";
import { todayIso } from "@/lib/format";
import { WRONG_MOMENT } from "@/lib/sales/labels";

// The small follow-up window of a call outcome (feedback Julius, 813e214d):
// every outcome except No answer asks what it needs, and only Save logs the
// call and opens the next contact. A separate component so the call sheet can
// use the same window: give it the outcome, who is called and what to do on
// Save. The server checks the same rules (outcomeProblem).

export type OutcomeDialogProps = {
  /** The outcome to ask about; null keeps the window closed. */
  outcome: CallOutcome | null;
  /** The label of the outcome button (the list can rename it). */
  outcomeLabel: string;
  /** Who is called, for the title. */
  contactName: string;
  companyName: string;
  /** Reasons for a "no" and who can own a next step; without them the reasons list is empty. */
  options?: CallOptions;
  /** The Cal.com links for Meeting planned (who the meeting is with); with more than one the caller picks. */
  bookingLinks?: { id: string; label: string }[];
  /** A note typed before the window opened. */
  initialNote?: string;
  /** True while the call is being saved. */
  pending: boolean;
  /** What went wrong on the server, shown in the window. */
  error?: string;
  /** "side" opens the window as a panel against the right edge (the call sheet); the call screen keeps it centred. */
  placement?: "center" | "side";
  /** Called with everything filled in; the caller adds the contact and logs the call. */
  onSave: (fields: OutcomeFields) => void;
  onClose: () => void;
};

const hints: Partial<Record<CallOutcome, string>> = {
  call_back: "Say when and with whom, so the call back is on time.",
  reached_interested: "What are they interested in, what happens next and when?",
  meeting_planned: "Save opens the calendar. The meeting only counts once the booking is made; until then the lead stays open.",
  reached_not_interested: "Pick at least one reason, or write it in your own words.",
  not_interested_person:
    "Only this person said no (not my call, no time for this). Only this contact is blocked; the next contact of the company follows. In doubt between person and company? Then it is the company.",
  not_interested_company:
    "The company is not interested. It is not approached for three months, and after that preferably via another channel. A new vacancy before then means a personal follow up, not a campaign.",
  not_now: "Not now: the company waits until the date they named, otherwise three months, and then gets a personal follow up.",
  do_not_contact: "Angry or asked to be removed: the company goes to do not contact, for good. Only an admin can turn it back.",
  referred: "The referred person becomes the next contact you call.",
  wrong_person: "If you know who the right person is, add them: they become a contact.",
  wrong_number: "If you know the right number, add it.",
};

/** Colours of the outcome buttons, by the tone of the outcome (shared by the call screen and the call sheet). */
export const outcomeToneClasses: Record<string, string> = {
  success: "border-emerald-600/30 bg-emerald-50 text-emerald-800 hover:bg-emerald-100",
  danger: "border-danger/30 bg-danger-bg text-danger hover:bg-danger/10",
  warning: "border-amber-600/30 bg-amber-50 text-amber-800 hover:bg-amber-100",
  brand: "border-brand-200 bg-brand-50 text-brand-800 hover:bg-brand-100",
  neutral: "border-border bg-white text-ink hover:bg-surface",
  accent: "border-accent-500/30 bg-accent-100 text-brand-900 hover:bg-accent-100/70",
};

export function OutcomeDialog({ outcome, outcomeLabel, contactName, companyName, placement, ...rest }: OutcomeDialogProps) {
  return (
    <Modal
      open={outcome !== null}
      placement={placement}
      onClose={rest.onClose}
      title={outcomeLabel}
      description={`${contactName}${companyName ? ` at ${companyName}` : ""}`}
    >
      {/* Remounted per outcome, so a window never starts with the last one's answers. */}
      {outcome && <OutcomeForm key={outcome} outcome={outcome} {...rest} />}
    </Modal>
  );
}

function OutcomeForm({
  outcome,
  options,
  bookingLinks = [],
  initialNote = "",
  pending,
  error,
  onSave,
  onClose,
}: Omit<OutcomeDialogProps, "outcome" | "outcomeLabel" | "contactName" | "companyName" | "placement"> & { outcome: CallOutcome }) {
  const today = todayIso();
  const [fields, setFields] = useState<OutcomeFields>({
    outcome,
    note: initialNote,
    reasons: [],
    nextOwner: options?.me ?? null,
    until: outcome === "not_now" ? defaultNotNowDate(today) : null,
  });
  const [later, setLater] = useState(false);
  const [problem, setProblem] = useState<string>();
  const set = (patch: Partial<OutcomeFields>) => setFields((f) => ({ ...f, ...patch }));
  const reasons = fields.reasons ?? [];
  const parksCompany = reasons.includes(WRONG_MOMENT);
  const asksDate = parksCompany || later;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    const ready: OutcomeFields = {
      ...fields,
      until: (outcome === "reached_not_interested" && asksDate) || outcome === "not_now" ? fields.until : null,
    };
    const found = outcomeProblem(ready, today);
    setProblem(found ?? undefined);
    if (!found) onSave(ready);
  }

  const note = (label = "Note (optional)", required = false) => (
    <Field label={label} htmlFor="outcome-note" required={required}>
      <Textarea
        id="outcome-note"
        rows={2}
        maxLength={5000}
        value={fields.note ?? ""}
        onChange={(e) => set({ note: e.target.value })}
        placeholder="What was said, who to ask for, the best time to call"
      />
    </Field>
  );

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {hints[outcome] && <p className="text-sm text-muted">{hints[outcome]}</p>}

      {outcome === "call_back" && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Call back on" htmlFor="cb-date" required>
              <Input id="cb-date" type="date" min={today} value={fields.callbackAt ?? ""} onChange={(e) => set({ callbackAt: e.target.value })} />
            </Field>
            <Field label="At" htmlFor="cb-time" required>
              <Input id="cb-time" type="time" value={fields.callbackTime ?? ""} onChange={(e) => set({ callbackTime: e.target.value })} />
            </Field>
          </div>
          <Field label="Ask for (optional)" htmlFor="cb-with">
            <Input id="cb-with" maxLength={200} value={fields.callbackWith ?? ""} onChange={(e) => set({ callbackWith: e.target.value })} placeholder="Name of the person to call back" />
          </Field>
          {note()}
        </>
      )}

      {outcome === "reached_interested" && (
        <>
          <Field label="What are they interested in?" htmlFor="int-what">
            <Textarea id="int-what" rows={2} maxLength={1000} value={fields.interest ?? ""} onChange={(e) => set({ interest: e.target.value })} placeholder="Roles, number of developers, timing" />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Next step" htmlFor="int-step" required>
              <Select id="int-step" value={fields.nextStep ?? ""} onChange={(e) => set({ nextStep: (e.target.value || null) as OutcomeFields["nextStep"] })}>
                <option value="">Pick a step</option>
                {nextSteps.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="When" htmlFor="int-when" required>
              <Input id="int-when" type="date" min={today} value={fields.nextStepAt ?? ""} onChange={(e) => set({ nextStepAt: e.target.value })} />
            </Field>
          </div>
          {options && options.owners.length > 0 && (
            <Field label="Who does it" htmlFor="int-owner">
              <Select id="int-owner" value={fields.nextOwner ?? ""} onChange={(e) => set({ nextOwner: e.target.value || null })}>
                <option value="">Nobody yet</option>
                {options.owners.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.id === options.me ? `${o.name} (me)` : o.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {note()}
        </>
      )}

      {outcome === "meeting_planned" && (
        <>
          <Field label="What is the meeting about?" htmlFor="mt-reason" required>
            <Textarea id="mt-reason" rows={2} maxLength={1000} value={fields.meetingReason ?? ""} onChange={(e) => set({ meetingReason: e.target.value })} placeholder="For example: two Python developers, start in January" />
          </Field>
          {bookingLinks.length > 1 && (
            <Field label="Meeting with" htmlFor="mt-with">
              <Select id="mt-with" value={fields.bookingLinkId ?? bookingLinks[0].id} onChange={(e) => set({ bookingLinkId: e.target.value })}>
                {bookingLinks.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {note()}
        </>
      )}

      {outcome === "reached_not_interested" && (
        <>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-ink">
              Why not?<span className="ml-0.5 text-danger" aria-hidden="true">*</span>
            </legend>
            {(options?.reasons ?? []).length === 0 && <p className="text-sm text-muted">No reasons to pick from; write it below.</p>}
            <div className="grid gap-2 sm:grid-cols-2">
              {(options?.reasons ?? []).map((r) => (
                <label
                  key={r.value}
                  className={`flex min-h-11 cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2 text-sm ${
                    reasons.includes(r.value) ? "border-brand-500 bg-brand-50" : "border-border bg-white"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="size-4 accent-brand-600"
                    checked={reasons.includes(r.value)}
                    onChange={(e) => set({ reasons: e.target.checked ? [...reasons, r.value] : reasons.filter((x) => x !== r.value) })}
                  />
                  <span>
                    {r.label}
                    {r.description && <span className="block text-xs text-muted">{r.description}</span>}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <Field label="In their own words" htmlFor="no-text" hint="Use this when the reason is not in the list, or to add detail.">
            <Textarea id="no-text" rows={2} maxLength={2000} value={fields.reasonText ?? ""} onChange={(e) => set({ reasonText: e.target.value })} />
          </Field>
          <div className="space-y-2 rounded-xl border border-border p-3">
            <label className="flex cursor-pointer items-center gap-2.5 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-brand-600"
                checked={asksDate}
                disabled={parksCompany}
                onChange={(e) => setLater(e.target.checked)}
              />
              <span>
                May we get back to them later?
                <span className="block text-xs text-muted">The company is parked until that date instead of closed.</span>
              </span>
            </label>
            {asksDate && (
              <Field label="Get back in touch on" htmlFor="no-until" required>
                <Input id="no-until" type="date" min={today} value={fields.until ?? ""} onChange={(e) => set({ until: e.target.value })} />
              </Field>
            )}
          </div>
        </>
      )}

      {(outcome === "not_interested_person" || outcome === "not_interested_company" || outcome === "do_not_contact") &&
        note("Short note: what did they say?", true)}

      {outcome === "not_now" && (
        <>
          <Field label="Get back in touch on" htmlFor="nn-until" hint="The date they named; three months from today when they named none." required>
            <Input id="nn-until" type="date" min={today} value={fields.until ?? ""} onChange={(e) => set({ until: e.target.value })} />
          </Field>
          {note("Short note: what did they say?", true)}
        </>
      )}

      {outcome === "referred" && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" htmlFor="ref-name" required>
              <Input id="ref-name" maxLength={200} value={fields.referredName ?? ""} onChange={(e) => set({ referredName: e.target.value })} />
            </Field>
            <Field label="Job title" htmlFor="ref-title">
              <Input id="ref-title" maxLength={200} value={fields.referredTitle ?? ""} onChange={(e) => set({ referredTitle: e.target.value })} />
            </Field>
            <Field label="Phone" htmlFor="ref-phone">
              <Input id="ref-phone" type="tel" maxLength={50} value={fields.referredPhone ?? ""} onChange={(e) => set({ referredPhone: e.target.value })} />
            </Field>
            <Field label="Mail" htmlFor="ref-mail">
              <Input id="ref-mail" type="email" maxLength={200} value={fields.referredEmail ?? ""} onChange={(e) => set({ referredEmail: e.target.value })} />
            </Field>
          </div>
          {note()}
        </>
      )}

      {outcome === "wrong_person" && (
        <>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-ink">What is the case?</legend>
            {wrongPersonReasons.map((r) => (
              <label key={r.value} className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-xl border border-border px-3 py-2 text-sm">
                <input
                  type="radio"
                  name="wrong-reason"
                  className="size-4 accent-brand-600"
                  checked={fields.wrongReason === r.value}
                  onChange={() => set({ wrongReason: r.value })}
                />
                {r.label}
              </label>
            ))}
          </fieldset>
          <p className="text-sm font-medium text-ink">Who is the right person? (if known)</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" htmlFor="wp-name">
              <Input id="wp-name" maxLength={200} value={fields.referredName ?? ""} onChange={(e) => set({ referredName: e.target.value })} />
            </Field>
            <Field label="Job title" htmlFor="wp-title">
              <Input id="wp-title" maxLength={200} value={fields.referredTitle ?? ""} onChange={(e) => set({ referredTitle: e.target.value })} />
            </Field>
            <Field label="Phone" htmlFor="wp-phone">
              <Input id="wp-phone" type="tel" maxLength={50} value={fields.referredPhone ?? ""} onChange={(e) => set({ referredPhone: e.target.value })} />
            </Field>
            <Field label="Mail" htmlFor="wp-mail">
              <Input id="wp-mail" type="email" maxLength={200} value={fields.referredEmail ?? ""} onChange={(e) => set({ referredEmail: e.target.value })} />
            </Field>
          </div>
          {note()}
        </>
      )}

      {outcome === "wrong_number" && (
        <>
          <Field label="The right number (if known)" htmlFor="wn-phone">
            <Input id="wn-phone" type="tel" maxLength={50} value={fields.newPhone ?? ""} onChange={(e) => set({ newPhone: e.target.value })} />
          </Field>
          {note()}
        </>
      )}

      {outcome === "no_answer" && note()}

      <FormMessage error={problem ?? error} />

      <div className="flex flex-wrap justify-end gap-2 max-sm:*:flex-1">
        <Button variant="secondary" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />}
          {outcome === "meeting_planned" && bookingLinks.length > 0 ? "Save and open calendar" : "Save"}
        </Button>
      </div>
    </form>
  );
}
