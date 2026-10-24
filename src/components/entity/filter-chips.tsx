import Link from "next/link";

export type FilterChip = { label: string; href: string; active: boolean; count?: number };

/**
 * Filter options as a row of chips that scrolls sideways, for phones.
 * Each chip is a link, so the filter lives in the URL like the desktop form.
 * The strip bleeds to the screen edge; pass className="sm:hidden" to show
 * it on phones only.
 */
export function FilterChips({
  label,
  chips,
  className = "",
}: {
  label: string;
  chips: FilterChip[];
  className?: string;
}) {
  return (
    <nav aria-label={label} className={`-mx-4 min-w-0 ${className}`}>
      <ul className="flex snap-strip scrollbar-none gap-2 px-4 py-0.5">
        {chips.map((chip) => (
          <li key={chip.href} className="shrink-0 snap-start scroll-ml-4">
            <Link
              href={chip.href}
              scroll={false}
              aria-current={chip.active ? "page" : undefined}
              className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium whitespace-nowrap transition active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 pointer-coarse:min-h-10 ${
                chip.active
                  ? "border-brand-700 bg-brand-700 text-white"
                  : "border-border bg-white text-ink active:bg-brand-50"
              }`}
            >
              {chip.label}
              {chip.count !== undefined && (
                <span className={`text-xs tabular-nums ${chip.active ? "text-white/80" : "text-muted"}`}>
                  {chip.count}
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Builds a list page URL from the current filters with one value changed. */
export function filterHref(
  path: string,
  current: Record<string, string | undefined>,
  change: Record<string, string | undefined>,
) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...current, ...change })) {
    if (value) params.set(key, value);
  }
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}
