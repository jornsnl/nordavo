import Link from "next/link";

export type PageTab = { label: string; href: string; active: boolean; count?: number };

export function PageTabs({ label, tabs }: { label: string; tabs: PageTab[] }) {
  return (
    <nav aria-label={label} className="-mx-4 overflow-x-auto px-4 scrollbar-none sm:mx-0 sm:px-0">
      <ul className="flex w-max gap-1 rounded-xl border border-border bg-white p-1 shadow-xs">
        {tabs.map((tab) => (
          <li key={tab.href}>
            <Link
              href={tab.href}
              scroll={false}
              aria-current={tab.active ? "page" : undefined}
              className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap transition pointer-coarse:min-h-9 ${
                tab.active ? "bg-brand-700 text-white" : "text-muted hover:bg-brand-50 hover:text-brand-900"
              }`}
            >
              {tab.label}
              {tab.count !== undefined && tab.count > 0 && (
                <span
                  className={`rounded-full px-1.5 text-xs font-semibold ${
                    tab.active ? "bg-white/20 text-white" : "bg-accent-100 text-accent-600"
                  }`}
                >
                  {tab.count}
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
