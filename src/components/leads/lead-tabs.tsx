import Link from "next/link";

/** "Alle leads" and "Review" tabs above the leads pages. */
export function LeadTabs({ active, reviewCount }: { active: "all" | "review"; reviewCount: number | null }) {
  const tab = (isActive: boolean) =>
    `inline-flex items-center gap-2 border-b-2 px-1 pb-3 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 ${
      isActive ? "border-brand-700 text-brand-900" : "border-transparent text-muted hover:text-brand-800"
    }`;
  return (
    <nav aria-label="Leads" className="mb-6 flex gap-6 border-b border-border">
      <Link href="/dashboard/leads" className={tab(active === "all")} aria-current={active === "all" ? "page" : undefined}>
        Alle leads
      </Link>
      <Link
        href="/dashboard/leads/review"
        className={tab(active === "review")}
        aria-current={active === "review" ? "page" : undefined}
      >
        Review
        {reviewCount !== null && (
          <span
            className={`rounded-full px-2 py-0.5 text-xs tabular-nums ${
              reviewCount > 0 ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600"
            }`}
          >
            {reviewCount}
            <span className="sr-only"> bedrijven te beoordelen</span>
          </span>
        )}
      </Link>
    </nav>
  );
}
