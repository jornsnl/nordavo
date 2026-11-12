import type { Metadata } from "next";
import { Suspense } from "react";
import { CalendarCheck, ListChecks, Phone } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ListSkeleton } from "@/components/ui/skeleton";
import { CallerStatsGrid, MonthFeesList } from "@/components/calls/caller-stats";
import { requireCaller } from "@/lib/auth";
import { formatCurrency, formatDate } from "@/lib/format";
import { currentMonth, emptyStats, loadCallerMonths, loadCallerStats, loadCallResults, loadRecentCalls, monthLabel } from "@/lib/sales/caller-stats";
import { callOutcomes, labelOf } from "@/lib/sales/labels";
import { Badge } from "@/components/ui/badge";
import { DialSettingCard } from "@/components/calls/dial-setting-card";
import { formatDateTime } from "@/lib/format";
import { callerQueueSummary, openListsFor } from "@/lib/sales/queue";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = {
  title: "Overview",
};

export default function Page() {
  return (
    <Suspense fallback={<ListSkeleton rows={6} />}>
      <Overview />
    </Suspense>
  );
}

/** The caller's own page: their queue, their numbers and what they earned. Read with the secret key, for this caller only. */
async function Overview() {
  const caller = await requireCaller();
  const db = createAdminClient();
  if (!db) {
    return <p className="text-sm text-muted">Calling is not available right now. Ask Nordavo to finish the setup.</p>;
  }
  const month = currentMonth();
  const [{ data: row }, queue, lists, monthStats, allStats, months, results, recent] = await Promise.all([
    db.from("callers").select("fee_per_meeting").eq("id", caller.callerId).maybeSingle(),
    callerQueueSummary(db, caller.callerId, caller.id),
    openListsFor(db, caller.callerId),
    loadCallerStats(db, { month, callerId: caller.callerId }),
    loadCallerStats(db, { month: null, callerId: caller.callerId }),
    loadCallerMonths(db, caller.callerId, 6),
    loadCallResults(db, month),
    loadRecentCalls(db, { callerId: caller.callerId, limit: 30 }),
  ]);
  const mine = results.get(`caller:${caller.callerId}`);

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

      <Card>
        <CardHeader title={`This month, ${monthLabel(month)}`} description="Calls you logged and the meetings that came from them." />
        <CardBody>
          <CallerStatsGrid stats={monthStats.stats.get(caller.callerId) ?? emptyStats} />
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
        <CardHeader title="All time" />
        <CardBody>
          <CallerStatsGrid stats={allStats.stats.get(caller.callerId) ?? emptyStats} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Your calls"
          description={`Every attempt you logged, with its outcome. It is saved at the lead right away. This month: ${
            callOutcomes.map((o) => `${mine?.outcomes[o.value] ?? 0} ${o.label.toLowerCase()}`).join(", ")
          }.`}
        />
        <ul className="divide-y divide-border">
          {recent.length === 0 && <li className="px-5 py-4 text-sm text-muted">No calls yet.</li>}
          {recent.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm sm:px-5">
              <span className="w-32 shrink-0 text-xs text-muted">{formatDateTime(c.date)}</span>
              <span className="min-w-0 flex-1">
                <span className="font-medium text-ink">{c.companyName ?? "Lead"}</span>
                {c.contactName && <span className="text-muted"> · {c.contactName}</span>}
                {c.notes && <span className="block truncate text-xs text-muted">{c.notes}</span>}
              </span>
              <Badge tone={callOutcomes.find((o) => o.value === c.outcome)?.tone ?? "neutral"}>
                {c.outcome ? labelOf(callOutcomes, c.outcome as never) : "Call"}
              </Badge>
            </li>
          ))}
        </ul>
      </Card>

      <DialSettingCard />
    </div>
  );
}
