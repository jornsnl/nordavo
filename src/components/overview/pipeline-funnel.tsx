import { getPipelineFunnel } from "@/lib/data/stats";
import { applicationStages } from "@/lib/labels";

/** Candidates per pipeline stage, across open vacancies. */
export async function PipelineFunnel() {
  const counts = await getPipelineFunnel();
  const stages = applicationStages.filter((s) => s.value !== "rejected");
  const max = Math.max(1, ...stages.map((s) => counts.get(s.value) ?? 0));
  const rejected = counts.get("rejected") ?? 0;
  const total = stages.reduce((sum, s) => sum + (counts.get(s.value) ?? 0), 0);

  if (total === 0 && rejected === 0) {
    return (
      <p className="px-5 py-6 text-sm text-muted">
        Nog geen kandidaten in de pipeline van open vacatures.
      </p>
    );
  }

  return (
    <div className="px-5 py-4">
      <dl className="space-y-2.5">
        {stages.map((stage) => {
          const count = counts.get(stage.value) ?? 0;
          return (
            <div key={stage.value} className="grid grid-cols-[minmax(0,9rem)_1fr_2rem] items-center gap-3">
              <dt className="truncate text-sm text-muted">{stage.label}</dt>
              <dd className="h-2.5 overflow-hidden rounded-full bg-brand-50" aria-hidden="true">
                <div
                  className={`h-full rounded-full ${stage.value === "placed" ? "bg-emerald-500" : stage.tone === "accent" ? "bg-accent-500" : "bg-brand-600"}`}
                  style={{ width: `${(count / max) * 100}%` }}
                />
              </dd>
              <dd className="text-right text-sm font-semibold text-ink tabular-nums">{count}</dd>
            </div>
          );
        })}
      </dl>
      {rejected > 0 && (
        <p className="mt-4 border-t border-border pt-3 text-xs text-muted">
          {rejected} afgewezen bij open vacatures.
        </p>
      )}
    </div>
  );
}
