import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { buttonClasses } from "@/components/ui/button";

/**
 * Previous and next links that keep the other search params. On phones they
 * are two large buttons under the count.
 */
export function Pagination({
  basePath,
  params,
  page,
  pageSize,
  total,
}: {
  basePath: string;
  params: Record<string, string | undefined>;
  page: number;
  pageSize: number;
  total: number;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;

  const hrefFor = (p: number) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value && key !== "page") search.set(key, value);
    }
    if (p > 1) search.set("page", String(p));
    const qs = search.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);

  return (
    <nav aria-label="Paginering" className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-muted max-md:flex-col max-md:items-stretch">
      <p className="max-md:text-center">
        {from} tot {to} van {total}
      </p>
      <div className="flex gap-2 max-md:*:flex-1">
        {page > 1 ? (
          <Link href={hrefFor(page - 1)} className={buttonClasses({ variant: "secondary", size: "sm", className: "max-md:min-h-12 max-md:text-base" })}>
            <ChevronLeft aria-hidden="true" />
            Vorige
          </Link>
        ) : null}
        {page < pages ? (
          <Link href={hrefFor(page + 1)} className={buttonClasses({ variant: "secondary", size: "sm", className: "max-md:min-h-12 max-md:text-base" })}>
            Volgende
            <ChevronRight aria-hidden="true" />
          </Link>
        ) : null}
      </div>
    </nav>
  );
}
