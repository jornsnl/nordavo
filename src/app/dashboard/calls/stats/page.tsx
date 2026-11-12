import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronLeft, ChevronRight, PhoneCall, PlayCircle } from "lucide-react";
import { EmptyState } from "@/components/dashboard/empty-state";
import { PageHeader } from "@/components/dashboard/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { ListSkeleton } from "@/components/ui/skeleton";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { requireModule } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import {
  currentMonth,
  isMonth,
  loadCallResults,
  loadRecentCalls,
  monthLabel,
  nextMonth,
  previousMonth,
  rate,
} from "@/lib/sales/caller-stats";
import { callOutcomes, labelOf } from "@/lib/sales/labels";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Call results",
};

export default function Page({ searchParams }: PageProps<"/dashboard/calls/stats">) {
  return (
    <>
      <Link
        href="/dashboard/calls"
        className="mb-4 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-muted hover:text-brand-700"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Calls
      </Link>
      <PageHeader
        eyebrow="Sales"
        title="Call results"
        description="Per external caller and team member: how much was called and what came of it, per month. Every attempt is also on the lead itself."
      />
      <Suspense fallback={<ListSkeleton rows={6} />}>
        <Results searchParams={searchParams} />
      </Suspense>
    </>
  );
}

const columns = ["no_answer", "call_back", "reached_interested", "meeting_planned", "reached_not_interested", "referred", "wrong_person", "wrong_number"] as const;

async function Results({ searchParams }: { searchParams: PageProps<"/dashboard/calls/stats">["searchParams"] }) {
  await requireModule("sales");
  const params = await searchParams;
  const all = params.month === "all";
  const month = all ? null : isMonth(params.month) ? params.month : currentMonth();
  const caller = typeof params.caller === "string" && /^[0-9a-f-]{36}$/i.test(params.caller) ? params.caller : undefined;
  const db = await createClient();
  const [results, callers, profiles, recent] = await Promise.all([
    loadCallResults(db, month),
    db.from("callers").select("id, name, party, status"),
    db.from("profiles").select("id, full_name, email").in("role", ["admin", "member"]),
    loadRecentCalls(db, { callerId: caller, limit: 60 }),
  ]);
  const callerName = new Map((callers.data ?? []).map((c) => [c.id, c.party ? `${c.name} (${c.party})` : c.name]));
  const teamName = new Map((profiles.data ?? []).map((p) => [p.id, p.full_name || p.email || "Team member"]));
  const rows = [...results.values()]
    .map((r) => ({ ...r, name: r.kind === "caller" ? (callerName.get(r.id) ?? "Caller") : (teamName.get(r.id) ?? "Team member") }))
    .sort((a, b) => b.called - a.called || a.name.localeCompare(b.name));

  const href = (m: string | null) => `/dashboard/calls/stats?month=${m ?? "all"}${caller ? `&caller=${caller}` : ""}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        {month && (
          <>
            <Link href={href(previousMonth(month))} aria-label="Previous month" className="flex size-10 items-center justify-center rounded-lg text-muted hover:bg-brand-50">
              <ChevronLeft className="size-4" aria-hidden="true" />
            </Link>
            <span className="min-w-32 text-center text-sm font-medium text-ink">{monthLabel(month)}</span>
            <Link href={href(nextMonth(month))} aria-label="Next month" className="flex size-10 items-center justify-center rounded-lg text-muted hover:bg-brand-50">
              <ChevronRight className="size-4" aria-hidden="true" />
            </Link>
          </>
        )}
        <Link href={all ? href(currentMonth()) : href(null)} className="text-sm font-semibold text-brand-600 hover:text-brand-800">
          {all ? "Per month" : "All time"}
        </Link>
      </div>

      {rows.length === 0 ? (
        <EmptyState icon={PhoneCall} title="No calls in this period" description="Calls logged on the call screen show up here per person." />
      ) : (
        <Table>
          <THead>
            <tr>
              <TH>Who</TH>
              <TH className="text-right">Called</TH>
              <TH className="text-right">Reached</TH>
              {columns.map((c) => (
                <TH key={c} className="text-right">
                  {labelOf(callOutcomes, c)}
                </TH>
              ))}
              <TH className="text-right">Meetings</TH>
              <TH className="text-right">Approved</TH>
            </tr>
          </THead>
          <TBody>
            {rows.map((r) => (
              <TR key={r.key}>
                <TD>
                  <span className="flex flex-wrap items-center gap-2">
                    {r.kind === "caller" ? (
                      <Link href={`/dashboard/calls/stats?month=${month ?? "all"}&caller=${r.id}`} className="font-medium text-brand-800 hover:underline">
                        {r.name}
                      </Link>
                    ) : (
                      <span className="font-medium text-ink">{r.name}</span>
                    )}
                    <Badge tone={r.kind === "caller" ? "accent" : "neutral"}>{r.kind === "caller" ? "External" : "Team"}</Badge>
                  </span>
                </TD>
                <TD className="text-right tabular-nums">{r.called}</TD>
                <TD className="text-right tabular-nums">
                  {r.reached}
                  {rate(r.reached, r.called) != null && <span className="text-xs text-muted"> ({rate(r.reached, r.called)}%)</span>}
                </TD>
                {columns.map((c) => (
                  <TD key={c} className="text-right tabular-nums">
                    {r.outcomes[c] ?? 0}
                  </TD>
                ))}
                <TD className="text-right tabular-nums">{r.meetings}</TD>
                <TD className="text-right tabular-nums">{r.approved}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      <Card>
        <CardHeader
          title={caller ? `Latest calls of ${callerName.get(caller) ?? "this caller"}` : "Latest calls"}
          description="Every attempt with its outcome, at the lead it belongs to."
          actions={
            caller ? (
              <Link href={href(month)} className="text-sm font-semibold text-brand-600 hover:text-brand-800">
                Everyone
              </Link>
            ) : undefined
          }
        />
        <ul className="divide-y divide-border">
          {recent.length === 0 && <li className="px-5 py-4 text-sm text-muted">No calls yet.</li>}
          {recent.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm sm:px-5">
              <span className="w-32 shrink-0 text-xs text-muted">{formatDateTime(c.date)}</span>
              <span className="min-w-0 flex-1">
                {c.companyId ? (
                  <Link href={`/dashboard/leads/${c.companyId}`} className="font-medium text-brand-800 hover:underline">
                    {c.companyName ?? "Lead"}
                  </Link>
                ) : (
                  <span className="font-medium">Lead</span>
                )}
                {c.contactName && <span className="text-muted"> · {c.contactName}</span>}
                {c.notes && <span className="block truncate text-xs text-muted">{c.notes}</span>}
              </span>
              <span className="text-xs text-muted">
                {c.callerId ? (callerName.get(c.callerId) ?? "Caller") : c.createdBy ? (teamName.get(c.createdBy) ?? "Team") : ""}
              </span>
              {c.recordingUrl && (
                <a href={c.recordingUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline">
                  <PlayCircle className="size-3.5" aria-hidden="true" />
                  Recording
                </a>
              )}
              <Badge tone={callOutcomes.find((o) => o.value === c.outcome)?.tone ?? "neutral"}>
                {c.outcome ? labelOf(callOutcomes, c.outcome as never) : "Call"}
              </Badge>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
