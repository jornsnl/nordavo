export function Skeleton({ className = "" }: { className?: string }) {
  return <span aria-hidden="true" className={`block animate-pulse rounded-lg bg-brand-100/70 ${className}`} />;
}

/** Placeholder for a table or list while it streams in. */
export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2 rounded-2xl border border-border bg-card p-4" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

/**
 * What a section shows the moment a link is tapped (loading.tsx), until the
 * page streams in: a page header and a list, so the click answers at once.
 */
export function PageSkeleton({ rows = 6, label = "Loading" }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{label}…</span>
      <div className="mb-6 space-y-3 sm:mb-8" aria-hidden="true">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-8 w-56 max-w-full" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="mb-4 flex gap-2" aria-hidden="true">
        <Skeleton className="h-10 w-28" />
        <Skeleton className="h-10 w-28" />
        <Skeleton className="h-10 w-20" />
      </div>
      <div aria-hidden="true">
        <ListSkeleton rows={rows} />
      </div>
    </div>
  );
}
