import Link from "next/link";
import { ArrowRight, CalendarDays } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { PortalVacancySummary } from "@/lib/data/portal";
import { daysBetween, formatDate } from "@/lib/format";
import { optionFor, vacancyStatuses } from "@/lib/labels";

/** Nordavo presents three candidates per vacancy. */
export const CANDIDATES_PER_VACANCY = 3;

export function daysOpen(openedAt: string, closedAt: string | null) {
  return Math.max(0, daysBetween(openedAt, closedAt ?? new Date()));
}

export function presentedLabel(count: number) {
  return count > CANDIDATES_PER_VACANCY
    ? `${count} kandidaten voorgesteld`
    : `${count} van ${CANDIDATES_PER_VACANCY} kandidaten voorgesteld`;
}

export function VacancyCard({ vacancy }: { vacancy: PortalVacancySummary }) {
  const status = optionFor(vacancyStatuses, vacancy.status);
  const days = daysOpen(vacancy.openedAt, vacancy.closedAt);
  const isOpen = vacancy.status === "open" || vacancy.status === "on_hold";

  return (
    <Link
      href={`/portaal/vacatures/${vacancy.id}`}
      className="group flex h-full flex-col rounded-2xl border border-border bg-card p-5 shadow-xs transition hover:border-brand-200 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-display font-semibold text-brand-900 group-hover:text-brand-700">{vacancy.title}</h3>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>
      <p className="mt-2 flex items-center gap-1.5 text-xs text-muted">
        <CalendarDays className="size-3.5" aria-hidden="true" />
        Geopend op {formatDate(vacancy.openedAt)}
        {isOpen ? `, ${days} ${days === 1 ? "dag" : "dagen"} open` : ""}
      </p>

      <div className="mt-4">
        <p className="text-sm text-ink">{presentedLabel(vacancy.presentedCount)}</p>
        <div className="mt-2 flex gap-1" aria-hidden="true">
          {Array.from({ length: CANDIDATES_PER_VACANCY }, (_, i) => (
            <span
              key={i}
              className={`h-1.5 flex-1 rounded-full ${i < vacancy.presentedCount ? "bg-brand-600" : "bg-brand-100"}`}
            />
          ))}
        </div>
      </div>

      <div className="mt-auto flex items-center justify-between gap-3 pt-4">
        {vacancy.pendingCount > 0 ? (
          <span className="rounded-full bg-accent-100 px-2.5 py-1 text-xs font-semibold text-accent-600">
            {vacancy.pendingCount} {vacancy.pendingCount === 1 ? "wacht" : "wachten"} op jouw reactie
          </span>
        ) : (
          <span className="text-xs text-muted">Geen actie nodig</span>
        )}
        <ArrowRight className="size-4 text-muted transition group-hover:translate-x-0.5 group-hover:text-brand-700" aria-hidden="true" />
      </div>
    </Link>
  );
}
