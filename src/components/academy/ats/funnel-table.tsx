import type { FunnelRow } from "@/lib/academy/ats/database";
import { funnelShare } from "@/lib/academy/ats/pool";

/** Per lesson: reached, finished and stopped here, as bars against the cohort. */
export function FunnelTable({ rows }: { rows: FunnelRow[] }) {
  if (rows.length === 0) return <p className="text-sm text-muted">This course has no published lessons yet.</p>;
  const cohort = rows[0]?.cohort ?? 0;
  const worst = rows.reduce((max, r) => Math.max(max, r.stopped_here), 0);
  // The module title above its first lesson.
  const firstOfModule = new Set(rows.filter((r, i) => i === 0 || rows[i - 1].module_title !== r.module_title).map((r) => r.step));
  return (
    <div className="space-y-1">
      <p className="text-sm text-muted">
        {cohort} {cohort === 1 ? "person" : "people"} with access.
      </p>
      <ol className="space-y-1">
        {rows.map((r) => {
          const header = firstOfModule.has(r.step) ? r.module_title : null;
          return (
            <li key={`${r.step}-${r.lesson_id}`}>
              {header && <p className="mt-3 text-xs font-semibold tracking-wide text-muted uppercase">{header}</p>}
              <div className="grid grid-cols-[minmax(0,1fr)_8rem_auto] items-center gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-brand-50/40 sm:grid-cols-[minmax(0,1fr)_14rem_auto]">
                <span className="min-w-0 truncate">{r.lesson_title}</span>
                <span className="relative h-2.5 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
                  <span className="absolute inset-y-0 left-0 bg-brand-200" style={{ width: `${funnelShare(r.reached, cohort)}%` }} />
                  <span className="absolute inset-y-0 left-0 bg-brand-600" style={{ width: `${funnelShare(r.completed, cohort)}%` }} />
                </span>
                <span className="text-right text-xs whitespace-nowrap tabular-nums text-muted">
                  {r.completed}/{r.reached} done
                  {r.stopped_here > 0 && (
                    <span className={`ml-2 font-semibold ${r.stopped_here === worst ? "text-danger" : "text-amber-700"}`}>{r.stopped_here} stopped</span>
                  )}
                </span>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
