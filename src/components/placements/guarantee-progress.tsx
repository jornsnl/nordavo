import { ShieldCheck } from "lucide-react";
import type { PlacementStatus } from "@/lib/database.types";
import { formatDate } from "@/lib/format";
import { addDays, diffDays } from "./dates";

/** Progress through the 30 day guarantee: underperformance is replaced at no cost. */
export function GuaranteeProgress({
  startDate,
  guaranteeUntil,
  status,
  today,
}: {
  startDate: string;
  guaranteeUntil: string | null;
  status: PlacementStatus;
  today: string;
}) {
  const until = guaranteeUntil ?? addDays(startDate, 30);
  const total = Math.max(1, diffDays(startDate, until));
  const elapsed = Math.min(total, Math.max(0, diffDays(startDate, today)));
  const percent = Math.round((elapsed / total) * 100);
  const daysLeft = diffDays(today, until);

  const text =
    today < startDate
      ? `Start op ${formatDate(startDate)}. Daarna loopt de garantie 30 dagen.`
      : daysLeft < 0
        ? `Afgelopen op ${formatDate(until)}.`
        : status === "ended"
          ? "De plaatsing is beëindigd binnen de garantieperiode."
          : daysLeft === 0
            ? "Loopt vandaag af."
            : `Nog ${daysLeft} ${daysLeft === 1 ? "dag" : "dagen"}, tot en met ${formatDate(until)}.`;

  const active = today >= startDate && daysLeft >= 0 && status !== "ended";

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <ShieldCheck
          className={`size-5 ${active ? "text-brand-600" : "text-muted"}`}
          aria-hidden="true"
        />
        <p className="text-sm font-medium text-ink">{text}</p>
      </div>
      <div
        role="progressbar"
        aria-label="Garantieperiode"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={elapsed}
        aria-valuetext={`${elapsed} van ${total} dagen`}
        className="h-2.5 overflow-hidden rounded-full bg-brand-100"
      >
        <div
          className={`h-full rounded-full transition-all ${
            active && daysLeft <= 7 ? "bg-accent-500" : "bg-brand-600"
          }`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="mt-2 text-xs text-muted">
        Presteert de developer niet naar verwachting? Binnen 30 dagen vervangen we kosteloos.
      </p>
    </div>
  );
}
