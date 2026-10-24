import type { ReactNode } from "react";

export function Card({ className = "", children }: { className?: string; children: ReactNode }) {
  return (
    <section className={`rounded-2xl border border-border bg-card shadow-xs ${className}`}>
      {children}
    </section>
  );
}

export function CardHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3.5 sm:flex-nowrap sm:gap-4 sm:px-5 sm:py-4">
      <div className="min-w-0">
        <h2 className="font-display text-base font-semibold text-brand-900">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

export function CardBody({ className = "", children }: { className?: string; children: ReactNode }) {
  // A little tighter on phones; a py-* in className still wins on every screen.
  return <div className={`px-4 py-4 sm:px-5 ${className}`}>{children}</div>;
}

/** Label/value pairs for detail pages. */
export function DetailList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-4 sm:gap-x-6">
      {items.map(({ label, value }) => (
        <div key={label} className="min-w-0">
          <dt className="text-xs font-medium tracking-wide text-muted uppercase">{label}</dt>
          <dd className="mt-1 text-sm break-words text-ink">{value ?? <span className="text-muted">Niet ingevuld</span>}</dd>
        </div>
      ))}
    </dl>
  );
}
