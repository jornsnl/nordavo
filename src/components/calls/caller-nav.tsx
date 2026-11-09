"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Phone, ShieldCheck } from "lucide-react";

const items = [
  { href: "/caller", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/caller/call", label: "Call", icon: Phone, exact: false },
  { href: "/caller/security", label: "Security", icon: ShieldCheck, exact: false },
];

/** The three pages an external caller has. No portal menu. */
export function CallerNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Caller pages">
      <ul className="flex gap-1">
        {items.map(({ href, label, icon: Icon, exact }) => {
          const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`inline-flex min-h-10 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-brand-500 ${
                  active ? "bg-brand-50 text-brand-800" : "text-muted hover:bg-brand-50 hover:text-brand-900"
                }`}
              >
                <Icon className="size-4" aria-hidden="true" />
                <span className="max-sm:sr-only">{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
