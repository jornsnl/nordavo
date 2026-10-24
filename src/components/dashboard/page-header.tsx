import type { ReactNode } from "react";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow && (
          <p className="mb-1.5 text-xs font-semibold tracking-wider text-accent-600 uppercase">
            {eyebrow}
          </p>
        )}
        <h1 className="font-display text-2xl font-bold tracking-tight text-brand-900 sm:text-3xl">
          {title}
        </h1>
        {description && (
          <p className="mt-2 max-w-2xl text-muted">{description}</p>
        )}
      </div>
      {/* On phones the actions fill the width, so they are easy to tap. */}
      {actions && (
        <div className="flex shrink-0 flex-wrap gap-2 max-sm:*:flex-1">{actions}</div>
      )}
    </header>
  );
}
