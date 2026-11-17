import Link from "next/link";
import { formatCurrency } from "@/lib/format";
import { goalProgress, monthLabel, rate, type CallerStats, type Period } from "@/lib/sales/caller-stats";

const tiles: { key: keyof CallerStats; label: string }[] = [
  { key: "called", label: "Called" },
  { key: "reached", label: "Reached" },
  { key: "callbacks", label: "Call back" },
  { key: "interested", label: "Interested" },
  { key: "planned", label: "Planned" },
  { key: "held", label: "Held" },
  { key: "approved", label: "Approved" },
];

/** Called, reached, call backs, interested and the meetings for one caller, with the two rates. */
export function CallerStatsGrid({ stats }: { stats: CallerStats }) {
  const reachedRate = rate(stats.reached, stats.called);
  const meetingRate = rate(stats.meetings, stats.reached);
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.key} className="rounded-xl bg-surface px-4 py-3">
            <dt className="text-xs font-medium tracking-wide text-muted uppercase">{t.label}</dt>
            <dd className="mt-1 font-display text-2xl font-bold text-brand-900 tabular-nums">{stats[t.key]}</dd>
          </div>
        ))}
        <div className="rounded-xl bg-surface px-4 py-3">
          <dt className="text-xs font-medium tracking-wide text-muted uppercase">Reach rate</dt>
          <dd className="mt-1 font-display text-2xl font-bold text-brand-900 tabular-nums">{reachedRate === null ? "-" : `${reachedRate}%`}</dd>
          <dd className="text-xs text-muted">of the calls</dd>
        </div>
      </dl>
      <p className="text-sm text-muted">
        {meetingRate === null
          ? "No conversations yet, so no meeting rate."
          : `${meetingRate}% of the conversations (${stats.meetings} of ${stats.reached}) led to a meeting.`}
      </p>
    </div>
  );
}

/** Week, month or total, as links that keep the other filters. */
export function PeriodSwitch({ active, hrefFor }: { active: Period; hrefFor: (period: Period) => string }) {
  const items: { value: Period; label: string }[] = [
    { value: "week", label: "Week" },
    { value: "month", label: "Month" },
    { value: "total", label: "Total" },
  ];
  return (
    <nav aria-label="Period" className="inline-flex rounded-xl bg-surface p-1 text-sm">
      {items.map((i) => (
        <Link
          key={i.value}
          href={hrefFor(i.value)}
          scroll={false}
          aria-current={active === i.value ? "page" : undefined}
          className={`rounded-lg px-3.5 py-2 font-medium pointer-coarse:min-h-11 ${active === i.value ? "bg-white text-brand-900 shadow-sm" : "text-muted hover:text-brand-900"}`}
        >
          {i.label}
        </Link>
      ))}
    </nav>
  );
}

/** Attempts this week against the weekly goal. */
export function WeekGoal({ called, goal }: { called: number; goal: number }) {
  if (goal <= 0) return <p className="text-sm text-muted">No weekly goal is set for you yet. Nordavo can set one.</p>;
  const pct = goalProgress(called, goal);
  const left = Math.max(goal - called, 0);
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-display text-2xl font-bold text-brand-900 tabular-nums">
          {called} <span className="text-base font-medium text-muted">of {goal} calls</span>
        </p>
        <p className="text-sm font-medium text-ink tabular-nums">{pct}%</p>
      </div>
      <div
        role="progressbar"
        aria-label="Weekly goal"
        aria-valuemin={0}
        aria-valuemax={goal}
        aria-valuenow={Math.min(called, goal)}
        className="h-2.5 overflow-hidden rounded-full bg-surface"
      >
        <div className={`h-full rounded-full ${pct >= 100 ? "bg-emerald-600" : "bg-accent-600"}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <p className="text-xs text-muted">{left === 0 ? "Goal reached, well done." : `${left} to go this week.`}</p>
    </div>
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
