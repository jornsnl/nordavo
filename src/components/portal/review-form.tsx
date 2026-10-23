"use client";

import { useActionState, useState } from "react";
import { Check, Pencil, X } from "lucide-react";
import { reviewApplication } from "@/app/portaal/vacatures/[id]/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Textarea } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { type ActionState, initialActionState } from "@/lib/action-state";
import type { ClientDecision } from "@/lib/database.types";
import { portalDecisionLabels } from "./labels";

export function ReviewForm({
  applicationId,
  candidateName,
  decision,
  feedback,
  decidedAtLabel,
  canChange,
}: {
  applicationId: string;
  candidateName: string;
  decision: ClientDecision;
  feedback: string | null;
  /** Already formatted on the server, e.g. "3 nov. 14:20". */
  decidedAtLabel: string | null;
  canChange: boolean;
}) {
  const [editing, setEditing] = useState(decision === "pending");
  const [state, formAction] = useActionState(
    async (prev: ActionState, formData: FormData) => {
      const result = await reviewApplication(prev, formData);
      if (result.ok) setEditing(false);
      return result;
    },
    initialActionState,
  );

  const feedbackId = `feedback-${applicationId}`;
  const decisionLabel = portalDecisionLabels[decision];

  if (!editing || !canChange) {
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-ink">Jouw reactie:</span>
          <Badge tone={decisionLabel.tone}>{decisionLabel.label}</Badge>
          {decidedAtLabel && decision !== "pending" && (
            <span className="text-xs text-muted">{decidedAtLabel}</span>
          )}
        </div>
        {feedback && (
          <blockquote className="rounded-xl bg-surface px-4 py-3 text-sm whitespace-pre-line text-ink">
            {feedback}
          </blockquote>
        )}
        <FormMessage success={state.ok ? state.message : undefined} />
        {canChange && (
          <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
            <Pencil aria-hidden="true" />
            Reactie wijzigen
          </Button>
        )}
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-3" aria-label={`Reactie op ${candidateName}`}>
      <input type="hidden" name="applicationId" value={applicationId} />
      <Field
        label="Feedback (optioneel)"
        htmlFor={feedbackId}
        hint="Wat sprak je aan, of wat mis je? Daarmee verfijnen we de selectie."
        error={state.fieldErrors?.feedback}
      >
        <Textarea
          id={feedbackId}
          name="feedback"
          rows={3}
          maxLength={2000}
          defaultValue={feedback ?? ""}
          aria-invalid={state.fieldErrors?.feedback ? true : undefined}
          aria-describedby={state.fieldErrors?.feedback ? `${feedbackId}-error` : undefined}
        />
      </Field>
      <FormMessage error={state.error} />
      <div className="flex flex-wrap gap-2">
        <SubmitButton name="decision" value="approved">
          <Check aria-hidden="true" />
          Akkoord
        </SubmitButton>
        <SubmitButton name="decision" value="rejected" variant="secondary">
          <X aria-hidden="true" />
          Afwijzen
        </SubmitButton>
        {decision !== "pending" && (
          <Button variant="ghost" onClick={() => setEditing(false)}>
            Annuleren
          </Button>
        )}
      </div>
    </form>
  );
}
