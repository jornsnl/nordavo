import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";

/**
 * Native style list for phones: one tappable row per record, grouped in a
 * card. Show it with className="md:hidden" next to the desktop <Table>.
 */
export function MobileList({
  children,
  className = "",
  label,
}: {
  children: ReactNode;
  className?: string;
  /** Accessible name for the list. */
  label?: string;
}) {
  return (
    <ul
      aria-label={label}
      className={`divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card shadow-xs ${className}`}
    >
      {children}
    </ul>
  );
}

/**
 * One row: optional leading avatar or icon, a title with subtitle and extra
 * lines, and trailing meta (a badge, a date). With href the whole row is a
 * link with a chevron, at least 56px high so it is easy to tap.
 */
export function MobileListItem({
  href,
  leading,
  title,
  subtitle,
  meta,
  trailing,
  children,
}: {
  href?: string;
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Small line under the subtitle, e.g. a date or counts. */
  meta?: ReactNode;
  /** Right side: a badge or status. */
  trailing?: ReactNode;
  /** Extra content under the text, e.g. action buttons. */
  children?: ReactNode;
}) {
  const body = (
    <>
      {leading && <div className="shrink-0">{leading}</div>}
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-ink">{title}</p>
        {subtitle && <p className="truncate text-sm text-muted">{subtitle}</p>}
        {meta && <p className="mt-0.5 truncate text-xs text-muted">{meta}</p>}
        {children && <div className="mt-2">{children}</div>}
      </div>
      {trailing && <div className="shrink-0 self-center">{trailing}</div>}
      {href && <ChevronRight className="size-5 shrink-0 self-center text-muted/60" aria-hidden="true" />}
    </>
  );

  return (
    <li>
      {href ? (
        <Link
          href={href}
          className="flex min-h-14 items-start gap-3 px-4 py-3 transition active:bg-brand-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-500"
        >
          {body}
        </Link>
      ) : (
        <div className="flex min-h-14 items-start gap-3 px-4 py-3">{body}</div>
      )}
    </li>
  );
}
