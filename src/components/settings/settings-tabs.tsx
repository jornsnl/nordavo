import Link from "next/link";

const tabs = [
  { key: "general", label: "General", href: "/dashboard/settings" },
  { key: "callers", label: "Callers", href: "/dashboard/settings/callers" },
  { key: "mail-log", label: "Mail log", href: "/dashboard/settings/mail-log" },
] as const;

/** Tabs at the top of Settings. Callers and Mail log are for admins only. */
export function SettingsTabs({ active, isAdmin }: { active: (typeof tabs)[number]["key"]; isAdmin: boolean }) {
  if (!isAdmin) return null;
  return (
    <nav aria-label="Settings sections" className="-mt-2 mb-6 border-b border-border sm:mb-8">
      <ul className="-mb-px flex gap-1 overflow-x-auto">
        {tabs.map((tab) => {
          const current = tab.key === active;
          return (
            <li key={tab.key}>
              <Link
                href={tab.href}
                aria-current={current ? "page" : undefined}
                className={`inline-flex min-h-11 items-center border-b-2 px-3 text-sm font-medium whitespace-nowrap focus-visible:outline-2 focus-visible:outline-brand-500 ${
                  current
                    ? "border-accent-500 text-brand-900"
                    : "border-transparent text-muted hover:border-brand-200 hover:text-brand-700"
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
