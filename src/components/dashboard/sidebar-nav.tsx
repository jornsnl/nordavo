"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { navSections } from "./nav-items";

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Hoofdmenu" className="space-y-6">
      {navSections.map((section, index) => (
        <div key={section.label ?? index}>
          {section.label && (
            <p className="mb-2 px-3 text-[11px] font-semibold tracking-wider text-brand-200/50 uppercase">
              {section.label}
            </p>
          )}
          <ul className="space-y-1">
            {section.items.map(({ label, href, icon: Icon }) => {
              const active =
                href === "/dashboard"
                  ? pathname === href
                  : pathname === href || pathname.startsWith(`${href}/`);
              return (
                <li key={href}>
                  <Link
                    href={href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={`group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
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
