import type { VacancyStatus } from "@/lib/database.types";

/**
 * Days open against the promise "3 candidates within 3 weeks":
 * green under 14 days, amber 14 to 21, red over 21 while the vacancy is open.
 * Talent pool vacancies have no clock, so they never get a signal.
 */
export function daysOpenSignal(days: number, status: VacancyStatus, talentPool = false) {
  if (talentPool || status !== "open") return "neutral" as const;
  if (days > 21) return "danger" as const;
  if (days >= 14) return "warning" as const;
  return "success" as const;
}

const styles = {
  neutral: { dot: "bg-slate-300", text: "text-muted" },
  success: { dot: "bg-emerald-500", text: "text-emerald-700" },
  warning: { dot: "bg-amber-500", text: "text-amber-800" },
  danger: { dot: "bg-danger", text: "text-danger" },
};

const hints = {
  neutral: "",
  success: "Well within 3 weeks",
  warning: "Nearing 3 weeks",
  danger: "Past 3 weeks",
};

export function DaysOpen({
  days,
  status,
  talentPool = false,
  showHint = false,
}: {
  days: number;
  status: VacancyStatus;
  /** Talent pool vacancy: shows "No clock" instead of the days. */
  talentPool?: boolean;
  showHint?: boolean;
}) {
  if (talentPool) {
    return (
      <span className="inline-flex items-center gap-2 whitespace-nowrap font-medium text-muted">
        <span aria-hidden="true" className={`size-2.5 shrink-0 rounded-full ${styles.neutral.dot}`} />
        No clock
        {showHint && <span className="font-normal">Talent pool, starts when linked to a client</span>}
      </span>
    );
  }
  const signal = daysOpenSignal(days, status);
  const { dot, text } = styles[signal];
  const label = days === 1 ? "1 day" : `${days} days`;
  return (
    <span className={`inline-flex items-center gap-2 whitespace-nowrap font-medium ${text}`}>
      <span aria-hidden="true" className={`size-2.5 shrink-0 rounded-full ${dot}`} />
      {label}
      {signal !== "neutral" &&
        (showHint ? (
          <span className="font-normal text-muted">{hints[signal]}</span>
        ) : (
          <span className="sr-only">, {hints[signal]}</span>
        ))}
    </span>
  );
}
