"use client";

import { useActionState, useState } from "react";
import { CalendarPlus, Copy } from "lucide-react";
import { initialActionState } from "@/lib/action-state";
import type { InterviewerOption } from "@/lib/data/interviews";
import { interviewKinds } from "@/lib/recruitment/interviews";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input, Select } from "@/components/ui/field";
import { SearchSelect } from "@/components/ui/search-select";
import { Modal } from "@/components/ui/modal";
import { SubmitButton } from "@/components/ui/submit-button";
import { planInterview, type PlanInterviewState } from "./actions";

export type PlanApplicationOption = { id: string; label: string };

/**
 * "Plan interview" (2.14): pick the vacancy (application), the interviewer
 * and the type. Usable on the candidate page and, with one application, on
 * a pipeline card: pass applications=[{ id, label }].
 */
export function PlanInterviewButton({
  applications,
  interviewers,
  size = "sm",
}: {
  applications: PlanApplicationOption[];
  interviewers: InterviewerOption[];
  size?: "sm" | "md";
}) {
  const [open, setOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);

  return (
    <>
      <Button
        size={size}
        variant="secondary"
        disabled={applications.length === 0}
        title={applications.length === 0 ? "Link the candidate to a vacancy first" : undefined}
        onClick={() => {
          setFormKey((k) => k + 1);
          setOpen(true);
        }}
      >
        <CalendarPlus aria-hidden="true" />
        Plan interview
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Plan interview"
        description="The candidate gets a mail with the interviewer's Cal.com link and picks a time from their availability."
      >
        <PlanInterviewForm key={formKey} applications={applications} interviewers={interviewers} onClose={() => setOpen(false)} />
      </Modal>
    </>
  );
}

function PlanInterviewForm({
  applications,
  interviewers,
  onClose,
}: {
  applications: PlanApplicationOption[];
  interviewers: InterviewerOption[];
  onClose: () => void;
}) {
  const [state, formAction] = useActionState<PlanInterviewState, FormData>(planInterview, initialActionState);
  const [copied, setCopied] = useState(false);
  const errors = state.fieldErrors ?? {};
  const withLink = interviewers.filter((i) => i.hasLink);

  if (state.ok) {
    return (
      <div className="space-y-5">
        <FormMessage success={state.message} />
        {state.inviteUrl && (
          <Field label="Booking link for this candidate" htmlFor="invite-url">
            <div className="flex gap-2">
              <Input id="invite-url" readOnly value={state.inviteUrl} onFocus={(e) => e.currentTarget.select()} />
              <Button
                variant="secondary"
                onClick={() => {
                  navigator.clipboard?.writeText(state.inviteUrl ?? "").then(() => setCopied(true), () => setCopied(false));
                }}
              >
                <Copy aria-hidden="true" />
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
          </Field>
        )}
        <div className="flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    );
  }

  if (withLink.length === 0) {
    return (
      <p className="rounded-xl border border-amber-600/20 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        No interviewer has a Cal.com booking link yet. Each interviewer adds their own link in Settings, under
        Interviews (for example https://cal.com/judith/interview). Then plan the interview here.
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <FormMessage error={state.error} />
      {applications.length > 1 ? (
        <Field label="Vacancy" htmlFor="plan-application" required error={errors.application_id}>
          <SearchSelect
            id="plan-application"
            name="application_id"
            defaultValue={applications[0]?.id ?? null}
            required
            allowClear={false}
            searchPlaceholder="Search vacancies"
            options={applications.map((a) => ({ value: a.id, label: a.label }))}
          />
        </Field>
      ) : (
        <input type="hidden" name="application_id" value={applications[0]?.id ?? ""} />
      )}
      <Field
        label="Interviewer"
        htmlFor="plan-interviewer"
        required
        error={errors.interviewer_id}
        hint="Only team members with a booking link in Settings can be picked."
      >
        <Select id="plan-interviewer" name="interviewer_id" defaultValue={withLink[0]?.id}>
          {interviewers.map((i) => (
            <option key={i.id} value={i.id} disabled={!i.hasLink}>
              {i.name}
              {i.hasLink ? "" : " (no booking link)"}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Type" htmlFor="plan-kind" required error={errors.kind}>
        <Select id="plan-kind" name="kind" defaultValue="interview">
          {interviewKinds.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </Select>
      </Field>
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <SubmitButton pendingLabel="Sending">Send invitation</SubmitButton>
      </div>
    </form>
  );
}
