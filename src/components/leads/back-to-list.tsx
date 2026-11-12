"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";

// Going back from a lead to the Leads or Contacts table should be instant,
// with the same filter, sort and scroll position. The table page leaves a
// marker in sessionStorage; the lead page that is opened right after it
// takes the marker and its back link uses the browser history (the router
// restores the page from memory, without loading it again).

const KEY = "nordavo:sales-list";

/** On the Leads and Contacts tables: "the next page was opened from here". */
export function ListMarker() {
  const pathname = usePathname();
  const params = useSearchParams();
  useEffect(() => {
    try {
      const query = params.toString();
      sessionStorage.setItem(KEY, JSON.stringify({ href: query ? `${pathname}?${query}` : pathname, at: Date.now() }));
    } catch {
      // Private mode or blocked storage: the back link falls back to a normal link.
    }
  }, [pathname, params]);
  return null;
}

function takeMarker(): string | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    if (!raw) return null;
    const marker = JSON.parse(raw) as { href?: unknown };
    return typeof marker.href === "string" ? marker.href : null;
  } catch {
    return null;
  }
}

/**
 * "All leads": back through the history when this page was opened from a
 * sales table, else a normal link to `href`.
 */
export function BackToListLink({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  const router = useRouter();
  const from = useRef<string | null>(null);
  useEffect(() => {
    // Taken once after mounting (sessionStorage is browser only), so a lead
    // opened from another lead does not go back to that one.
    from.current ??= takeMarker();
  }, []);
  return (
    <Link
      href={href}
      className={className}
      onClick={(event) => {
        if (!from.current || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        router.back();
      }}
    >
      {children}
    </Link>
  );
}
