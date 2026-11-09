import { formatCurrency } from "@/lib/format";
import { monthLabel, type CallerStats } from "@/lib/sales/caller-stats";

const tiles: { key: keyof CallerStats; label: string }[] = [
  { key: "called", label: "Called" },
  { key: "reached", label: "Reached" },
  { key: "meetings", label: "Meetings" },
  { key: "approved", label: "Approved" },
];

/** Called, reached, meetings and approved for one caller. */
export function CallerStatsGrid({ stats }: { stats: CallerStats }) {
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {tiles.map((t) => (
        <div key={t.key} className="rounded-xl bg-surface px-4 py-3">
          <dt className="text-xs font-medium tracking-wide text-muted uppercase">{t.label}</dt>
          <dd className="mt-1 font-display text-2xl font-bold text-brand-900 tabular-nums">{stats[t.key]}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Approved meetings and fees per month, newest first. */
export function MonthFeesList({ months }: { months: { month: string; approved: number; fees: number }[] }) {
  return (
    <ul className="divide-y divide-border text-sm">
      {months.map((m) => (
        <li key={m.month} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
          <span className="text-ink">{monthLabel(m.month)}</span>
          <span className="flex gap-4 tabular-nums">
            <span className="text-muted">
              {m.approved} {m.approved === 1 ? "meeting" : "meetings"}
            </span>
            <span className="w-20 text-right font-medium text-ink">{formatCurrency(m.fees)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
