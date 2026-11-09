"use client";

import { useActionState } from "react";
import { LoaderCircle, Sparkles } from "lucide-react";
import { ActionFeedback } from "@/components/talent/action-button";
import { Button } from "@/components/ui/button";
import { Field, Select, Textarea } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import type { ScreeningModel } from "@/lib/database.types";
import { SCREENING_MODELS } from "@/lib/screening/scoring";
import type { TalentActionState } from "@/lib/talent/types";
import { saveScreeningRequirementsAction, scoreVacancyAction } from "@/app/dashboard/vacancies/screening-actions";

type Req = { label: string; kind: "must_have" | "alternative" | "nice_to_have"; alternatives: string[] };

/** Requirements per vacancy (2.11): must have, alternative possible, nice to have, and the model. */
export function RequirementsForm({ vacancyId, requirements, model }: { vacancyId: string; requirements: Req[]; model: ScreeningModel | null }) {
  const [state, action] = useActionState(saveScreeningRequirementsAction.bind(null, vacancyId), {} as TalentActionState);
  const of = (kind: Req["kind"]) =>
    requirements
      .filter((r) => r.kind === kind)
      .map((r) => (kind === "alternative" && r.alternatives.length > 0 ? `${r.label}: ${r.alternatives.join(", ")}` : r.label))
      .join("\n");
  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        <Field label="Must have" htmlFor="req-must" hint="One per line. Cannot be missing: a CV without it scores below 50.">
          <Textarea id="req-must" name="must_have" rows={6} defaultValue={of("must_have")} />
        </Field>
        <Field label="Alternative possible" htmlFor="req-alt" hint="One per line, alternatives after a colon. For example: BigQuery: Snowflake, Redshift">
          <Textarea id="req-alt" name="alternative" rows={6} defaultValue={of("alternative")} />
        </Field>
        <Field label="Nice to have" htmlFor="req-nice" hint="One per line. Adds to the score, never a reason to reject.">
          <Textarea id="req-nice" name="nice_to_have" rows={6} defaultValue={of("nice_to_have")} />
        </Field>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <Field label="Model for this vacancy" htmlFor="req-model" className="sm:w-72">
          <Select id="req-model" name="screening_model" defaultValue={model ?? ""}>
            <option value="">Default (Opus 5.5)</option>
            {SCREENING_MODELS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}: {m.hint}
              </option>
            ))}
          </Select>
        </Field>
        <SubmitButton variant="secondary" pendingLabel="Saving">
          Save requirements
        </SubmitButton>
      </div>
      <ActionFeedback state={state} />
    </form>
  );
}

/** Score the CVs of this vacancy: model per run, low effort for a bulk pass, re-score. */
export function ScoreControls({ vacancyId, claude, unscored }: { vacancyId: string; claude: boolean; unscored: number }) {
  const [state, action, pending] = useActionState(scoreVacancyAction.bind(null, vacancyId), {} as TalentActionState);
  return (
    <form action={action} className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        {claude && (
          <>
            <Field label="Model for this run" htmlFor="score-model" className="sm:w-64">
              <Select id="score-model" name="model" defaultValue="">
                <option value="">The vacancy&apos;s model</option>
                {SCREENING_MODELS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </Select>
            </Field>
            <label className="flex items-center gap-2 text-sm text-ink sm:pb-2.5">
              <input type="checkbox" name="bulk" className="size-4 accent-brand-700" />
              Bulk pass (low effort)
            </label>
          </>
        )}
        <label className="flex items-center gap-2 text-sm text-ink sm:pb-2.5">
          <input type="checkbox" name="rescore" className="size-4 accent-brand-700" />
          Re-score everyone
        </label>
        <Button type="submit" disabled={pending} aria-busy={pending}>
          {pending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Sparkles aria-hidden="true" />}
          {pending ? (claude ? "Scoring" : "Queueing") : claude ? `Score ${unscored > 0 ? `${unscored} unscored` : "CVs"}` : "Ask Claude to score"}
        </Button>
      </div>
      {!claude && (
        <p className="text-sm text-muted">
          Claude scores new CVs through the MCP in its scheduled task claude-screening
          {unscored > 0 ? `; ${unscored} unscored CVs are in its queue` : ""}. Tick re-score to queue everyone again.
        </p>
      )}
      <ActionFeedback state={state} />
    </form>
  );
}
