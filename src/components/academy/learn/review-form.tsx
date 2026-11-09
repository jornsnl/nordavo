"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { requestAiProposal, reviewSubmission } from "@/app/dashboard/academy/learn-actions";
import { RUBRIC, type RubricKey, type RubricScores, rubricTotal } from "@/lib/academy/learn/assignment";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input, Textarea } from "@/components/ui/field";
import { useAction } from "@/components/academy/admin/use-action";

/**
 * Nordavo's review of the latest attempt: rubric (1 to 5 per criterion),
 * the final score (0 to 100, Nordavo's own; the rubric suggests one),
 * feedback, and approve or ask for changes. The AI proposal is shown next
 * to it and can be copied in, never applied by itself.
 */
export function ReviewForm({
  submissionId,
  initial,
  aiScores,
  canReview,
}: {
  submissionId: string;
  initial: { rubric: RubricScores; finalScore: number | null; feedback: string };
  aiScores: RubricScores;
  canReview: boolean;
}) {
  const [rubric, setRubric] = useState<RubricScores>(initial.rubric);
  const [finalScore, setFinalScore] = useState<string>(initial.finalScore === null ? "" : String(initial.finalScore));
  const [feedback, setFeedback] = useState(initial.feedback);
  const action = useAction();
  const suggested = rubricTotal(rubric);
  const hasAi = Object.keys(aiScores).length > 0;

  function decide(status: "approved" | "changes_requested") {
    const score = finalScore.trim() === "" ? null : Math.round(Number(finalScore));
    action.run(() => reviewSubmission({ submissionId, status, feedback, finalScore: score, rubric: rubric as Record<string, number> }));
  }

  return (
    <div className="space-y-5">
      <fieldset className="space-y-3" disabled={!canReview || action.pending}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <legend className="text-sm font-semibold text-brand-900">Rubric (1 to 5)</legend>
          {hasAi && (
            <Button size="sm" variant="ghost" onClick={() => setRubric({ ...aiScores })}>
              <Sparkles aria-hidden="true" />
              Copy the AI proposal
            </Button>
          )}
        </div>
        {RUBRIC.map((criterion) => (
          <div key={criterion.key} className="space-y-1">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-sm font-medium text-ink">{criterion.label}</span>
              {aiScores[criterion.key] !== undefined && <span className="text-xs text-muted">AI: {aiScores[criterion.key]}</span>}
            </div>
            <div className="flex gap-1.5" role="radiogroup" aria-label={criterion.label}>
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={rubric[criterion.key] === n}
                  onClick={() => setRubric({ ...rubric, [criterion.key as RubricKey]: n })}
                  className={`size-9 rounded-lg border text-sm font-semibold transition ${
                    rubric[criterion.key] === n ? "border-brand-600 bg-brand-700 text-white" : "border-border bg-white text-brand-900 hover:border-brand-300"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted">{criterion.description}</p>
          </div>
        ))}
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-[10rem_minmax(0,1fr)] sm:items-end">
        <Field
          label="Final score (0 to 100)"
          htmlFor={`final-${submissionId}`}
          hint={suggested !== null ? `The rubric suggests ${suggested}.` : "Your own score; the AI proposal never counts by itself."}
        >
          <Input
            id={`final-${submissionId}`}
            type="number"
            inputMode="numeric"
            min={0}
            max={100}
            value={finalScore}
            disabled={!canReview || action.pending}
            onChange={(e) => setFinalScore(e.target.value)}
          />
        </Field>
        {suggested !== null && (
          <div className="pb-1">
            <Button size="sm" variant="ghost" disabled={!canReview || action.pending} onClick={() => setFinalScore(String(suggested))}>
              Use {suggested}
            </Button>
          </div>
        )}
      </div>

      <Field label="Feedback for the learner" htmlFor={`feedback-${submissionId}`} hint="Required when you ask for changes. The learner sees it in the lesson.">
        <Textarea
          id={`feedback-${submissionId}`}
          rows={6}
          value={feedback}
          maxLength={20_000}
          disabled={!canReview || action.pending}
          onChange={(e) => setFeedback(e.target.value)}
        />
      </Field>

      <FormMessage error={action.result.error} success={action.result.message} />
      {canReview ? (
        <div className="flex flex-wrap gap-2">
          <Button disabled={action.pending} onClick={() => decide("approved")}>
            Approve
          </Button>
          <Button variant="secondary" disabled={action.pending} onClick={() => decide("changes_requested")}>
            Ask for changes
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted">A newer attempt was handed in; review that one.</p>
      )}
    </div>
  );
}

/** (Re)make the AI proposal. */
export function AiProposalButton({ submissionId, again }: { submissionId: string; again: boolean }) {
  const action = useAction();
  return (
    <div className="space-y-2">
      <Button size="sm" variant="secondary" disabled={action.pending} onClick={() => action.run(() => requestAiProposal(submissionId))}>
        <Sparkles aria-hidden="true" />
        {action.pending ? "Asking the AI…" : again ? "Ask again" : "Ask the AI for a proposal"}
      </Button>
      <FormMessage error={action.result.error} success={action.result.message} />
    </div>
  );
}
