import Link from "next/link";
import {
  CalendarCheck,
  CalendarDays,
  CalendarRange,
  Clock,
  Download,
  FileText,
  HeartPulse,
  Palmtree,
  Repeat,
  Triangle,
  UserRound,
} from "lucide-react";
import type { AcademyLocale, AcademyReviewRow } from "@/lib/academy/database";
import { t } from "@/lib/academy/i18n";
import type { PlacementPage } from "@/lib/academy/placement/data";
import { leaveSummary, OPEN_LEAVE } from "@/lib/academy/placement/leave";
import { canTick, ritualConsistency, ritualsNow, type Consistency, type RitualLike } from "@/lib/academy/placement/rituals";
import { milestoneState, parseReviewAnswers, reviewOpen } from "@/lib/academy/placement/timeline";
import { convertWallTime, formatAcademyDate, formatAcademyDateTime } from "@/lib/academy/time";
import { Panel } from "@/components/academy/ui";
import { CancelLeaveButton, CopyLink, LeaveForm, PulseForm, ReviewForm, RitualTick } from "./client";

// Sections of the placement page (/academy/placements/[id]). Server
// components; the interactive parts are in ./client.tsx.

type Ctx = { page: PlacementPage; locale: AcademyLocale; timeZone: string; userId: string; isManager: boolean };

function Title({ icon: Icon, children }: { icon: typeof Clock; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-2">
      <Icon className="size-4 text-academy-blue-600" aria-hidden="true" />
      {children}
    </span>
  );
}

const otherZone = (zone: string) => (zone === "Asia/Kolkata" ? "Europe/Amsterdam" : "Asia/Kolkata");

export function weekdayName(dateIso: string, locale: AcademyLocale) {
  const [y, m, d] = dateIso.split("-").map(Number);
  return new Intl.DateTimeFormat(locale === "nl" ? "nl-NL" : "en-GB", { weekday: "long", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}

function SideCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-academy-blue-50 p-4">
      <p className="text-xs font-semibold tracking-wide text-academy-blue-700 uppercase">{label}</p>
      <div className="mt-2 space-y-2">{children}</div>
    </div>
  );
}

function Person({ name, email, role }: { name: string | null; email: string | null; role?: string }) {
  return (
    <div className="flex items-start gap-2">
      <UserRound className="mt-0.5 size-4 shrink-0 text-academy-blue-500" aria-hidden="true" />
      <div className="min-w-0">
        <p className="font-medium text-academy-blue-900">{name ?? "—"}</p>
        <p className="truncate text-xs text-muted">
          {role}
          {role && email ? " · " : ""}
          {email && (
            <a href={`mailto:${email}`} className="hover:underline">
              {email}
            </a>
          )}
        </p>
      </div>
    </div>
  );
}

/** The triangle: client contacts, developer, Nordavo with the response time. */
export function TrianglePanel({ page, locale }: Ctx) {
  const { placement, people } = page;
  const clients = people.filter((p) => p.role !== "developer");
  const developer = people.find((p) => p.role === "developer");
  return (
    <Panel title={<Title icon={Triangle}>{t(locale, "pl.triangle")}</Title>}>
      <p className="mb-4 text-sm text-muted">{t(locale, "pl.triangleText")}</p>
      <div className="grid gap-3 md:grid-cols-3">
        <SideCard label={`${t(locale, "pl.side.client")} · ${placement.client_name ?? ""}`}>
          {clients.length === 0 ? <p className="text-sm text-muted">—</p> : clients.map((p) => (
            <Person key={p.profile_id} name={p.full_name} email={p.email} role={t(locale, `pl.role.${p.role}`)} />
          ))}
        </SideCard>
        <SideCard label={t(locale, "pl.side.developer")}>
          <Person name={developer?.full_name ?? placement.developer_name} email={developer?.email ?? null} role={placement.developer_title ?? undefined} />
        </SideCard>
        <SideCard label={t(locale, "pl.side.nordavo")}>
          <Person name={placement.nordavo_contact_name ?? t(locale, "pl.noContact")} email={placement.nordavo_contact_email} />
          <p className="flex items-center gap-1.5 text-sm text-academy-blue-800">
            <Clock className="size-4" aria-hidden="true" />
            {t(locale, "pl.responseTime", { hours: placement.nordavo_response_hours })}
          </p>
        </SideCard>
      </div>
    </Panel>
  );
}

/** Overlap window in the viewer's zone (and the other side's), dates and hours. */
export function FactsPanel({ page, locale, timeZone }: Ctx) {
  const { placement, today } = page;
  const window = (zone: string) =>
    placement.overlap_start && placement.overlap_end
      ? `${convertWallTime(placement.overlap_start, placement.overlap_time_zone, zone, today)}–${convertWallTime(placement.overlap_end, placement.overlap_time_zone, zone, today)}`
      : null;
  const mine = window(timeZone);
  const other = otherZone(timeZone);
  const rows: [string, React.ReactNode][] = [
    [t(locale, "pl.overlapYours"), mine ? (
      <span>
        <span className="font-semibold">{mine}</span>
        <span className="ml-2 text-xs text-muted">{t(locale, "pl.overlapOther", { zone: t(locale, `tz.${other}` as "tz.Asia/Kolkata") })}: {window(other)}</span>
      </span>
    ) : t(locale, "pl.noOverlap")],
    [t(locale, "placement.start"), formatAcademyDate(placement.start_date, locale, timeZone)],
    [t(locale, "placement.hours"), placement.hours_per_week ?? "—"],
    [t(locale, "placement.probation"), formatAcademyDate(placement.probation_end_date, locale, timeZone, "—")],
  ];
  if (placement.end_date) rows.push([t(locale, "pl.endDate"), formatAcademyDate(placement.end_date, locale, timeZone)]);
  return (
    <Panel title={<Title icon={CalendarRange}>{t(locale, "pl.facts")}</Title>}>
      <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[max-content_1fr]">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted">{label}</dt>
            <dd className="text-academy-blue-900">{value}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

/** Rituals now (one click) and the consistency over the weeks. */
export function RitualsPanel({ page, locale, isManager }: Ctx) {
  const role = page.placement.my_role;
  const items = ritualsNow(page.rituals as RitualLike[], page.logs, page.today);
  const consistency = ritualConsistency(page.rituals as RitualLike[], page.logs, { startDate: page.placement.start_date, today: page.today });
  return (
    <Panel title={<Title icon={Repeat}>{t(locale, "rituals.title")}</Title>}>
      {items.length === 0 ? (
        <p className="text-sm text-muted">{t(locale, "rituals.none")}</p>
      ) : (
        <>
          <p className="mb-3 text-sm text-muted">{t(locale, "rituals.text")}</p>
          <ul className="divide-y divide-academy-blue-100">
            {items.map((item) => (
              <li key={`${item.ritual.id}-${item.periodDate}`} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="font-medium text-academy-blue-900">{item.ritual.title}</p>
                  <p className="text-xs text-muted">
                    {t(locale, `rituals.cadence.${item.ritual.cadence}`)} · {t(locale, `rituals.audience.${item.ritual.audience}`)} ·{" "}
                    {item.ritual.cadence === "daily"
                      ? `${t(locale, "rituals.today")} · ${t(locale, "rituals.weekCount", { done: item.doneThisWeek ?? 0, total: item.expectedThisWeek ?? 0 })}`
                      : item.ritual.cadence === "weekly"
                        ? `${t(locale, "rituals.thisWeek")}, ${t(locale, "rituals.onDay", { day: weekdayName(item.dueDate, locale) })}`
                        : t(locale, "rituals.thisMonth")}
                  </p>
                </div>
                <RitualTick
                  ritualId={item.ritual.id}
                  placementId={page.placement.id}
                  periodDate={item.periodDate}
                  done={item.done}
                  canTick={canTick(item.ritual.audience, role, isManager)}
                  locale={locale}
                />
              </li>
            ))}
          </ul>
          <ConsistencyGrid consistency={consistency} rituals={page.rituals as RitualLike[]} locale={locale} />
        </>
      )}
    </Panel>
  );
}

/** Weeks as columns, rituals as rows: done of expected. */
export function ConsistencyGrid({ consistency, rituals, locale }: { consistency: Consistency; rituals: RitualLike[]; locale: AcademyLocale }) {
  if (consistency.weeks.length === 0) return null;
  const tone = (done: number, expected: number) =>
    expected === 0 ? "bg-slate-50 text-slate-400" : done >= expected ? "bg-emerald-100 text-emerald-800" : done === 0 ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-800";
  const byId = new Map(rituals.map((r) => [r.id, r]));
  const short = (dateIso: string) => formatAcademyDate(dateIso, locale, "UTC").replace(/ \d{4}$/, "");
  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-academy-blue-900">{t(locale, "rituals.consistency")}</h3>
        {consistency.percent !== null && <p className="text-xs text-muted">{t(locale, "rituals.consistencyTotal", { percent: consistency.percent })}</p>}
      </div>
      <div className="mt-2 relative overflow-x-auto">
        <table className="w-full min-w-max border-separate border-spacing-1 text-xs">
          <thead>
            <tr>
              <th className="text-left font-medium text-muted" />
              {consistency.weeks.map((w) => (
                <th key={w.weekStart} scope="col" className="px-1 text-center font-medium whitespace-nowrap text-muted" title={t(locale, "rituals.week", { date: short(w.weekStart) })}>
                  {short(w.weekStart)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {consistency.weeks[0].rituals.map((r) => (
              <tr key={r.id}>
                <th scope="row" className="pr-2 text-left font-medium whitespace-nowrap text-academy-blue-900">{byId.get(r.id)?.title}</th>
                {consistency.weeks.map((w) => {
                  const cell = w.rituals.find((x) => x.id === r.id) ?? { done: 0, expected: 0 };
                  return (
                    <td key={w.weekStart} className={`rounded-md px-2 py-1 text-center tabular-nums ${tone(cell.done, cell.expected)}`}>
                      {cell.expected === 0 ? "–" : `${cell.done}/${cell.expected}`}
                    </td>
                  );
                })}
              </tr>
            ))}
            {consistency.months.length > 0 &&
              consistency.months[0].rituals.map((r) => (
                <tr key={r.id}>
                  <th scope="row" className="pr-2 text-left font-medium whitespace-nowrap text-academy-blue-900">
                    {byId.get(r.id)?.title} <span className="font-normal text-muted">({t(locale, "rituals.monthly")})</span>
                  </th>
                  <td colSpan={consistency.weeks.length} className="px-1">
                    <span className="flex gap-1">
                      {consistency.months.map((m) => {
                        const done = m.rituals.find((x) => x.id === r.id)?.done ?? false;
                        return (
                          <span key={m.month} className={`rounded-md px-2 py-1 ${done ? "bg-emerald-100 text-emerald-800" : "bg-slate-50 text-slate-500"}`}>
                            {new Intl.DateTimeFormat(locale === "nl" ? "nl-NL" : "en-GB", { month: "short", timeZone: "UTC" }).format(new Date(`${m.month}T00:00:00Z`))}
                            {done ? " ✓" : ""}
                          </span>
                        );
                      })}
                    </span>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function milestoneLabel(kind: string, title: string, locale: AcademyLocale) {
  return kind === "custom" ? title : t(locale, `timeline.${kind as "day_1"}`);
}

const stateTone = {
  done: "bg-emerald-50 text-emerald-700 ring-emerald-600/15",
  due: "bg-academy-orange-50 text-academy-orange-700 ring-academy-orange-600/20",
  overdue: "bg-rose-50 text-rose-700 ring-rose-600/15",
  upcoming: "bg-academy-blue-100 text-academy-blue-800 ring-academy-blue-300/40",
};

/** Day 1, week 1, 30 days, 90-day review: form for client and developer, report by Nordavo. */
export function TimelinePanel({ page, locale, timeZone, userId }: Ctx) {
  const role = page.placement.my_role;
  const canFill = role === "client_admin" || role === "client_member" || role === "developer";
  const reviewsOf = (milestoneId: string) => page.reviews.filter((r) => r.milestone_id === milestoneId);
  return (
    <Panel title={<Title icon={CalendarCheck}>{t(locale, "timeline.title")}</Title>}>
      <p className="mb-4 text-sm text-muted">{t(locale, "timeline.text")}</p>
      <ol className="relative space-y-5 border-l-2 border-academy-blue-100 pl-5">
        {page.milestones.map((m) => {
          const state = milestoneState(m, page.today);
          const reviews = reviewsOf(m.id);
          const mine = reviews.find((r) => r.kind === "form" && r.author_id === userId) ?? null;
          const report = reviews.find((r) => r.kind === "report" && r.status === "submitted") ?? null;
          const others = reviews.filter((r) => r.kind === "form" && r.author_id !== userId && r.status === "submitted");
          const open = reviewOpen(m, page.today);
          return (
            <li key={m.id} className="relative">
              <span aria-hidden="true" className={`absolute top-1 -left-[27px] size-3 rounded-full ring-4 ring-white ${state === "done" ? "bg-emerald-500" : state === "upcoming" ? "bg-academy-blue-300" : "bg-academy-orange-500"}`} />
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-semibold text-academy-blue-900">{milestoneLabel(m.kind, m.title, locale)}</h3>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${stateTone[state]}`}>{t(locale, `timeline.state.${state}`)}</span>
                <span className="text-sm text-muted">{formatAcademyDate(m.due_date, locale, timeZone)}</span>
              </div>
              {canFill && (
                <div className="mt-2">
                  {mine?.status === "submitted" ? (
                    <p className="text-sm text-emerald-700">{t(locale, "timeline.submittedOn", { date: formatAcademyDateTime(mine.submitted_at, locale, timeZone) })}</p>
                  ) : open ? (
                    <details className="group rounded-xl border border-academy-blue-200 bg-academy-blue-50/40 open:bg-white">
                      <summary className="cursor-pointer list-none px-4 py-2.5 text-sm font-semibold text-academy-orange-700 marker:hidden">
                        {mine ? t(locale, "timeline.edit") : t(locale, "timeline.fill")}
                      </summary>
                      <div className="border-t border-academy-blue-100 p-4">
                        <ReviewForm placementId={page.placement.id} milestoneId={m.id} initial={parseReviewAnswers(mine?.answers)} locale={locale} />
                      </div>
                    </details>
                  ) : state !== "done" ? (
                    <p className="text-xs text-muted">{t(locale, "timeline.formClosed")}</p>
                  ) : null}
                </div>
              )}
              {others.length > 0 && <ReviewList reviews={others} page={page} locale={locale} />}
              {report ? (
                <div className="mt-3 rounded-xl bg-academy-blue-50 p-4">
                  <p className="text-xs font-semibold tracking-wide text-academy-blue-700 uppercase">{t(locale, "timeline.report")}</p>
                  <p className="mt-1 text-sm whitespace-pre-line text-academy-blue-900">{report.report}</p>
                </div>
              ) : (
                state !== "upcoming" && <p className="mt-2 text-xs text-muted">{t(locale, "timeline.noReport")}</p>
              )}
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}

function ReviewList({ reviews, page, locale }: { reviews: AcademyReviewRow[]; page: PlacementPage; locale: AcademyLocale }) {
  const names = new Map(page.people.map((p) => [p.profile_id, p.full_name]));
  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-sm font-medium text-academy-blue-800">{t(locale, "review.others")} ({reviews.length})</summary>
      <ul className="mt-2 space-y-2">
        {reviews.map((r) => {
          const a = parseReviewAnswers(r.answers);
          return (
            <li key={r.id} className="rounded-xl border border-academy-blue-100 p-3 text-sm">
              <p className="font-medium text-academy-blue-900">
                {names.get(r.author_id ?? "") ?? "—"}
                {a.rating && <span className="ml-2 text-academy-orange-700">{a.rating}/5</span>}
              </p>
              {(["going_well", "improve", "support"] as const).map((k) =>
                a[k] ? (
                  <p key={k} className="mt-1">
                    <span className="text-muted">{t(locale, `review.${k}`)} </span>
                    {a[k]}
                  </p>
                ) : null,
              )}
            </li>
          );
        })}
      </ul>
    </details>
  );
}

const leaveTone: Record<string, string> = {
  requested: "bg-academy-blue-100 text-academy-blue-800",
  client_agreed: "bg-amber-50 text-amber-800",
  approved: "bg-emerald-50 text-emerald-700",
  rejected: "bg-rose-50 text-rose-700",
  cancelled: "bg-slate-100 text-slate-500",
};

/** Balance and requests; the developer asks for leave here. */
export function LeavePanel({ page, locale, timeZone, userId }: Ctx) {
  const year = Number(page.today.slice(0, 4));
  const developer = page.people.find((p) => p.role === "developer");
  const balance = page.balances.find((b) => b.year === year && b.profile_id === developer?.profile_id) ?? null;
  const summary = leaveSummary(balance, page.leave.filter((l) => l.profile_id === developer?.profile_id), year);
  const isDeveloper = page.placement.my_role === "developer";
  return (
    <Panel title={<Title icon={Palmtree}>{t(locale, "leave.title")}</Title>}>
      <p className="mb-4 text-sm text-muted">{t(locale, "leave.text")}</p>
      <h3 className="text-sm font-semibold text-academy-blue-900">{t(locale, "leave.balance", { year })}</h3>
      {summary.hasBalance ? (
        <dl className="mt-2 grid grid-cols-4 gap-2 text-center">
          {([
            ["leave.total", summary.total],
            ["leave.used", summary.used],
            ["leave.pending", summary.pending],
            ["leave.remaining", summary.remaining],
          ] as const).map(([key, value]) => (
            <div key={key} className="rounded-xl bg-academy-blue-50 px-2 py-3">
              <dd className="font-display text-xl font-bold text-academy-blue-900 tabular-nums">{value}</dd>
              <dt className="text-xs text-muted">{t(locale, key)}</dt>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mt-1 text-sm text-muted">{t(locale, "leave.noBalance")}</p>
      )}

      <ul className="mt-5 divide-y divide-academy-blue-100">
        {page.leave.length === 0 && <li className="text-sm text-muted">{t(locale, "leave.none")}</li>}
        {page.leave.map((l) => (
          <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
            <div>
              <p className="text-sm font-medium text-academy-blue-900">
                {t(locale, `leave.kind.${l.kind}`)} · {t(locale, "leave.period", { from: formatAcademyDate(l.start_date, locale, timeZone), to: formatAcademyDate(l.end_date, locale, timeZone) })}
              </p>
              <p className="text-xs text-muted">
                {l.days !== null && t(locale, "leave.dayCount", { days: l.days })}
                {l.decision_note && ` · ${l.decision_note}`}
              </p>
            </div>
            <span className="flex items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${leaveTone[l.status]}`}>{t(locale, `leave.status.${l.status}`)}</span>
              {isDeveloper && l.profile_id === userId && OPEN_LEAVE.includes(l.status) && (
                <CancelLeaveButton placementId={page.placement.id} requestId={l.id} locale={locale} />
              )}
            </span>
          </li>
        ))}
      </ul>

      {isDeveloper && (
        <details className="mt-4 rounded-xl border border-academy-blue-200">
          <summary className="cursor-pointer list-none px-4 py-2.5 text-sm font-semibold text-academy-orange-700">{t(locale, "leave.request")}</summary>
          <div className="border-t border-academy-blue-100 p-4">
            <LeaveForm placementId={page.placement.id} locale={locale} today={page.today} />
          </div>
        </details>
      )}
    </Panel>
  );
}

/** Holidays of both countries and the calendar subscription. */
export function HolidaysPanel({ page, locale, timeZone, calendarUrl }: Ctx & { calendarUrl: string | null }) {
  return (
    <Panel title={<Title icon={CalendarDays}>{t(locale, "holidays.title")}</Title>}>
      <p className="mb-3 text-sm text-muted">{t(locale, "holidays.text")}</p>
      {page.holidays.length === 0 ? (
        <p className="text-sm text-muted">{t(locale, "holidays.none")}</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {page.holidays.slice(0, 12).map((h) => (
            <li key={h.id} className="flex items-start gap-3">
              <span className={`mt-0.5 w-8 shrink-0 rounded-md px-1 py-0.5 text-center text-[11px] font-bold ${h.country === "NL" ? "bg-academy-orange-50 text-academy-orange-700" : "bg-emerald-50 text-emerald-700"}`}>
                {h.country}
              </span>
              <span className="min-w-0">
                <span className="font-medium text-academy-blue-900">{locale === "nl" ? h.name_nl : h.name_en}</span>
                <span className="block text-xs text-muted">
                  {formatAcademyDate(h.date, locale, timeZone)}
                  {!h.day_off && ` · ${t(locale, "holidays.noDayOff")}`}
                  {!h.confirmed && ` · ${t(locale, "holidays.unconfirmed")}`}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {calendarUrl && (
        <div className="mt-5 border-t border-academy-blue-100 pt-4">
          <p className="text-sm font-semibold text-academy-blue-900">{t(locale, "holidays.subscribe")}</p>
          <p className="mt-1 mb-3 text-xs text-muted">{t(locale, "holidays.subscribeText")}</p>
          <CopyLink url={calendarUrl} locale={locale} />
        </div>
      )}
    </Panel>
  );
}

/** Contract summary, GDPR, policies, matrices, blocker agreement. */
export function DocumentsPanel({ page, locale }: Ctx) {
  return (
    <Panel title={<Title icon={FileText}>{t(locale, "docs.title")}</Title>}>
      <p className="mb-3 text-sm text-muted">{t(locale, "docs.text")}</p>
      {page.documents.length === 0 ? (
        <p className="text-sm text-muted">{t(locale, "docs.none")}</p>
      ) : (
        <ul className="divide-y divide-academy-blue-100">
          {page.documents.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 font-medium text-academy-blue-900">
                  {d.title}
                  {d.isNew && <span className="rounded-full bg-academy-orange-600 px-2 py-0.5 text-[11px] font-semibold text-white">{t(locale, "docs.new")}</span>}
                </p>
                <p className="text-xs text-muted">
                  {t(locale, `docs.category.${d.category as "gdpr"}`)} · {t(locale, "docs.version", { version: d.current_version })}
                  {d.scope === "global" && ` · ${t(locale, "docs.forAll")}`}
                </p>
              </div>
              {d.current_version > 0 && d.file_name && (
                <Link
                  href={`/academy/placements/${page.placement.id}/documents/${d.id}`}
                  prefetch={false}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold text-academy-orange-700 hover:bg-academy-orange-50"
                >
                  <Download className="size-4" aria-hidden="true" />
                  {t(locale, "docs.download")}
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/** The own open pulse. */
export function PulsePanel({ page, locale }: Ctx) {
  if (!page.pulse) return null;
  return (
    <div id="pulse" className="scroll-mt-20">
      <Panel title={<Title icon={HeartPulse}>{t(locale, "pulse.title")}</Title>} className="border-academy-orange-200 ring-2 ring-academy-orange-100">
        <p className="mb-4 text-sm text-muted">{t(locale, "pulse.text")}</p>
        <PulseForm placementId={page.placement.id} pulseId={page.pulse.id} locale={locale} />
      </Panel>
    </div>
  );
}
