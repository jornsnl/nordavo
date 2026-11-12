import Link from "next/link";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { todayIso } from "@/lib/format";
import {
  addDays,
  agendaGroups,
  agendaKinds,
  agendaViews,
  buildAgenda,
  filterAgenda,
  groupByDay,
  isIsoDate,
  monthWeeks,
  parseGroups,
  parseView,
  roleOverview,
  shiftAnchor,
  startOfMonth,
  viewRange,
  type AgendaGroup,
  type AgendaItem,
  type AgendaScope,
  type AgendaTone,
  type AgendaView as View,
  type RoleRow,
} from "@/lib/recruitment/agenda";
import { loadAgenda } from "@/lib/recruitment/agenda-data";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const toneStyles: Record<AgendaTone, string> = {
  neutral: "border-l-slate-300 bg-slate-50",
  brand: "border-l-brand-500 bg-brand-50/60",
  accent: "border-l-accent-500 bg-accent-100/50",
  success: "border-l-emerald-500 bg-emerald-50",
  warning: "border-l-amber-500 bg-amber-50",
  danger: "border-l-danger bg-danger-bg",
};

const weekdayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function dayTitle(iso: string, options: Intl.DateTimeFormatOptions = { weekday: "long", day: "numeric", month: "long" }) {
  return new Intl.DateTimeFormat("en-GB", { ...options, timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
}

function rangeTitle(view: View, from: string, to: string, anchor: string) {
  if (view === "day") return dayTitle(anchor, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  if (view === "month") return dayTitle(startOfMonth(anchor), { month: "long", year: "numeric" });
  return `${dayTitle(from, { day: "numeric", month: "short" })} to ${dayTitle(to, { day: "numeric", month: "short", year: "numeric" })}`;
}

export async function AgendaView({ searchParams }: { searchParams: Promise<Params> }) {
  const [params, user] = await Promise.all([searchParams, getCurrentUser()]);
  const today = todayIso();
  const view = parseView(one(params.view));
  const dateParam = one(params.date);
  const anchor = isIsoDate(dateParam) ? (dateParam as string) : today;
  const scope: AgendaScope = one(params.scope) === "mine" ? "mine" : "team";
  const groups = parseGroups(one(params.kinds));
  const { from, to } = viewRange(view, anchor);

  const input = await loadAgenda(from, to);
  const all = buildAgenda(input, today);
  const items = filterAgenda(all, { from, to, groups, scope, userId: user.id });

  const current = {
    view: view === "week" ? undefined : view,
    date: anchor === today ? undefined : anchor,
    scope: scope === "team" ? undefined : scope,
    kinds: groups.length > 0 ? groups.join(",") : undefined,
  };
  const href = (change: Partial<Record<keyof typeof current, string | undefined>>) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...current, ...change })) if (value) next.set(key, value);
    const query = next.toString();
    return query ? `/dashboard/agenda?${query}` : "/dashboard/agenda";
  };
  const toggleGroup = (g: AgendaGroup) => {
    const set = new Set(groups);
    if (set.has(g)) set.delete(g);
    else set.add(g);
    return href({ kinds: set.size === 0 || set.size === agendaGroups.length ? undefined : [...set].join(",") });
  };

  const chip = (active: boolean) =>
    `inline-flex min-h-9 items-center rounded-full border px-3.5 text-sm font-medium whitespace-nowrap transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 pointer-coarse:min-h-10 ${
      active ? "border-brand-700 bg-brand-700 text-white" : "border-border bg-white text-ink hover:bg-brand-50"
    }`;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <nav aria-label="View" className="flex flex-wrap gap-1.5">
          {agendaViews.map((v) => (
            <Link key={v.value} href={href({ view: v.value === "week" ? undefined : v.value })} aria-current={view === v.value ? "page" : undefined} className={chip(view === v.value)}>
              {v.label}
            </Link>
          ))}
        </nav>
        <nav aria-label="Whose agenda" className="flex flex-wrap gap-1.5">
          <Link href={href({ scope: "mine" })} aria-current={scope === "mine" ? "page" : undefined} className={chip(scope === "mine")}>
            My agenda
          </Link>
          <Link href={href({ scope: undefined })} aria-current={scope === "team" ? "page" : undefined} className={chip(scope === "team")}>
            Team
          </Link>
        </nav>
      </div>

      {view !== "roles" && (
        <nav aria-label="Kinds" className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs font-medium tracking-wide text-muted uppercase">Show</span>
          {agendaGroups.map((g) => {
            const active = groups.length === 0 || groups.includes(g.value);
            const count = filterAgenda(all, { from, to, groups: [g.value], scope, userId: user.id }).length;
            return (
              <Link key={g.value} href={toggleGroup(g.value)} aria-pressed={active} className={chip(active)} scroll={false}>
                {g.label}
                <span className={`ml-1.5 text-xs tabular-nums ${active ? "text-white/80" : "text-muted"}`}>{count}</span>
              </Link>
            );
          })}
        </nav>
      )}

      {view === "roles" ? (
        <Roles rows={roleOverview(input.vacancies, input.placements, today).filter((r) => scope !== "mine" || r.ownerIds.includes(user.id))} />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-lg font-semibold text-brand-900">{rangeTitle(view, from, to, anchor)}</h2>
            <div className="flex items-center gap-1">
              <Link href={href({ date: shiftAnchor(view, anchor, -1) })} className={chip(false)} aria-label="Previous">
                <ChevronLeft className="size-4" aria-hidden="true" />
              </Link>
              <Link href={href({ date: undefined })} className={chip(false)}>
                Today
              </Link>
              <Link href={href({ date: shiftAnchor(view, anchor, 1) })} className={chip(false)} aria-label="Next">
                <ChevronRight className="size-4" aria-hidden="true" />
              </Link>
            </div>
          </div>

          {view === "month" ? (
            <Month anchor={anchor} today={today} items={items} dayHref={(d) => href({ view: "day", date: d })} />
          ) : view === "week" ? (
            <Week from={from} today={today} items={items} dayHref={(d) => href({ view: "day", date: d })} />
          ) : (
            <DayList from={from} to={to} today={today} items={items} showEmptyDays={view === "day"} />
          )}
        </>
      )}
    </div>
  );
}

function ItemLink({ item, compact = false }: { item: AgendaItem; compact?: boolean }) {
  const kind = agendaKinds[item.kind];
  const body = (
    <>
      <span className="block truncate text-xs font-semibold text-ink">
        {item.time && <span className="mr-1 tabular-nums">{item.time}</span>}
        {kind.label}
      </span>
      <span className={`block text-sm text-ink ${compact ? "truncate text-xs" : ""}`}>{item.title}</span>
      {!compact && item.subtitle && <span className="block text-xs text-muted">{item.subtitle}</span>}
    </>
  );
  const className = `block rounded-md border-l-4 px-2 py-1 ${toneStyles[item.tone]}`;
  return item.href ? (
    <Link href={item.href} className={`${className} hover:brightness-95 focus-visible:outline-2 focus-visible:outline-brand-500`} title={item.subtitle}>
      {body}
    </Link>
  ) : (
    <div className={className} title={item.subtitle}>
      {body}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border bg-card px-5 py-6 text-sm text-muted">
      <CalendarDays className="size-5 shrink-0 text-brand-200" aria-hidden="true" />
      {text}
    </div>
  );
}

function DayList({
  from,
  to,
  today,
  items,
  showEmptyDays,
}: {
  from: string;
  to: string;
  today: string;
  items: AgendaItem[];
  showEmptyDays: boolean;
}) {
  const days = groupByDay(items);
  if (items.length === 0) return <Empty text={showEmptyDays ? "Nothing on this day." : "Nothing in this period."} />;
  const list: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (days.has(d) || showEmptyDays) list.push(d);
  return (
    <div className="space-y-4">
      {list.map((day) => (
        <section key={day} aria-labelledby={`day-${day}`} className="rounded-2xl border border-border bg-card shadow-xs">
          <h3 id={`day-${day}`} className={`border-b border-border px-4 py-2.5 text-sm font-semibold ${day === today ? "text-accent-600" : "text-brand-900"}`}>
            {dayTitle(day)}
            {day === today && <span className="ml-2 text-xs font-medium">Today</span>}
          </h3>
          <ul className="space-y-2 p-3">
            {(days.get(day) ?? []).map((item) => (
              <li key={item.id}>
                <ItemLink item={item} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function Week({ from, today, items, dayHref }: { from: string; today: string; items: AgendaItem[]; dayHref: (day: string) => string }) {
  const days = groupByDay(items);
  return (
    <div className="grid grid-cols-1 gap-2 md:grid-cols-7">
      {Array.from({ length: 7 }, (_, i) => addDays(from, i)).map((day, i) => (
        <section key={day} aria-label={dayTitle(day)} className={`min-w-0 rounded-xl border bg-card ${day === today ? "border-accent-500" : "border-border"}`}>
          <Link href={dayHref(day)} className="flex items-baseline justify-between border-b border-border px-2.5 py-2 text-sm hover:bg-brand-50/40">
            <span className="font-semibold text-brand-900">{weekdayNames[i]}</span>
            <span className={`tabular-nums ${day === today ? "font-semibold text-accent-600" : "text-muted"}`}>{dayTitle(day, { day: "numeric", month: "short" })}</span>
          </Link>
          <ul className="space-y-1.5 p-2">
            {(days.get(day) ?? []).map((item) => (
              <li key={item.id}>
                <ItemLink item={item} compact />
              </li>
            ))}
            {!days.has(day) && <li className="px-1 py-2 text-xs text-muted md:text-center">Nothing</li>}
          </ul>
        </section>
      ))}
    </div>
  );
}

const MONTH_CELL_MAX = 4;

function Month({ anchor, today, items, dayHref }: { anchor: string; today: string; items: AgendaItem[]; dayHref: (day: string) => string }) {
  const days = groupByDay(items);
  const month = anchor.slice(0, 7);
  return (
    <>
      {/* Phones: the days with something on them, as a list. */}
      <div className="md:hidden">
        <DayList from={`${month}-01`} to={shiftMonthEnd(month)} today={today} items={items.filter((i) => i.date.startsWith(month))} showEmptyDays={false} />
      </div>
      <div className="hidden overflow-hidden rounded-2xl border border-border bg-card md:block">
        <div className="grid grid-cols-7 border-b border-border bg-surface text-xs font-semibold text-muted">
          {weekdayNames.map((d) => (
            <div key={d} className="px-2 py-1.5">
              {d}
            </div>
          ))}
        </div>
        {monthWeeks(anchor).map((week) => (
          <div key={week[0]} className="grid grid-cols-7 border-b border-border last:border-b-0">
            {week.map((day) => {
              const list = days.get(day) ?? [];
              const outside = !day.startsWith(month);
              return (
                <div key={day} className={`min-h-28 min-w-0 border-r border-border p-1.5 last:border-r-0 ${outside ? "bg-surface/60" : ""}`}>
                  <Link
                    href={dayHref(day)}
                    className={`mb-1 inline-flex size-6 items-center justify-center rounded-full text-xs tabular-nums hover:bg-brand-50 ${
                      day === today ? "bg-accent-500 font-semibold text-white" : outside ? "text-muted" : "text-ink"
                    }`}
                  >
                    {Number(day.slice(8))}
                  </Link>
                  <ul className="space-y-1">
                    {list.slice(0, MONTH_CELL_MAX).map((item) => (
                      <li key={item.id}>
                        <ItemLink item={item} compact />
                      </li>
                    ))}
                    {list.length > MONTH_CELL_MAX && (
                      <li>
                        <Link href={dayHref(day)} className="px-1 text-xs font-medium text-brand-700 hover:underline">
                          {list.length - MONTH_CELL_MAX} more
                        </Link>
                      </li>
                    )}
                  </ul>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </>
  );
}

/** Last day of a YYYY-MM month. */
function shiftMonthEnd(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

const statusTone: Record<string, "neutral" | "brand" | "success" | "warning" | "danger"> = {
  open: "brand",
  on_hold: "warning",
  filled: "success",
  closed: "neutral",
  active: "success",
  notice: "warning",
  ended: "neutral",
};

function Roles({ rows }: { rows: RoleRow[] }) {
  if (rows.length === 0) return <Empty text="No vacancies or placements yet." />;
  const fmt = (d: string | null) => (d ? dayTitle(d, { day: "numeric", month: "short", year: "numeric" }) : null);
  return (
    <Card>
      <div className="overflow-x-auto">
        <Table>
          <THead>
            <TR>
              <TH>Role</TH>
              <TH>Client</TH>
              <TH>Type</TH>
              <TH>Status</TH>
              <TH>Start</TH>
              <TH>End</TH>
              <TH>Duration</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((r) => (
              <TR key={`${r.type}-${r.id}`}>
                <TD>
                  <Link href={r.href} className="font-medium text-brand-800 hover:underline">
                    {r.title}
                  </Link>
                </TD>
                <TD>{r.client ?? <span className="text-muted">None</span>}</TD>
                <TD>{r.type === "vacancy" ? "Vacancy" : "Placement"}</TD>
                <TD>
                  <Badge tone={statusTone[r.status] ?? "neutral"}>{r.status.replace("_", " ")}</Badge>
                </TD>
                <TD className="whitespace-nowrap">{fmt(r.start) ?? <span className="text-muted">Not set</span>}</TD>
                <TD className="whitespace-nowrap">{fmt(r.end) ?? <span className="text-muted">Ongoing</span>}</TD>
                <TD className="whitespace-nowrap">{r.duration ?? ""}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </div>
    </Card>
  );
}
