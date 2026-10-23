import { ShieldCheck } from "lucide-react";
import { optionFor, placementStatuses } from "@/lib/labels";
import type { PlacementStatus } from "@/lib/database.types";
import { Badge } from "@/components/ui/badge";
import { diffDays, formatShortDate } from "./dates";

export function PlacementStatusBadge({ status }: { status: PlacementStatus }) {
  const option = optionFor(placementStatuses, status);
  return <Badge tone={option.tone}>{option.label}</Badge>;
}

/** "Garantie tot 12 nov" while the 30 day guarantee is running. */
export function GuaranteeBadge({
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
  if (!guaranteeUntil || status === "ended") return null;
  if (today > guaranteeUntil) return null;
  if (today < startDate) {
    return <Badge tone="neutral">Garantie start {formatShortDate(startDate)}</Badge>;
  }
  const daysLeft = diffDays(today, guaranteeUntil);
  return (
    <Badge tone={daysLeft <= 7 ? "warning" : "brand"}>
      <ShieldCheck className="size-3.5" aria-hidden="true" />
      Garantie tot {formatShortDate(guaranteeUntil)}
    </Badge>
  );
}

/** Next check-in date, red when overdue. */
export function CheckinDate({
  date,
  status,
  today,
}: {
  date: string | null;
  status: PlacementStatus;
  today: string;
}) {
  if (!date || status === "ended") return <span className="text-muted">Niet gepland</span>;
  const overdue = date < today;
  return (
    <span className={overdue ? "font-semibold text-danger" : undefined}>
      {formatShortDate(date)}
      {overdue && <span className="ml-1 text-xs font-medium">(te laat)</span>}
      {date === today && <span className="ml-1 text-xs font-medium text-accent-600">(vandaag)</span>}
    </span>
  );
}
