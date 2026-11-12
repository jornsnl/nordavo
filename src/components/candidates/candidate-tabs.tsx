import Link from "next/link";

/**
 * Tabs of the candidate page. Each tab is a link with ?tab=..., so a tab
 * can be shared and the back button works.
 */
export function CandidateTabs({
  candidateId,
  tabs,
  active,
}: {
  candidateId: string;
  tabs: { key: string; label: string }[];
  active: string;
}) {
  return (
    <nav aria-label="Candidate sections" className="-mx-4 mb-4 overflow-x-auto px-4 sm:mx-0 sm:mb-6 sm:px-0">
      <ul className="flex min-w-max gap-1 border-b border-border">
        {tabs.map((tab) => {
          const current = tab.key === active;
          return (
            <li key={tab.key}>
              <Link
                href={tab.key === "overview" ? `/dashboard/candidates/${candidateId}` : `/dashboard/candidates/${candidateId}?tab=${tab.key}`}
                aria-current={current ? "page" : undefined}
                scroll={false}
                className={`-mb-px flex items-center border-b-2 px-3 py-2.5 text-sm font-medium transition pointer-coarse:min-h-11 focus-visible:outline-2 focus-visible:outline-brand-500 ${
                  current ? "border-brand-600 text-brand-900" : "border-transparent text-muted hover:border-brand-200 hover:text-brand-700"
                }`}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
