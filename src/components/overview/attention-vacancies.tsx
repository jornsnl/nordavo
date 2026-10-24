import Link from "next/link";
import { Briefcase } from "lucide-react";
import {
  type AttentionSignal,
  PROMISED_CANDIDATES,
  PROMISED_DAYS,
  getVacanciesNeedingAttention,
} from "@/lib/data/stats";
import type { Tone } from "@/lib/labels";
import { Badge } from "@/components/ui/badge";

const signals: Record<AttentionSignal, { label: string; tone: Tone }> = {
  late: { label: `Over de ${PROMISED_DAYS} dagen`, tone: "danger" },
  soon: { label: "Laatste week", tone: "warning" },
  on_track: { label: "Op schema", tone: "neutral" },
  done: { label: "3 voorgesteld", tone: "success" },
};

/** Open vacancies by days open, against the "3 candidates in 3 weeks" promise. */
export async function AttentionVacancies() {
  const { items, total } = await getVacanciesNeedingAttention(6);

  if (items.length === 0) {
    return (
      <div className="flex items-center gap-3 px-5 py-6 text-sm text-muted">
        <Briefcase className="size-5 shrink-0 text-brand-200" aria-hidden="true" />
        Geen open vacatures. Tijd om klanten te bellen.
      </div>
    );
  }

  return (
    <>
      <ul className="divide-y divide-border">
        {items.map((vacancy) => {
          const signal = signals[vacancy.signal];
          const progress = Math.min(1, vacancy.presented / PROMISED_CANDIDATES);
          return (
            <li key={vacancy.id}>
              <Link
                href={`/dashboard/vacatures/${vacancy.id}`}
                className="flex flex-col gap-2 px-5 py-3.5 transition hover:bg-brand-50/40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-500 sm:flex-row sm:items-center sm:gap-4"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink">{vacancy.title}</p>
                  <p className="truncate text-xs text-muted">
                    {vacancy.client?.name ?? "Onbekende klant"}, {vacancy.daysOpen}{" "}
                    {vacancy.daysOpen === 1 ? "dag" : "dagen"} open
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-24">
                    <p className="mb-1 text-xs text-muted tabular-nums">
                      {vacancy.presented} van {PROMISED_CANDIDATES} voorgesteld
                    </p>
                    <div className="h-1.5 overflow-hidden rounded-full bg-brand-100" aria-hidden="true">
                      <div
                        className={`h-full rounded-full ${vacancy.signal === "late" ? "bg-danger" : "bg-brand-600"}`}
                        style={{ width: `${progress * 100}%` }}
                      />
                    </div>
                  </div>
                  <Badge tone={signal.tone}>{signal.label}</Badge>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
      {total > items.length && (
        <p className="border-t border-border px-5 py-3 text-xs text-muted">
          En nog {total - items.length} andere open{" "}
          {total - items.length === 1 ? "vacature" : "vacatures"}.{" "}
          <Link href="/dashboard/vacatures" className="font-semibold text-brand-600 hover:underline">
            Alle vacatures
          </Link>
        </p>
      )}
    </>
  );
}
