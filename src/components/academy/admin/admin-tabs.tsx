"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  { label: "Courses", href: "/dashboard/academy" },
  { label: "People", href: "/dashboard/academy/people" },
  { label: "Groups", href: "/dashboard/academy/groups" },
  { label: "Overview", href: "/dashboard/academy/overview" },
  { label: "Automation", href: "/dashboard/academy/automation" },
  { label: "Library", href: "/dashboard/academy/library" },
  // Area placement
  { label: "Placements", href: "/dashboard/academy/placements" },
  { label: "Rituals", href: "/dashboard/academy/rituals" },
  { label: "Holidays", href: "/dashboard/academy/holidays" },
  // Area learn: assignment reviews and overdue tasks.
  { label: "Reviews", href: "/dashboard/academy/reviews" },
  { label: "Tasks", href: "/dashboard/academy/tasks" },
  { label: "Documents", href: "/dashboard/academy/documents" },
];

function isActive(pathname: string, href: string) {
  if (href === "/dashboard/academy") {
    return pathname === href || pathname.startsWith("/dashboard/academy/courses") || pathname.startsWith("/dashboard/academy/lessons");
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Sections of the Academy editor, above every page. */
export function AcademyAdminTabs() {
  return <Tabs pathname={usePathname()} />;
}

/** The same tabs without an active state, while the pathname is not known yet. */
export function AcademyAdminTabsFallback() {
  return <Tabs pathname="" />;
}

function Tabs({ pathname }: { pathname: string }) {
  return (
    <nav aria-label="Academy" className="scrollbar-none -mx-1 mb-6 flex gap-1 relative overflow-x-auto border-b border-border px-1">
      {tabs.map((tab) => {
        const active = isActive(pathname, tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={`-mb-px shrink-0 border-b-2 px-3 py-2.5 text-sm font-medium transition ${
              active ? "border-accent-500 text-brand-900" : "border-transparent text-muted hover:border-brand-200 hover:text-brand-900"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
      <Link href="/academy" className="-mb-px ml-auto shrink-0 border-b-2 border-transparent px-3 py-2.5 text-sm font-medium text-brand-700 hover:text-brand-900">
        Open the Academy
      </Link>
    </nav>
  );
}
