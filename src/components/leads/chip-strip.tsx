import Link from "next/link";

/**
 * Horizontally scrollable quick filters for phones, as links. Pass
 * className="md:hidden" when the desktop already has the same filter.
 */
export function ChipStrip({
  label,
  chips,
  className = "",
}: {
  label: string;
  chips: { label: string; href: string; active: boolean }[];
  className?: string;
}) {
  return (
    <nav aria-label={label} className={`-mx-4 snap-strip scroll-px-4 scrollbar-none px-4 sm:-mx-6 sm:scroll-px-6 sm:px-6 ${className}`}>
      <ul className="flex w-max gap-2">
        {chips.map((chip) => (
          <li key={chip.href + chip.label} className="snap-start">
            <Link
              href={chip.href}
              scroll={false}
              aria-current={chip.active ? "true" : undefined}
              className={`inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-medium whitespace-nowrap transition active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 ${
                chip.active
                  ? "border-brand-900 bg-brand-900 text-white"
                  : "border-border bg-card text-ink active:bg-brand-50"
              }`}
            >
              {chip.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** URL with these params, empty values dropped. */
export function hrefWith(basePath: string, params: Record<string, string | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
  const qs = search.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}
