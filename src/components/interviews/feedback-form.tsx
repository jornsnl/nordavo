"use client";

import { useActionState } from "react";
import { initialActionState, type ActionState } from "@/lib/action-state";
import { Field, FormMessage, Select, Textarea } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";

const scores = [
  { value: "5", label: "5, excellent" },
  { value: "4", label: "4, good" },
  { value: "3", label: "3, fair" },
  { value: "2", label: "2, weak" },
  { value: "1", label: "1, poor" },
];

/** Feedback of the interviewer after the interview (2.14). */
export function InterviewFeedbackForm({
  action,
  interviewId,
  status,
  rating,
  communication,
  feedback,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  interviewId: string;
  status: string;
  rating: number | null;
  communication: number | null;
  feedback: string | null;
}) {
  const [state, formAction] = useActionState(action, initialActionState);
  const errors = state.fieldErrors ?? {};
  const id = (field: string) => `${field}-${interviewId}`;

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <FormMessage error={state.error} success={state.ok ? state.message : undefined} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Outcome" htmlFor={id("status")} error={errors.status}>
          <Select id={id("status")} name="status" defaultValue={status === "no_show" ? "no_show" : "done"}>
            <option value="done">Held</option>
            <option value="no_show">No show</option>
          </Select>
        </Field>
        <Field label="Overall rating" htmlFor={id("rating")} error={errors.rating}>
          <Select id={id("rating")} name="rating" defaultValue={rating ? String(rating) : ""}>
            <option value="">Not rated</option>
            {scores.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Communication" htmlFor={id("communication")} error={errors.communication}>
          <Select id={id("communication")} name="communication" defaultValue={communication ? String(communication) : ""}>
            <option value="">Not rated</option>
            {scores.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Notes" htmlFor={id("feedback")} error={errors.feedback} hint="Skills, project experience, English, LinkedIn profile, salary wish.">
        <Textarea id={id("feedback")} name="feedback" rows={4} maxLength={5000} defaultValue={feedback ?? ""} />
      </Field>
      <div className="flex justify-end max-sm:*:w-full">
        <SubmitButton size="sm" pendingLabel="Saving">
          Save feedback
        </SubmitButton>
      </div>
    </form>
  );
}
