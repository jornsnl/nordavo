"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isActivePortalPath, portalNavItems } from "./nav-items";

export function PortalNav() {
  const pathname = usePathname();
  return <PortalNavLinks isActive={(href) => isActivePortalPath(pathname, href)} />;
}

/** Plain links without an active state, used while the pathname is not known yet. */
export function PortalNavFallback() {
  return <PortalNavLinks isActive={() => false} />;
}

function PortalNavLinks({ isActive }: { isActive: (href: string) => boolean }) {
  return (
    <nav aria-label="Klantportaal" className="-mb-px flex gap-1">
      {portalNavItems.map(({ label, href }) => {
        const active = isActive(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`border-b-2 px-3 py-3 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-brand-500 ${
              active
                ? "border-accent-500 text-brand-900"
                : "border-transparent text-muted hover:border-brand-200 hover:text-brand-900"
            }`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
