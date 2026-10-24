import Link from "next/link";
import { reportPeriods, type ReportPeriodKey } from "@/lib/gtm/report";

/** Segmented control as plain links, so it works without JavaScript. */
export function PeriodSelector({ current }: { current: ReportPeriodKey }) {
  return (
    <nav aria-label="Periode" className="inline-flex rounded-xl border border-border bg-card p-1 shadow-xs">
      {reportPeriods.map((period) => {
        const active = period.value === current;
        return (
          <Link
            key={period.value}
            href={`/dashboard/rapport?periode=${period.value}`}
            aria-current={active ? "page" : undefined}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 ${
              active ? "bg-brand-900 text-white" : "text-muted hover:bg-brand-50 hover:text-brand-900"
            }`}
          >
            {period.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function PeriodSelectorSkeleton() {
  return <span aria-hidden="true" className="block h-10 w-72 animate-pulse rounded-xl bg-brand-100/70" />;
}
