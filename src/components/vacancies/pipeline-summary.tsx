import { ArrowRight, KanbanSquare } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import type { PipelineSummary as Summary } from "@/lib/data/vacancies";
import type { Tone } from "@/lib/labels";
import { applicationStages, optionFor } from "@/lib/labels";

const bar: Record<Tone, string> = {
  neutral: "bg-slate-300",
  brand: "bg-brand-500",
  accent: "bg-accent-500",
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  danger: "bg-danger",
};

export function PipelineSummary({
  vacancyId,
  summary,
  target,
}: {
  vacancyId: string;
  summary: Summary;
  target: number;
}) {
  const flow = summary.stages.filter((s) => s.stage !== "rejected" && s.stage !== "parked");
  const presentedPct = Math.min(100, Math.round((summary.presented / target) * 100));
  const reached = summary.presented >= target;

  return (
    <Card>
      <CardHeader
        title="Pipeline"
        description={
          summary.total === 0
            ? "No candidates linked to this vacancy yet."
            : `${summary.active} active in the pipeline, ${summary.parked} parked, ${summary.rejected} rejected.`
        }
      />
      <CardBody className="space-y-6">
        <div>
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-sm font-medium text-ink">Presented to the client</h3>
            <p className="font-display text-lg font-bold text-brand-900 tabular-nums">
              {summary.presented} <span className="text-sm font-medium text-muted">of {target}</span>
            </p>
          </div>
          <div
            className="mt-2 h-2.5 overflow-hidden rounded-full bg-brand-50"
            role="progressbar"
            aria-label="Presented to the client"
            aria-valuemin={0}
            aria-valuemax={target}
            aria-valuenow={Math.min(summary.presented, target)}
          >
            <div
              className={`h-full rounded-full ${reached ? "bg-emerald-500" : "bg-accent-500"}`}
              style={{ width: `${presentedPct}%` }}
            />
          </div>
          <p className="mt-1.5 text-xs text-muted">
            {reached
              ? "Goal reached: the client has seen three candidates."
              : `${target - summary.presented} to go for the promise of three candidates.`}
          </p>
        </div>

        {summary.active > 0 && (
          <div aria-hidden="true" className="flex h-3 overflow-hidden rounded-full bg-surface">
            {flow
              .filter((s) => s.count > 0)
              .map((s) => (
                <div
                  key={s.stage}
                  className={bar[optionFor(applicationStages, s.stage).tone]}
                  style={{ width: `${(s.count / summary.active) * 100}%` }}
                  title={`${s.label}: ${s.count}`}
                />
              ))}
          </div>
        )}

        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {summary.stages.map((s) => {
            const tone = optionFor(applicationStages, s.stage).tone;
            return (
              <li
                key={s.stage}
                className={`rounded-xl border border-border px-3 py-2.5 ${s.count === 0 ? "opacity-60" : ""}`}
              >
                <span className="flex items-center gap-1.5 text-xs text-muted">
                  <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${bar[tone]}`} />
                  {s.label}
                </span>
                <span className="mt-0.5 block font-display text-xl font-bold text-brand-900 tabular-nums">
                  {s.count}
                </span>
              </li>
            );
          })}
        </ul>

        <ButtonLink href={`/dashboard/vacancies/${vacancyId}/pipeline`} className="w-full sm:w-auto">
          <KanbanSquare aria-hidden="true" />
          Open pipeline
          <ArrowRight aria-hidden="true" />
        </ButtonLink>
      </CardBody>
    </Card>
  );
}
