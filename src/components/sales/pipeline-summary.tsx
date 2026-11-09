import "server-only";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { pipelineStages } from "@/lib/sales/labels";

/** Companies per stage, as a strip above the pipeline. */
export async function PipelineSummary() {
  const supabase = await createClient();
  const { data } = await supabase.from("companies").select("pipeline_stage").not("pipeline_stage", "is", null).limit(10000);
  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    if (row.pipeline_stage) counts.set(row.pipeline_stage, (counts.get(row.pipeline_stage) ?? 0) + 1);
  }
  return (
    <ol className="scrollbar-none mb-6 flex gap-2 relative overflow-x-auto" aria-label="Companies per stage">
      {pipelineStages.map((stage, i) => (
        <li key={stage.value} className="min-w-28 flex-1 rounded-xl border border-border bg-card px-3 py-2">
          <Link href="/dashboard/pipeline?mode=board" className="block">
            <span className="block text-xs text-muted">
              {i + 1}. {stage.label}
            </span>
            <span className="font-display text-xl font-bold text-brand-900 tabular-nums">{counts.get(stage.value) ?? 0}</span>
          </Link>
        </li>
      ))}
    </ol>
  );
}
