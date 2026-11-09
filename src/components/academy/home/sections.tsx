import { CalendarClock, CalendarDays, CalendarHeart, CheckSquare, Clock, Handshake, Users } from "lucide-react";
import type { AcademyMyPlacementRow, AcademyPeopleProgressRow } from "@/lib/academy/database";
import type { AcademyUser } from "@/lib/academy/auth";
import { t } from "@/lib/academy/i18n";
import { convertWallTime, formatAcademyDate, formatAcademyDateTime, localDateIso } from "@/lib/academy/time";
import { ActionLink, Panel, ProgressBar } from "@/components/academy/ui";
import { listMyOpenTasks, myTaskItem } from "@/lib/academy/learn/data";
import { TaskCheckList } from "@/components/academy/learn/task-list";

// Sections of the Academy start page (/academy). The page decides which
// sections a role sees (src/app/academy/page.tsx). The empty ones are slots
// for the next builders: they replace the body and keep the signature
// ({ user }), so the page itself does not change.

export type HomeSectionProps = { user: AcademyUser };

function Empty({ text }: { text: string }) {
  return <p className="text-sm text-muted">{text}</p>;
}

/** Open course tasks of the user and the shared tasks of their placements (area learn, academy_my_tasks). */
export async function OpenTasksSection({ user }: HomeSectionProps) {
  const open = await listMyOpenTasks();
  const shown = open.slice(0, OPEN_TASKS_SHOWN);
  return (
    <Panel title={<span className="flex items-center gap-2"><CheckSquare className="size-4 text-academy-blue-600" aria-hidden="true" />{t(user.locale, "home.openTasks")}</span>}>
      {shown.length === 0 ? (
        <Empty text={user.member ? t(user.locale, "tasks.allDone") : t(user.locale, "home.nothingYet")} />
      ) : (
        <>
          <TaskCheckList items={shown.map(myTaskItem)} locale={user.locale} timeZone={user.timeZone} showLesson />
          {open.length > shown.length && <p className="mt-3 text-xs text-muted">{t(user.locale, "tasks.more", { count: open.length - shown.length })}</p>}
        </>
      )}
    </Panel>
  );
}

const OPEN_TASKS_SHOWN = 8;

/** Rituals of this week in the user's placements. Slot: rituals builder. */
export async function RitualsSection({ user }: HomeSectionProps) {
  return (
    <Panel title={<span className="flex items-center gap-2"><CalendarDays className="size-4 text-academy-blue-600" aria-hidden="true" />{t(user.locale, "home.ritualsThisWeek")}</span>}>
      <Empty text={t(user.locale, "home.nothingYet")} />
    </Panel>
  );
}

/** Reviews, holidays and leave coming up. Slot: placement page builder. */
export async function UpcomingSection({ user }: HomeSectionProps) {
  return (
    <Panel title={<span className="flex items-center gap-2"><CalendarClock className="size-4 text-academy-blue-600" aria-hidden="true" />{t(user.locale, "home.upcoming")}</span>}>
      <Empty text={t(user.locale, "home.nothingYet")} />
    </Panel>
  );
}

/** The user's placement(s), without money (academy_my_placements). */
export function PlacementSection({ user, placements }: HomeSectionProps & { placements: AcademyMyPlacementRow[] }) {
  if (placements.length === 0) return null;
  const today = localDateIso(new Date(), user.timeZone);
  return (
    <Panel title={<span className="flex items-center gap-2"><Handshake className="size-4 text-academy-blue-600" aria-hidden="true" />{t(user.locale, "home.placement")}</span>}>
      <ul className="space-y-4">
        {placements.map((p) => {
          const other = p.my_role === "developer" ? p.client_name : p.developer_name;
          const overlap =
            p.overlap_start && p.overlap_end
              ? `${convertWallTime(p.overlap_start, p.overlap_time_zone, user.timeZone, today)}–${convertWallTime(p.overlap_end, p.overlap_time_zone, user.timeZone, today)}`
              : null;
          return (
            <li key={p.id} className="space-y-1.5">
              <p className="font-semibold text-academy-blue-900">{other ?? "—"}</p>
              {p.vacancy_title && <p className="text-sm text-muted">{p.vacancy_title}</p>}
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <dt className="text-muted">{t(user.locale, "placement.start")}</dt>
                <dd>{formatAcademyDate(p.start_date, user.locale, user.timeZone)}</dd>
                {p.hours_per_week !== null && (
                  <>
                    <dt className="text-muted">{t(user.locale, "placement.hours")}</dt>
                    <dd>{p.hours_per_week}</dd>
                  </>
                )}
                {overlap && (
                  <>
                    <dt className="flex items-center gap-1 text-muted"><Clock className="size-3.5" aria-hidden="true" />{t(user.locale, "placement.overlap")}</dt>
                    <dd>{overlap}</dd>
                  </>
                )}
                {p.probation_end_date && (
                  <>
                    <dt className="text-muted">{t(user.locale, "placement.probation")}</dt>
                    <dd>{formatAcademyDate(p.probation_end_date, user.locale, user.timeZone)}</dd>
                  </>
                )}
              </dl>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

/** Plan a call with Nordavo: the booking link of the placement's Nordavo contact, else NEXT_PUBLIC_ACADEMY_BOOKING_URL. */
export function PlanCallSection({ user, bookingUrl }: HomeSectionProps & { bookingUrl: string | null }) {
  if (!bookingUrl) return null;
  return (
    <Panel>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="flex items-center gap-2 font-semibold text-academy-blue-900">
            <CalendarHeart className="size-4 text-academy-orange-600" aria-hidden="true" />
            {t(user.locale, "home.planCall")}
          </p>
          <p className="mt-1 text-sm text-muted">{t(user.locale, "home.planCallText")}</p>
        </div>
        <ActionLink href={bookingUrl} target="_blank" rel="noopener noreferrer">
          {t(user.locale, "home.planCall")}
        </ActionLink>
      </div>
    </Panel>
  );
}

/** Client admins and readers: progress and scores of the people they follow (never answers). */
export function PeopleProgressSection({ user, rows }: HomeSectionProps & { rows: AcademyPeopleProgressRow[] }) {
  const others = rows.filter((r) => r.profile_id !== user.id);
  if (others.length === 0) return null;
  return (
    <Panel title={<span className="flex items-center gap-2"><Users className="size-4 text-academy-blue-600" aria-hidden="true" />{t(user.locale, "home.team")}</span>}>
      <ul className="divide-y divide-academy-blue-100">
        {others.map((r) => {
          const percent = r.lessons_total === 0 ? 0 : Math.round((r.lessons_done / r.lessons_total) * 100);
          return (
            <li key={`${r.profile_id}-${r.course_id}`} className="space-y-1.5 py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <p className="font-medium text-academy-blue-900">{r.full_name ?? "—"}</p>
                <p className="text-xs text-muted">{r.course_title}</p>
              </div>
              <ProgressBar percent={percent} label={r.full_name ?? ""} size="sm" />
              <p className="text-xs text-muted">
                {t(user.locale, "home.lessonsDone", { done: r.lessons_done, total: r.lessons_total })}
                {r.check_average_percent !== null && ` · ${t(user.locale, "home.checkScore", { percent: r.check_average_percent })}`}
                {r.last_active_at && ` · ${t(user.locale, "home.lastActive", { date: formatAcademyDateTime(r.last_active_at, user.locale, user.timeZone) })}`}
              </p>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
