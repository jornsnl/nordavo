import Link from "next/link";
import { ArrowLeft, ClipboardList, Send, Table2 } from "lucide-react";

const items = [
  { key: "form", label: "Form", icon: ClipboardList, href: (id: string) => `/dashboard/vacancies/${id}/form` },
  { key: "tracking", label: "Send & track", icon: Send, href: (id: string) => `/dashboard/vacancies/${id}/form/tracking` },
  { key: "responses", label: "Responses", icon: Table2, href: (id: string) => `/dashboard/vacancies/${id}/responses` },
] as const;

/** Back link and tabs shared by the form pages of a vacancy. */
export function FormNav({ vacancyId, active }: { vacancyId: string; active: (typeof items)[number]["key"] }) {
  return (
    <div className="mb-4 space-y-4">
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <Link
          href={`/dashboard/vacancies/${vacancyId}`}
          className="inline-flex items-center gap-1.5 rounded-lg text-sm font-medium text-muted hover:text-brand-700 focus-visible:outline-2 focus-visible:outline-brand-500 pointer-coarse:min-h-11"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back to vacancy
        </Link>
        <Link
          href={`/dashboard/vacancies/${vacancyId}/pipeline`}
          className="inline-flex items-center gap-1.5 rounded-lg text-sm font-medium text-muted hover:text-brand-700 focus-visible:outline-2 focus-visible:outline-brand-500 pointer-coarse:min-h-11"
        >
          Pipeline
        </Link>
      </div>
      <nav aria-label="Application form" className="flex gap-1 overflow-x-auto rounded-xl border border-border bg-card p-1 shadow-xs sm:inline-flex">
        {items.map((item) => {
          const Icon = item.icon;
          const current = item.key === active;
          return (
            <Link
              key={item.key}
              href={item.href(vacancyId)}
              aria-current={current ? "page" : undefined}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-brand-500 pointer-coarse:min-h-10 ${
                current ? "bg-brand-700 text-white" : "text-brand-900 hover:bg-brand-50"
              }`}
            >
              <Icon className="size-4" aria-hidden="true" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
