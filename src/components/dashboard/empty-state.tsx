import type { LucideIcon } from "lucide-react";

export function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-brand-200 bg-card px-5 py-10 text-center sm:px-6 sm:py-16">
      <span className="mb-4 flex size-12 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
        <Icon className="size-6" aria-hidden="true" />
      </span>
      <h2 className="font-display text-lg font-semibold text-brand-900">
        {title}
      </h2>
      <p className="mt-1.5 max-w-md text-sm leading-relaxed text-muted">
        {description}
      </p>
    </div>
  );
}
