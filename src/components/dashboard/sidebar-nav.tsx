"use client";

import { Suspense, use } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { PortalModule } from "@/lib/database.types";
import { canSeePath } from "@/lib/modules";
import { navSections } from "./nav-items";

type Props = {
  onNavigate?: () => void;
  /** Modules of the signed-in user (2.5); null shows everything. */
  modules: Promise<PortalModule[] | null>;
};

/**
 * The current path is request data on dynamic routes, so the active state
 * streams in behind Suspense, and so do the modules the user may see (2.5).
 * The fallback is the menu without the active state and with only the items
 * every team member sees, so no module flashes by for someone without it.
 */
export function SidebarNav({ onNavigate, modules }: Props) {
  return (
    <Suspense fallback={<NavList onNavigate={onNavigate} pathname={null} modules={[]} />}>
      <ActiveNavList onNavigate={onNavigate} modules={modules} />
    </Suspense>
  );
}

function ActiveNavList({ onNavigate, modules }: Props) {
  const pathname = usePathname();
  return <NavList onNavigate={onNavigate} pathname={pathname} modules={use(modules)} />;
}

function NavList({
  onNavigate,
  pathname,
  modules,
}: {
  onNavigate?: () => void;
  pathname: string | null;
  modules: PortalModule[] | null;
}) {
  const sections = navSections
    .map((section) => ({ ...section, items: section.items.filter((item) => canSeePath(item.href, modules)) }))
    .filter((section) => section.items.length > 0);
  return (
    <nav aria-label="Main menu" className="space-y-6">
      {sections.map((section, index) => (
        <div key={section.label ?? index}>
          {section.label && (
            <p className="mb-2 px-3 text-[11px] font-semibold tracking-wider text-brand-200/50 uppercase">
              {section.label}
            </p>
          )}
          <ul className="space-y-1">
            {section.items.map(({ label, href, icon: Icon }) => {
              const active =
                pathname !== null &&
                (href === "/dashboard"
                  ? pathname === href
                  : pathname === href || pathname.startsWith(`${href}/`));
              return (
                <li key={href}>
                  <Link
                    href={href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    // Taller rows in the phone drawer, so every item is easy to tap.
                    className={`group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition active:bg-white/10 max-lg:min-h-11 max-lg:text-[15px] ${
                      active
                        ? "bg-white/10 text-white"
                        : "text-brand-100/70 hover:bg-white/5 hover:text-white"
                    }`}
                  >
                    {active && (
                      <span
                        aria-hidden="true"
                        className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-accent-500"
                      />
                    )}
                    <Icon
                      className={`size-[18px] ${
                        active ? "text-accent-500" : "text-brand-200/60 group-hover:text-brand-100"
                      }`}
                      aria-hidden="true"
                    />
                    {label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
