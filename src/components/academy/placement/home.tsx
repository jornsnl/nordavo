import Link from "next/link";
import { CalendarCheck, Palmtree } from "lucide-react";
import type { AcademyLocale } from "@/lib/academy/database";
import type { AcademyUser } from "@/lib/academy/auth";
import { listMyPlacements } from "@/lib/academy/data";
import { t } from "@/lib/academy/i18n";
import { listMyRituals, listUpcoming } from "@/lib/academy/placement/data";
import { canTick, ritualsNow, type RitualLike } from "@/lib/academy/placement/rituals";
import { formatAcademyDate, localDateIso } from "@/lib/academy/time";
import { RitualTick } from "./client";
import { weekdayName } from "./sections";

// Bodies of the start page sections RitualsSection and UpcomingSection
// (src/components/academy/home/sections.tsx), area placement.

/** Link from the placement card on the start page. */
export function PlacementPageLink({ placementId, locale }: { placementId: string; locale: AcademyLocale }) {
  return (
    <Link href={`/academy/placements/${placementId}`} className="inline-block text-sm font-medium text-academy-orange-700 hover:underline">
      {t(locale, "pl.open")}
    </Link>
  );
}

/** This week's rituals of the user's placements, with a one-click tick. */
export async function HomeRituals({ user }: { user: AcademyUser }) {
  const placements = user.member ? await listMyPlacements() : [];
  const overviews = (await listMyRituals(user, placements)).filter((o) => o.rituals.length > 0);
  const today = localDateIso(new Date(), user.timeZone);
  if (overviews.length === 0) return <p className="text-sm text-muted">{t(user.locale, "home.nothingYet")}</p>;
  return (
    <div className="space-y-5">
      {overviews.map((o) => (
        <div key={o.placementId}>
          {overviews.length > 1 && <p className="mb-2 text-xs font-semibold tracking-wide text-academy-blue-700 uppercase">{o.title}</p>}
          <ul className="divide-y divide-academy-blue-100">
            {ritualsNow(o.rituals as RitualLike[], o.logs, today).map((item) => (
              <li key={item.ritual.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="font-medium text-academy-blue-900">{item.ritual.title}</p>
                  <p className="text-xs text-muted">
                    {item.ritual.cadence === "daily"
                      ? `${t(user.locale, "rituals.today")} · ${t(user.locale, "rituals.weekCount", { done: item.doneThisWeek ?? 0, total: item.expectedThisWeek ?? 0 })}`
                      : item.ritual.cadence === "weekly"
                        ? `${t(user.locale, "rituals.thisWeek")}, ${t(user.locale, "rituals.onDay", { day: weekdayName(item.dueDate, user.locale) })}`
                        : t(user.locale, "rituals.thisMonth")}
                  </p>
                </div>
                <RitualTick
                  ritualId={item.ritual.id}
                  placementId={o.placementId}
                  periodDate={item.periodDate}
                  done={item.done}
                  canTick={canTick(item.ritual.audience, o.role, false)}
                  locale={user.locale}
                  compact
                />
              </li>
            ))}
          </ul>
          <div className="mt-3">
            <PlacementPageLink placementId={o.placementId} locale={user.locale} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Reviews of the timeline, holidays of both countries, leave: the coming six weeks. */
export async function HomeUpcoming({ user }: { user: AcademyUser }) {
  const placements = user.member ? await listMyPlacements() : [];
  const items = (await listUpcoming(user, placements)).slice(0, 10);
  if (items.length === 0) return <p className="text-sm text-muted">{t(user.locale, "upcoming.nothing")}</p>;
  const locale = user.locale;
  return (
    <ul className="space-y-3">
      {items.map((item, i) => {
        const date = formatAcademyDate(item.date, locale, user.timeZone);
        const icon =
          item.kind === "review" ? (
            <CalendarCheck className="size-4 text-academy-orange-600" aria-hidden="true" />
          ) : item.kind === "leave" ? (
            <Palmtree className="size-4 text-emerald-600" aria-hidden="true" />
          ) : (
            <span className={`rounded px-1 text-[10px] font-bold ${item.country === "NL" ? "bg-academy-orange-50 text-academy-orange-700" : "bg-emerald-50 text-emerald-700"}`}>
              {item.country}
            </span>
          );
        const label =
          item.kind === "review"
            ? t(locale, "upcoming.review", {
                name: item.milestoneKind && item.milestoneKind !== "custom" ? t(locale, `timeline.${item.milestoneKind}`) : item.label,
              })
            : item.kind === "leave"
              ? t(locale, "upcoming.leave", { name: item.label })
              : item.label;
        const sub =
          item.kind === "leave" && item.endDate
            ? `${t(locale, "leave.period", { from: date, to: formatAcademyDate(item.endDate, locale, user.timeZone) })} · ${t(locale, `leave.status.${item.status ?? "requested"}`)}`
            : item.kind === "holiday"
              ? [date, item.dayOff === false ? t(locale, "holidays.noDayOff") : null, item.confirmed === false ? t(locale, "holidays.unconfirmed") : null]
                  .filter(Boolean)
                  .join(" · ")
              : date;
        const body = (
          <span className="flex items-start gap-3">
            <span className="mt-0.5 flex w-7 shrink-0 justify-center">{icon}</span>
            <span className="min-w-0">
              <span className="block text-sm font-medium text-academy-blue-900">{label}</span>
              <span className="block text-xs text-muted">{sub}</span>
            </span>
          </span>
        );
        return (
          <li key={`${item.kind}-${item.date}-${i}`}>
            {item.placementId ? (
              <Link href={`/academy/placements/${item.placementId}`} className="-m-1 block rounded-lg p-1 hover:bg-academy-blue-50">
                {body}
              </Link>
            ) : (
              body
            )}
          </li>
        );
      })}
    </ul>
  );
}
