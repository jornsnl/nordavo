import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { CalendarCheck, ListChecks, Phone, PhoneCall, Target } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ListSkeleton } from "@/components/ui/skeleton";
import { CallerStatsGrid, MonthFeesList, PeriodSwitch, WeekGoal } from "@/components/calls/caller-stats";
import { requireCaller } from "@/lib/auth";
import { formatCurrency, formatDate } from "@/lib/format";
import {
  currentMonth,
  emptyStats,
  loadCallbacks,
  loadCallerMonths,
  loadCallerStats,
  loadCallResults,
  loadMyMeetings,
  loadRecentCalls,
  monthLabel,
  parsePeriod,
  periodRange,
  type Period,
} from "@/lib/sales/caller-stats";
import { callOutcomes, labelOf, meetingStatuses } from "@/lib/sales/labels";
import { dialHref, dialsInBrowser } from "@/lib/sales/telephony";
import { amsterdamDate } from "@/lib/sales/status";
import { Badge } from "@/components/ui/badge";
import { DialSettingCard } from "@/components/calls/dial-setting-card";
import { formatDateTime } from "@/lib/format";
import { callerQueueSummary, openListsFor } from "@/lib/sales/queue";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = {
  title: "Overview",
};

export default function Page({ searchParams }: PageProps<"/caller">) {
  return (
    <Suspense fallback={<ListSkeleton rows={6} />}>
      <Overview searchParams={searchParams} />
    </Suspense>
  );
}

type CallsFilter = "week" | "month" | "all";

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

/** The caller's own page: their queue, their numbers and what they earned. Read with the secret key, for this caller only. */
async function Overview({ searchParams }: { searchParams: PageProps<"/caller">["searchParams"] }) {
  const params = await searchParams;
  const period = parsePeriod(first(params.period));
  const outcomeFilter = callOutcomes.find((o) => o.value === first(params.outcome))?.value;
  const rawCalls = first(params.calls);
  const callsFilter: CallsFilter = rawCalls === "week" || rawCalls === "month" ? rawCalls : "all";
  const caller = await requireCaller();
  const db = createAdminClient();
  if (!db) {
    return <p className="text-sm text-muted">Calling is not available right now. Ask Nordavo to finish the setup.</p>;
  }
  const month = currentMonth();
  const today = amsterdamDate();
  const callsRange = callsFilter === "all" ? null : periodRange(callsFilter);
  const [{ data: row }, queue, lists, weekStats, periodStats, months, results, recent, callbacks, meetings, profile] = await Promise.all([
    db.from("callers").select("fee_per_meeting, weekly_call_goal").eq("id", caller.callerId).maybeSingle(),
    callerQueueSummary(db, caller.callerId, caller.id),
    openListsFor(db, caller.callerId),
    loadCallerStats(db, { month: null, range: periodRange("week"), callerId: caller.callerId }),
    loadCallerStats(db, { month: null, range: periodRange(period), callerId: caller.callerId }),
    loadCallerMonths(db, caller.callerId, 6),
    loadCallResults(db, month),
    loadRecentCalls(db, { callerId: caller.callerId, limit: 50, outcome: outcomeFilter, range: callsRange }),
    loadCallbacks(db, caller.callerId, today),
    loadMyMeetings(db, caller.callerId, 25),
    db.from("profiles").select("dial_template").eq("id", caller.id).maybeSingle(),
  ]);
  const mine = results.get(`caller:${caller.callerId}`);
  const dialTemplate = profile.data?.dial_template ?? null;
  const goal = Number(row?.weekly_call_goal ?? 0);
  // Said "Meeting planned", but no booking within the hour: the caller is told.
  const lateBookings = meetings.filter((m) => m.late);
  const weekCalled = (weekStats.stats.get(caller.callerId) ?? emptyStats).called;
  const overdueActivities = new Set(callbacks.filter((c) => c.overdue).map((c) => c.activityId));
  const calls = [...recent].sort((a, b) => Number(overdueActivities.has(b.id)) - Number(overdueActivities.has(a.id)));
  const hrefFor = (next: { period?: Period; outcome?: string | null; calls?: CallsFilter }) => {
    const q = new URLSearchParams();
    const p = next.period ?? period;
    const o = next.outcome === undefined ? outcomeFilter : next.outcome;
    const c = next.calls ?? callsFilter;
    if (p !== "month") q.set("period", p);
    if (o) q.set("outcome", o);
    if (c !== "all") q.set("calls", c);
    const qs = q.toString();
    return qs ? `/caller?${qs}` : "/caller";
  };
  const periodTitle = period === "week" ? "This week" : period === "month" ? `This month, ${monthLabel(month)}` : "All time";

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-1.5 text-xs font-semibold tracking-wider text-accent-600 uppercase">Calling for Nordavo</p>
          <h1 className="font-display text-2xl font-bold tracking-tight text-brand-900 sm:text-3xl">Hi {caller.name.split(" ")[0]}</h1>
          <p className="mt-2 max-w-2xl text-muted">
            {queue.total === 0
              ? "There is nobody to call right now. New contacts appear here as soon as Nordavo opens a list for you."
              : `${queue.total} ${queue.total === 1 ? "contact is" : "contacts are"} waiting in your call list.`}
          </p>
        </div>
        <ButtonLink href="/caller/call" variant={queue.total ? "primary" : "secondary"} className="max-sm:w-full">
          <Phone aria-hidden="true" />
          Start calling
        </ButtonLink>
      </header>

      {lateBookings.length > 0 && (
        <div role="alert" className="rounded-2xl border border-amber-300 bg-amber-50 px-5 py-4 text-sm text-amber-900">
          <p className="font-semibold">
            {lateBookings.length === 1 ? "A meeting is still waiting for its booking" : `${lateBookings.length} meetings are still waiting for their booking`}
          </p>
          <ul className="mt-1 list-disc pl-5">
            {lateBookings.map((m) => (
              <li key={m.id}>
                {m.companyName ?? "Lead"}
                {m.contactName ? `, ${m.contactName}` : ""}: planned {formatDate(m.createdAt)} and no Cal.com booking yet. It does not count until the booking is made. Call the lead again to book a time, or ask Nordavo.
              </li>
            ))}
          </ul>
        </div>
      )}

      <Card>
        <CardHeader
          title={
            <span className="inline-flex items-center gap-2">
              <Target className="size-4" aria-hidden="true" />
              Weekly goal
            </span>
          }
          description="Call attempts this week (Monday to Sunday) against the goal Nordavo set for you."
        />
        <CardBody>
          <WeekGoal called={weekCalled} goal={goal} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={
            <span className="inline-flex items-center gap-2">
              <PhoneCall className="size-4" aria-hidden="true" />
              Call back today
            </span>
          }
          description="Contacts you promised to call back. Overdue ones are first."
        />
        {callbacks.length === 0 ? (
          <p className="px-5 py-4 text-sm text-muted">Nobody to call back today.</p>
        ) : (
          <ul className="divide-y divide-border">
            {callbacks.map((c) => {
              const href = c.phone ? dialHref(c.phone, dialTemplate) : null;
              return (
                <li key={c.activityId} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm sm:px-5">
                  <span className={`w-28 shrink-0 text-xs ${c.overdue ? "font-medium text-danger" : "text-muted"}`}>
                    {c.overdue ? `Overdue, ${formatDate(c.due)}` : "Today"}
                  </span>
                  <Link href={`/caller/contact/${c.contactId}`} className="min-w-0 flex-1 hover:underline">
                    <span className="font-medium text-ink">{c.companyName ?? "Lead"}</span>
                    {c.contactName && <span className="text-muted"> · {c.contactName}</span>}
                  </Link>
                  {href && (
                    <a
                      href={href}
                      {...(dialsInBrowser(href) ? { target: "_blank", rel: "noreferrer" } : {})}
                      className="inline-flex items-center gap-2 rounded-xl bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-800 pointer-coarse:min-h-11"
                    >
                      <Phone className="size-4" aria-hidden="true" />
                      Call
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader
          title={periodTitle}
          description="Calls you logged and the meetings that came from them."
          actions={<PeriodSwitch active={period} hrefFor={(p) => hrefFor({ period: p })} />}
        />
        <CardBody>
          <CallerStatsGrid stats={periodStats.stats.get(caller.callerId) ?? emptyStats} />
        </CardBody>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title={
              <span className="inline-flex items-center gap-2">
                <ListChecks className="size-4" aria-hidden="true" />
                Your call list
              </span>
            }
            description="You call in this order. Nordavo decides which lists are open for you."
          />
          <CardBody>
            <ul className="divide-y divide-border text-sm">
              {queue.assigned > 0 && (
                <li className="flex justify-between gap-3 py-2 first:pt-0">
                  <span className="font-medium text-ink">Assigned to you</span>
                  <span className="text-muted">{queue.assigned} to call</span>
                </li>
              )}
              {queue.sequence > 0 && (
                <li className="flex justify-between gap-3 py-2 first:pt-0">
                  <span className="font-medium text-ink">Follow up calls due</span>
                  <span className="text-muted">{queue.sequence} to call</span>
                </li>
              )}
              {lists.map((l) => (
                <li key={l.id} className="flex flex-wrap justify-between gap-3 py-2 first:pt-0 last:pb-0">
                  <span className="min-w-0">
                    <span className="font-medium text-ink">{l.name}</span>
                    <span className="block text-xs text-muted">
                      {l.openUntil ? `Open until ${formatDate(l.openUntil)}` : "Open"}
                    </span>
                  </span>
                  <span className="text-muted">{queue.perList.get(l.id) ?? 0} to call</span>
                </li>
              ))}
              {lists.length === 0 && queue.assigned === 0 && queue.sequence === 0 && (
                <li className="py-2 text-muted first:pt-0">No lists are open for you right now.</li>
              )}
            </ul>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title={
              <span className="inline-flex items-center gap-2">
                <CalendarCheck className="size-4" aria-hidden="true" />
                Approved meetings and fees
              </span>
            }
            description={`You earn ${formatCurrency(Number(row?.fee_per_meeting ?? 0))} per approved meeting, unless agreed otherwise for a meeting.`}
          />
          <CardBody>
            <MonthFeesList months={months} />
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="My meetings"
          description="Every meeting you planned, with its status: awaiting booking, planned, held, no show, moved, approved or rejected. A meeting counts once it is booked in Cal.com; only approved meetings earn a fee."
        />
        {meetings.length === 0 ? (
          <p className="px-5 py-4 text-sm text-muted">No meetings yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {meetings.map((m) => {
              const status = meetingStatuses.find((o) => o.value === m.status);
              return (
                <li key={m.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm sm:px-5">
                  <span className="w-32 shrink-0 text-xs text-muted">
                    {m.scheduledAt ? formatDateTime(m.scheduledAt) : m.status === "awaiting_booking" ? `Waiting since ${formatDate(m.createdAt)}` : `Planned ${formatDate(m.createdAt)}`}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="font-medium text-ink">{m.companyName ?? "Lead"}</span>
                    {m.contactName && <span className="text-muted"> · {m.contactName}</span>}
                    {m.reason && <span className="block truncate text-xs text-muted">{m.reason}</span>}
                  </span>
                  <span className="text-xs text-muted tabular-nums">{formatCurrency(m.fee)}</span>
                  <Badge tone={status?.tone}>{status?.label ?? m.status}</Badge>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Your calls"
          description={`Tap a call to open the contact, add a note or correct the outcome. This month: ${
            callOutcomes.map((o) => `${mine?.outcomes[o.value] ?? 0} ${o.label.toLowerCase()}`).join(", ")
          }.`}
        />
        <nav aria-label="Filter your calls" className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-border px-4 py-3 text-sm sm:px-5">
          <ul className="flex flex-wrap gap-1.5">
            {[{ value: null, label: "All outcomes" }, ...callOutcomes].map((o) => (
              <li key={o.value ?? "all"}>
                <Link
                  href={hrefFor({ outcome: o.value })}
                  scroll={false}
                  aria-current={(o.value ?? undefined) === outcomeFilter ? "true" : undefined}
                  className={`inline-block rounded-full px-3 py-1 text-xs font-medium pointer-coarse:min-h-11 pointer-coarse:py-3 ${
                    (o.value ?? undefined) === outcomeFilter ? "bg-brand-700 text-white" : "bg-surface text-muted hover:text-brand-900"
                  }`}
                >
                  {o.label}
                </Link>
              </li>
            ))}
          </ul>
          <ul className="flex gap-1.5">
            {([["all", "All time"], ["month", "This month"], ["week", "This week"]] as const).map(([value, label]) => (
              <li key={value}>
                <Link
                  href={hrefFor({ calls: value })}
                  scroll={false}
                  aria-current={callsFilter === value ? "true" : undefined}
                  className={`inline-block rounded-full px-3 py-1 text-xs font-medium pointer-coarse:min-h-11 pointer-coarse:py-3 ${
                    callsFilter === value ? "bg-brand-700 text-white" : "bg-surface text-muted hover:text-brand-900"
                  }`}
                >
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <ul className="divide-y divide-border">
          {calls.length === 0 && <li className="px-5 py-4 text-sm text-muted">No calls found.</li>}
          {calls.map((c) => {
            const overdue = overdueActivities.has(c.id);
            const label = c.outcome ? labelOf(callOutcomes, c.outcome as never) : "Call";
            const body = (
              <>
                <span className="w-32 shrink-0 text-xs text-muted">{formatDateTime(c.date)}</span>
                <span className="min-w-0 flex-1">
                  <span className="font-medium text-ink">{c.companyName ?? "Lead"}</span>
                  {c.contactName && <span className="text-muted"> · {c.contactName}</span>}
                  {c.notes && <span className="block truncate text-xs text-muted">{c.notes}</span>}
                </span>
                {c.callbackOn && (
                  <span className={`text-xs ${overdue ? "font-medium text-danger" : "text-muted"}`}>
                    Call back · {formatDate(c.callbackOn)}
                    {overdue && " (overdue)"}
                  </span>
                )}
                <Badge tone={overdue ? "danger" : (callOutcomes.find((o) => o.value === c.outcome)?.tone ?? "neutral")}>{label}</Badge>
              </>
            );
            return (
              <li key={c.id}>
                {c.contactId ? (
                  <Link
                    href={`/caller/contact/${c.contactId}`}
                    className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm hover:bg-brand-50 sm:px-5 pointer-coarse:min-h-11"
                  >
                    {body}
                  </Link>
                ) : (
                  <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm sm:px-5">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      </Card>

      <DialSettingCard />
    </div>
  );
}
