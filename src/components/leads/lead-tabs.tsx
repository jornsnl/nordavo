import Link from "next/link";

type Tab = "all" | "replies" | "review";

/** Tabs above the leads pages: all leads, replies to review (2.7) and the ICP review queue. */
export function LeadTabs({
  active,
  reviewCount,
  replyCount = null,
}: {
  active: Tab;
  reviewCount: number | null;
  replyCount?: number | null;
}) {
  const tab = (isActive: boolean) =>
    `inline-flex items-center gap-2 border-b-2 px-1 pb-3 text-sm max-md:min-h-11 max-md:pt-1 font-semibold whitespace-nowrap transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 ${
      isActive ? "border-brand-700 text-brand-900" : "border-transparent text-muted hover:text-brand-800"
    }`;
  const count = (value: number | null, label: string) =>
    value !== null && (
      <span
        className={`rounded-full px-2 py-0.5 text-xs tabular-nums ${
          value > 0 ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600"
        }`}
      >
        {value}
        <span className="sr-only"> {label}</span>
      </span>
    );
  return (
    <nav aria-label="Leads" className="scrollbar-none mb-6 flex gap-6 relative overflow-x-auto border-b border-border">
      <Link href="/dashboard/leads" className={tab(active === "all")} aria-current={active === "all" ? "page" : undefined}>
        All leads
      </Link>
      <Link
        href="/dashboard/leads/replies"
        className={tab(active === "replies")}
        aria-current={active === "replies" ? "page" : undefined}
      >
        Replies to review
        {count(replyCount, "replies to review")}
      </Link>
      <Link
        href="/dashboard/leads/review"
        className={tab(active === "review")}
        aria-current={active === "review" ? "page" : undefined}
      >
        ICP review
        {count(reviewCount, "companies to review")}
      </Link>
    </nav>
  );
}
