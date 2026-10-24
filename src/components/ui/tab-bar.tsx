"use client";

import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";

export type TabItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Custom active check; defaults to the href and everything below it. */
  match?: (pathname: string) => boolean;
};

const tabClass =
  "flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl py-1.5 text-[11px] font-medium transition active:scale-95 focus-visible:outline-2 focus-visible:outline-brand-500";

/**
 * Bottom tab bar for phones, like a native app. Fixed above the home
 * indicator; pair the page content with the pb-tabbar utility up to the
 * same breakpoint.
 * `extra` renders as the last tab, e.g. a "Meer" button that opens a drawer.
 */
export function TabBar({
  items,
  extra,
  label,
  hideFrom = "lg",
}: {
  items: TabItem[];
  extra?: ReactNode;
  label: string;
  /** Breakpoint from which the desktop navigation takes over. */
  hideFrom?: "md" | "lg";
}) {
  return (
    <nav
      aria-label={label}
      className={`fixed inset-x-0 bottom-0 z-30 border-t border-border bg-white/90 pb-safe backdrop-blur-lg ${
        hideFrom === "md" ? "md:hidden" : "lg:hidden"
      }`}
    >
      <div className="mx-auto flex h-16 max-w-lg items-stretch gap-1 px-2 pl-safe pr-safe">
        <Suspense fallback={<Tabs items={items} pathname={null} />}>
          <ActiveTabs items={items} />
        </Suspense>
        {extra}
      </div>
    </nav>
  );
}

/** A tab that is a button instead of a link, styled the same. */
export function TabButton({
  label,
  icon: Icon,
  onClick,
  active = false,
  ...aria
}: {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  active?: boolean;
  "aria-expanded"?: boolean;
  "aria-controls"?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${tabClass} ${active ? "text-brand-700" : "text-muted"}`}
      {...aria}
    >
      <span
        className={`flex h-7 w-12 items-center justify-center rounded-full transition ${
          active ? "bg-brand-100" : ""
        }`}
      >
        <Icon className="size-[22px]" aria-hidden="true" />
      </span>
      <span className="max-w-full truncate">{label}</span>
    </button>
  );
}

function ActiveTabs({ items }: { items: TabItem[] }) {
  const pathname = usePathname();
  return <Tabs items={items} pathname={pathname} />;
}

function Tabs({ items, pathname }: { items: TabItem[]; pathname: string | null }) {
  return (
    <>
      {items.map(({ label, href, icon: Icon, match }) => {
        const active =
          pathname !== null &&
          (match ? match(pathname) : pathname === href || pathname.startsWith(`${href}/`));
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`${tabClass} ${active ? "text-brand-700" : "text-muted hover:text-brand-900"}`}
          >
            <span
              className={`flex h-7 w-12 items-center justify-center rounded-full transition ${
                active ? "bg-brand-100" : ""
              }`}
            >
              <Icon className="size-[22px]" aria-hidden="true" strokeWidth={active ? 2.25 : 2} />
            </span>
            <span className="max-w-full truncate">{label}</span>
          </Link>
        );
      })}
    </>
  );
}
