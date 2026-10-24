import Link from "next/link";
import { reportPeriods, type ReportPeriodKey } from "@/lib/gtm/report";

const shortLabels: Partial<Record<ReportPeriodKey, string>> = { "30-dagen": "30 dagen" };

/** Segmented control as plain links, so it works without JavaScript. Full width on phones. */
export function PeriodSelector({ current }: { current: ReportPeriodKey }) {
  return (
    <nav aria-label="Periode" className="inline-flex rounded-xl border border-border bg-card p-1 shadow-xs max-sm:flex max-sm:w-full">
      {reportPeriods.map((period) => {
        const active = period.value === current;
        return (
          <Link
            key={period.value}
            href={`/dashboard/rapport?periode=${period.value}`}
            aria-current={active ? "page" : undefined}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap transition max-sm:flex max-sm:min-h-10 max-sm:flex-1 max-sm:items-center max-sm:justify-center max-sm:px-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 ${
              active ? "bg-brand-900 text-white" : "text-muted hover:bg-brand-50 hover:text-brand-900 active:bg-brand-50"
            }`}
          >
            {shortLabels[period.value] ? (
              <>
                <span className="sm:hidden">{shortLabels[period.value]}</span>
                <span className="max-sm:hidden">{period.label}</span>
              </>
            ) : (
              period.label
            )}
          </Link>
        );
      })}
    </nav>
  );
}

export function PeriodSelectorSkeleton() {
  return <span aria-hidden="true" className="block h-10 w-72 animate-pulse rounded-xl bg-brand-100/70 max-sm:w-full" />;
}
