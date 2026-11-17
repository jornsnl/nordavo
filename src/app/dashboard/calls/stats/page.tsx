import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronLeft, ChevronRight, PhoneCall, PlayCircle } from "lucide-react";
import { EmptyState } from "@/components/dashboard/empty-state";
import { PageHeader } from "@/components/dashboard/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { ListSkeleton } from "@/components/ui/skeleton";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { requireModule } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import {
  currentMonth,
  isMonth,
  loadCallResults,
  loadRecentCalls,
  loadRejections,
  monthLabel,
  nextMonth,
  OWN_WORDS,
  parseDay,
  parseWho,
  previousMonth,
  rate,
  rejectionWho,
  summarizeRejections,
} from "@/lib/sales/caller-stats";
import { loadChoiceLists } from "@/lib/sales/flow-data";
import { choiceLabel } from "@/lib/sales/choices";
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
  // One person who called: "caller:<id>" or "team:<id>" ("caller=<id>" is the old link).
  const legacy = typeof params.caller === "string" ? `caller:${params.caller}` : undefined;
  const who = parseWho(params.who ?? legacy);
  const whoValue = who ? `${who.kind}:${who.id}` : "";
  const outcome = typeof params.outcome === "string" && callOutcomes.some((o) => o.value === params.outcome) ? params.outcome : undefined;
  const from = parseDay(params.from);
  const to = parseDay(params.to);
  const reason = typeof params.reason === "string" && /^[a-z0-9_]{1,40}$/.test(params.reason) ? params.reason : undefined;
  const db = await createClient();
  const [results, callers, profiles, recent, rejections, lists] = await Promise.all([
    loadCallResults(db, month),
    db.from("callers").select("id, name, party, status"),
    db.from("profiles").select("id, full_name, email").in("role", ["admin", "member"]),
    loadRecentCalls(db, { who, outcome, from, to, limit: 100 }),
    loadRejections(db, { month, who }),
    loadChoiceLists(db),
  ]);
  const callerName = new Map((callers.data ?? []).map((c) => [c.id, c.party ? `${c.name} (${c.party})` : c.name]));
  const teamName = new Map((profiles.data ?? []).map((p) => [p.id, p.full_name || p.email || "Team member"]));
  const whoName = (key: string | null) => {
    if (!key) return "";
    const [kind, id] = key.split(":");
    return (kind === "caller" ? callerName.get(id) : teamName.get(id)) ?? (kind === "caller" ? "Caller" : "Team");
  };
  const reasonLabel = (r: string) => (r === OWN_WORDS ? "Own words only" : choiceLabel(lists.reject_reason, r));
  const summary = summarizeRejections(
    rejections,
    lists.reject_reason.map((o) => o.value),
  );
  const people = [...new Set(summary.flatMap((c) => [...c.byWho.keys()]))].sort((a, b) => whoName(a).localeCompare(whoName(b)));
  const detail = rejections
    .filter((r) => (reason ? (reason === OWN_WORDS ? r.reasons.length === 0 : r.reasons.includes(reason)) : Boolean(r.reason_text?.trim())))
    .slice(0, 100);
  const detailCompanies = detail.length
    ? await db.from("companies").select("id, name").in("id", [...new Set(detail.map((r) => r.company_id))])
    : { data: [] as { id: string; name: string }[] };
  const companyName = new Map((detailCompanies.data ?? []).map((c) => [c.id, c.name]));
  const rows = [...results.values()]
    .map((r) => ({ ...r, name: r.kind === "caller" ? (callerName.get(r.id) ?? "Caller") : (teamName.get(r.id) ?? "Team member") }))
    .sort((a, b) => b.called - a.called || a.name.localeCompare(b.name));

  const href = (m: string | null) => `/dashboard/calls/stats?month=${m ?? "all"}${whoValue ? `&who=${whoValue}` : ""}`;
  const whoOptions = [
    ...(callers.data ?? []).map((c) => ({ value: `caller:${c.id}`, label: callerName.get(c.id) ?? c.name })),
    ...(profiles.data ?? []).map((p) => ({ value: `team:${p.id}`, label: `${teamName.get(p.id)} (team)` })),
  ];

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
                      <Link href={`/dashboard/calls/stats?month=${month ?? "all"}&who=caller:${r.id}`} className="font-medium text-brand-800 hover:underline">
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
          title="Rejections per reason"
          description={`Every Not interested with its reasons${month ? ` in ${monthLabel(month)}` : ""}${who ? `, of ${whoName(whoValue)}` : ""}. A rejection with several reasons counts under each. Click a reason to see the companies.`}
          actions={
            <Link href="/dashboard/settings/sales-lists" className="text-sm font-semibold text-brand-600 hover:text-brand-800">
              Manage reasons
            </Link>
          }
        />
        {summary.length === 0 ? (
          <CardBody>
            <p className="text-sm text-muted">No rejections in this period.</p>
          </CardBody>
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Reason</TH>
                <TH className="text-right">Rejections</TH>
                <TH className="text-right">Share</TH>
                {people.map((k) => (
                  <TH key={k} className="text-right">
                    {whoName(k)}
                  </TH>
                ))}
              </tr>
            </THead>
            <TBody>
              {summary.map((c) => (
                <TR key={c.reason}>
                  <TD>
                    <Link
                      href={`${href(month)}${from ? `&from=${from}` : ""}${to ? `&to=${to}` : ""}&reason=${c.reason}`}
                      className={`font-medium hover:underline ${reason === c.reason ? "text-brand-900" : "text-brand-800"}`}
                    >
                      {reasonLabel(c.reason)}
                    </Link>
                  </TD>
                  <TD className="text-right tabular-nums">{c.total}</TD>
                  <TD className="text-right tabular-nums">{rate(c.total, rejections.length) ?? 0}%</TD>
                  {people.map((k) => (
                    <TD key={k} className="text-right tabular-nums">
                      {c.byWho.get(k) ?? 0}
                    </TD>
                  ))}
                </TR>
              ))}
            </TBody>
          </Table>
        )}
        <CardBody className="space-y-2 border-t border-border">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-ink">
              {reason ? `Companies: ${reasonLabel(reason)}` : "In their own words"}
              <span className="font-normal text-muted"> ({detail.length}{detail.length === 100 ? "+" : ""})</span>
            </p>
            {reason && (
              <Link href={href(month)} className="text-sm font-semibold text-brand-600 hover:text-brand-800">
                Show the own words of the callers
              </Link>
            )}
          </div>
          {!reason && <p className="text-xs text-muted">What callers typed in the open box. A common answer can become a fixed reason under Settings, Sales lists.</p>}
          <ul className="divide-y divide-border">
            {detail.length === 0 && <li className="py-2 text-sm text-muted">Nothing to show.</li>}
            {detail.map((r) => (
              <li key={r.id} className="space-y-1 py-2 text-sm">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="w-28 shrink-0 text-xs text-muted">{formatDateTime(r.created_at)}</span>
                  <Link href={`/dashboard/leads/${r.company_id}`} className="font-medium text-brand-800 hover:underline">
                    {companyName.get(r.company_id) ?? "Lead"}
                  </Link>
                  <span className="text-xs text-muted">{whoName(rejectionWho(r))}</span>
                  {r.parked_until && <Badge tone="warning">Parked until {r.parked_until}</Badge>}
                  {r.reasons.map((x) => (
                    <Badge key={x}>{reasonLabel(x)}</Badge>
                  ))}
                </div>
                {r.reason_text?.trim() && <p className="whitespace-pre-line text-ink/80">{r.reason_text}</p>}
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={who ? `Latest calls of ${whoName(whoValue)}` : "Latest calls"}
          description="Every attempt with its outcome, at the lead it belongs to. Filter on outcome, who called and period."
        />
        <form method="get" className="flex flex-wrap items-end gap-3 border-b border-border px-4 pb-4 sm:px-5">
          <input type="hidden" name="month" value={month ?? "all"} />
          <label className="space-y-1 text-xs text-muted">
            Outcome
            <Select name="outcome" defaultValue={outcome ?? ""} className="min-w-44">
              <option value="">All outcomes</option>
              {callOutcomes.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </label>
          <label className="space-y-1 text-xs text-muted">
            Who called
            <Select name="who" defaultValue={whoValue} className="min-w-44">
              <option value="">Everyone</option>
              {whoOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </label>
          <label className="space-y-1 text-xs text-muted">
            From
            <Input type="date" name="from" defaultValue={from ?? ""} />
          </label>
          <label className="space-y-1 text-xs text-muted">
            Until
            <Input type="date" name="to" defaultValue={to ?? ""} />
          </label>
          <button type="submit" className="min-h-10 rounded-xl bg-brand-700 px-4 text-sm font-semibold text-white hover:bg-brand-800">
            Filter
          </button>
          {(outcome || who || from || to) && (
            <Link href={`/dashboard/calls/stats?month=${month ?? "all"}`} className="min-h-10 py-2 text-sm font-semibold text-brand-600 hover:text-brand-800">
              Clear filters
            </Link>
          )}
        </form>
        <ul className="divide-y divide-border">
          {recent.length === 0 && <li className="px-5 py-4 text-sm text-muted">No calls match.</li>}
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
