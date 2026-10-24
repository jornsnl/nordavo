import Link from "next/link";
import { CalendarCheck, LogOut, ShieldCheck } from "lucide-react";
import { type MomentKind, getUpcomingMoments } from "@/lib/data/stats";
import { todayIso } from "@/lib/format";
import { diffDays, formatShortDate } from "@/components/placements/dates";

const kinds: Record<MomentKind, { label: string; icon: typeof CalendarCheck }> = {
  checkin: { label: "Check-in", icon: CalendarCheck },
  guarantee: { label: "Einde garantie", icon: ShieldCheck },
  notice: { label: "Laatste werkdag", icon: LogOut },
};

function when(date: string, today: string) {
  const days = diffDays(today, date);
  if (days === 0) return "vandaag";
  if (days === 1) return "morgen";
  if (days < 0) return `${-days} ${days === -1 ? "dag" : "dagen"} te laat`;
  return `over ${days} dagen`;
}

/** Check-ins, guarantee ends and notice ends coming up. */
export async function UpcomingMoments() {
  const moments = await getUpcomingMoments();
  const today = todayIso();

  if (moments.length === 0) {
    return (
      <div className="flex items-center gap-3 px-5 py-6 text-sm text-muted">
        <CalendarCheck className="size-5 shrink-0 text-brand-200" aria-hidden="true" />
        Niets gepland voor de komende twee weken.
      </div>
    );
  }

  return (
    <ul className="divide-y divide-border">
      {moments.slice(0, 8).map((moment) => {
        const { label, icon: Icon } = kinds[moment.kind];
        return (
          <li key={`${moment.kind}-${moment.placementId}`}>
            <Link
              href={`/dashboard/plaatsingen/${moment.placementId}`}
              className="flex min-h-14 items-center gap-3 px-5 py-3 transition hover:bg-brand-50/40 active:bg-brand-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-500"
            >
              <span
                className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${
                  moment.overdue ? "bg-danger-bg text-danger" : "bg-brand-50 text-brand-600"
                }`}
              >
                <Icon className="size-[18px]" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">
                  {label}: {moment.candidateName}
                </p>
                <p className="truncate text-xs text-muted">{moment.clientName}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className={`text-sm font-medium ${moment.overdue ? "text-danger" : "text-ink"}`}>
                  {formatShortDate(moment.date)}
                </p>
                <p className={`text-xs ${moment.overdue ? "text-danger" : "text-muted"}`}>
                  {when(moment.date, today)}
                </p>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
