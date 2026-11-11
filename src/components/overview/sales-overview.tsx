import { isOpenStage } from "@/lib/sales/labels";
import Link from "next/link";
import { BadgeCheck, CalendarCheck, MessageSquareText, Phone, PhoneCall } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { periodRange } from "@/lib/gtm/report";
import { loadSalesFigures } from "@/lib/sales/stats";
import { createClient } from "@/lib/supabase/server";

const linkClass =
  "text-sm font-semibold text-brand-600 hover:text-brand-800 pointer-coarse:-my-3 pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center";

/**
 * Sales at a glance on the overview: this week's calls, reach and meetings,
 * the open pipeline per stage and the replies waiting for review. Render it
 * inside IfModule module="sales".
 */
export async function SalesOverview() {
  const supabase = await createClient();
  const figures = await loadSalesFigures(supabase, periodRange("deze-week"));
  const a = figures.activity;
  const m = figures.meetings;
  const open = figures.pipeline.perStage.filter((s) => isOpenStage(s.stage));
  const max = Math.max(1, ...open.map((s) => s.count));
  const cards = [
    { label: "Calls", value: a.calls, icon: Phone, href: "/dashboard/report" },
    { label: "Reached", value: a.reached, icon: PhoneCall, href: "/dashboard/report" },
    { label: "Meetings planned", value: m.planned, icon: CalendarCheck, href: "/dashboard/meetings" },
    { label: "Meetings approved", value: m.approved, icon: BadgeCheck, href: "/dashboard/meetings" },
  ];

  return (
    <section aria-labelledby="sales-overview-heading" className="mb-8 sm:mb-10">
      <div className="mb-3 flex items-end justify-between gap-3">
        <h2 id="sales-overview-heading" className="font-display text-lg font-semibold text-brand-900">
          Sales this week
        </h2>
        <Link href="/dashboard/report" className={linkClass}>
          Report
        </Link>
      </div>
      <ul className="mb-4 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {cards.map(({ label, value, icon: Icon, href }) => (
          <li key={label}>
            <Link
              href={href}
              className="group flex h-full flex-col rounded-2xl border border-border bg-card p-4 shadow-xs transition hover:border-brand-200 hover:shadow-md active:scale-[0.98] sm:p-5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
            >
              <span className="mb-3 flex size-9 items-center justify-center rounded-xl bg-brand-50 text-brand-600 sm:size-10">
                <Icon className="size-5" aria-hidden="true" />
              </span>
              <span className="text-sm text-muted">{label}</span>
              <span className="mt-1 font-display text-2xl font-bold text-brand-900 tabular-nums sm:text-3xl">{value}</span>
            </Link>
          </li>
        ))}
      </ul>
      <div className="grid gap-4 sm:gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader
            title="Open pipeline"
            description={`${figures.pipeline.open} ${figures.pipeline.open === 1 ? "company" : "companies"} between Contact and Candidate interviews.`}
            actions={
              <Link href="/dashboard/pipeline" className={linkClass}>
                Pipeline
              </Link>
            }
          />
          <dl className="space-y-2.5 px-5 py-4">
            {open.map((s) => (
              <div key={s.stage} className="grid grid-cols-[minmax(0,10rem)_1fr_2.5rem] items-center gap-3">
                <dt className="truncate text-sm text-muted">{s.label}</dt>
                <dd className="h-2.5 overflow-hidden rounded-full bg-brand-50" aria-hidden="true">
                  <div className="h-full rounded-full bg-brand-600" style={{ width: `${(s.count / max) * 100}%` }} />
                </dd>
                <dd className="text-right text-sm font-semibold text-ink tabular-nums">{s.count}</dd>
              </div>
            ))}
          </dl>
        </Card>
        <Link
          href="/dashboard/leads/replies"
          className={`flex flex-col justify-between rounded-2xl border p-5 shadow-xs transition hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 ${
            figures.repliesToReview > 0 ? "border-accent-500/40 bg-accent-100" : "border-border bg-card"
          }`}
        >
          <span className="flex items-center gap-2 text-sm font-medium text-ink">
            <MessageSquareText className="size-5 text-accent-600" aria-hidden="true" />
            Replies to review
          </span>
          <span className="mt-3 font-display text-3xl font-bold text-brand-900 tabular-nums">{figures.repliesToReview}</span>
          <span className="mt-1 text-sm text-muted">
            {figures.repliesToReview > 0 ? "Claude was not sure about these. Decide with one click." : "Nothing waits for you."}
          </span>
        </Link>
      </div>
    </section>
  );
}

export function SalesOverviewSkeleton() {
  return (
    <div className="mb-8 space-y-4 sm:mb-10" aria-busy="true" aria-label="Loading sales figures">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-32 w-full rounded-2xl" />
        ))}
      </div>
      <Skeleton className="h-48 w-full rounded-2xl" />
    </div>
  );
}
