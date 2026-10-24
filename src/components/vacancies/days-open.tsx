import type { VacancyStatus } from "@/lib/database.types";

/**
 * Days open against the promise "3 kandidaten binnen 3 weken":
 * green under 14 days, amber 14 to 21, red over 21 while the vacancy is open.
 */
export function daysOpenSignal(days: number, status: VacancyStatus) {
  if (status !== "open") return "neutral" as const;
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
  success: "Ruim binnen de 3 weken",
  warning: "Richting de 3 weken",
  danger: "Over de 3 weken heen",
};

export function DaysOpen({
  days,
  status,
  showHint = false,
}: {
  days: number;
  status: VacancyStatus;
  showHint?: boolean;
}) {
  const signal = daysOpenSignal(days, status);
  const { dot, text } = styles[signal];
  const label = days === 1 ? "1 dag" : `${days} dagen`;
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
