import type { Metadata } from "next";
import { Suspense } from "react";
import Form from "next/form";
import Link from "next/link";
import { CalendarCheck, ChevronLeft, ChevronRight } from "lucide-react";
import { EmptyState } from "@/components/dashboard/empty-state";
import { PageHeader } from "@/components/dashboard/page-header";
import { AddMeetingButton, MeetingActions } from "@/components/calls/meeting-controls";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Select } from "@/components/ui/field";
import { MobileList, MobileListItem } from "@/components/ui/mobile-list";
import { ListSkeleton } from "@/components/ui/skeleton";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { requireModule } from "@/lib/auth";
import { formatCurrency, formatDateTime } from "@/lib/format";
import {
  currentMonth,
  isMonth,
  meetingMonthFilter,
  monthFees,
  monthLabel,
  nextMonth,
  previousMonth,
} from "@/lib/sales/caller-stats";
import type { MeetingStatus } from "@/lib/sales/database";
import { meetingStatuses } from "@/lib/sales/labels";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Meetings",
};

type Search = PageProps<"/dashboard/meetings">["searchParams"];

export default function Page({ searchParams }: PageProps<"/dashboard/meetings">) {
  return (
    <>
      <Suspense fallback={<PageHeader eyebrow="Sales" title="Meetings" />}>
        <Header />
      </Suspense>
      <Suspense fallback={<ListSkeleton rows={8} />}>
        <Meetings searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Header() {
  await requireModule("sales");
  const supabase = await createClient();
  const { data: callers } = await supabase.from("callers").select("id, name").neq("status", "stopped").order("name");
  return (
    <PageHeader
      eyebrow="Sales"
      title="Meetings"
      description="Every meeting from the call screen, Cal.com and by hand. Mark it held or no show; Julius approves or rejects, and an approved meeting earns the caller the fee."
      actions={<AddMeetingButton callers={callers ?? []} />}
    />
  );
}

const statusValues = meetingStatuses.map((s) => s.value);

function href(params: Record<string, string | undefined>) {
  const q = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => Boolean(e[1])));
  const s = q.toString();
  return `/dashboard/meetings${s ? `?${s}` : ""}`;
}

async function Meetings({ searchParams }: { searchParams: Search }) {
  const user = await requireModule("sales");
  const isAdmin = user.role === "admin";
  const params = await searchParams;
  const month = isMonth(params.month) ? params.month : currentMonth();
  const tab = params.tab === "month" ? "month" : "register";
  const callerFilter = typeof params.caller === "string" && /^[0-9a-f-]{36}$/i.test(params.caller) ? params.caller : undefined;
  const status =
    typeof params.status === "string" && statusValues.includes(params.status as MeetingStatus) ? (params.status as MeetingStatus) : undefined;

  const supabase = await createClient();
  let query = supabase
    .from("meetings")
    .select(
      "id, status, fee, reason, scheduled_at, created_at, source, decided_at, caller_id, company:companies!meetings_company_id_fkey(id, name), contact:contacts!meetings_contact_id_fkey(first_name, last_name, title), caller:callers!meetings_caller_id_fkey(name)",
    )
    .or(meetingMonthFilter(month))
    .order("scheduled_at", { ascending: false, nullsFirst: false })
    .limit(1000);
  if (callerFilter) query = query.eq("caller_id", callerFilter);
  if (status && tab === "register") query = query.eq("status", status);
  const [{ data, error }, { data: callers }] = await Promise.all([
    query,
    supabase.from("callers").select("id, name, fee_per_meeting, status").order("name"),
  ]);
  if (error) throw new Error(`Could not load meetings: ${error.message}`);
  const meetings = data ?? [];

  const base = { month, caller: callerFilter, status };
  const tabs = (
    <nav aria-label="Meetings views" className="-mt-2 mb-6 border-b border-border">
      <ul className="-mb-px flex gap-1 relative overflow-x-auto">
        {[
          { key: "register", label: "Register" },
          { key: "month", label: "Month overview" },
        ].map((t) => (
          <li key={t.key}>
            <Link
              href={href({ ...base, tab: t.key === "month" ? "month" : undefined })}
              aria-current={tab === t.key ? "page" : undefined}
              className={`inline-flex min-h-11 items-center border-b-2 px-3 text-sm font-medium whitespace-nowrap ${
                tab === t.key ? "border-accent-500 text-brand-900" : "border-transparent text-muted hover:text-brand-700"
              }`}
            >
              {t.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );

  const monthNav = (
    <div className="flex items-center gap-1">
      <Link
        href={href({ ...base, month: previousMonth(month), tab: tab === "month" ? "month" : undefined })}
        className="flex size-10 items-center justify-center rounded-lg text-muted hover:bg-brand-50 hover:text-brand-900"
        aria-label="Previous month"
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
      </Link>
      <span className="min-w-32 text-center text-sm font-medium text-ink">{monthLabel(month)}</span>
      <Link
        href={href({ ...base, month: nextMonth(month), tab: tab === "month" ? "month" : undefined })}
        className="flex size-10 items-center justify-center rounded-lg text-muted hover:bg-brand-50 hover:text-brand-900"
        aria-label="Next month"
      >
        <ChevronRight className="size-4" aria-hidden="true" />
      </Link>
    </div>
  );

  if (tab === "month") {
    const fees = monthFees(meetings);
    const waiting = new Map<string, number>();
    for (const m of meetings) {
      if (m.caller_id && (m.status === "held" || m.status === "planned")) waiting.set(m.caller_id, (waiting.get(m.caller_id) ?? 0) + 1);
    }
    const rows = (callers ?? [])
      .filter((c) => !callerFilter || c.id === callerFilter)
      .map((c) => ({ ...c, ...(fees.get(c.id) ?? { approved: 0, fees: 0 }), waiting: waiting.get(c.id) ?? 0 }))
      .filter((c) => c.approved > 0 || c.waiting > 0 || c.status === "active");
    const total = rows.reduce((sum, r) => sum + r.fees, 0);
    return (
      <>
        {tabs}
        <Card>
          <CardHeader
            title={`Fees for ${monthLabel(month)}`}
            description="Approved meetings per caller and what they earn. Planned and held meetings still wait for a decision."
            actions={monthNav}
          />
          <CardBody>
            {rows.length === 0 ? (
              <p className="text-sm text-muted">No callers with meetings this month.</p>
            ) : (
              <ul className="divide-y divide-border text-sm">
                {rows.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 first:pt-0">
                    <span className="min-w-0">
                      <Link href={href({ month, caller: r.id })} className="font-medium text-ink hover:underline">
                        {r.name}
                      </Link>
                      <span className="block text-xs text-muted">
                        {formatCurrency(Number(r.fee_per_meeting))} per meeting
                        {r.waiting > 0 && ` · ${r.waiting} waiting for a decision`}
                      </span>
                    </span>
                    <span className="flex gap-6 tabular-nums">
                      <span className="text-muted">{r.approved} approved</span>
                      <span className="w-24 text-right font-semibold text-ink">{formatCurrency(r.fees)}</span>
                    </span>
                  </li>
                ))}
                <li className="flex justify-between gap-3 pt-3 font-semibold text-ink">
                  <span>Total</span>
                  <span className="tabular-nums">{formatCurrency(total)}</span>
                </li>
              </ul>
            )}
          </CardBody>
        </Card>
      </>
    );
  }

  return (
    <>
      {tabs}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        {monthNav}
        <Form action="/dashboard/meetings" className="flex flex-wrap items-center gap-2 max-sm:w-full">
          <input type="hidden" name="month" value={month} />
          <label htmlFor="filter-caller" className="sr-only">
            Caller
          </label>
          <Select id="filter-caller" name="caller" defaultValue={callerFilter ?? ""} className="w-44 max-sm:w-full">
            <option value="">All callers</option>
            {(callers ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <label htmlFor="filter-status" className="sr-only">
            Status
          </label>
          <Select id="filter-status" name="status" defaultValue={status ?? ""} className="w-40 max-sm:w-full">
            <option value="">All statuses</option>
            {meetingStatuses.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
          <Button type="submit" variant="secondary" className="max-sm:w-full">
            Filter
          </Button>
        </Form>
      </div>

      {meetings.length === 0 ? (
        <EmptyState icon={CalendarCheck} title="No meetings" description={`No meetings in ${monthLabel(month)} with these filters.`} />
      ) : (
        <>
          <MobileList label="Meetings" className="md:hidden">
            {meetings.map((m) => {
              const s = meetingStatuses.find((o) => o.value === m.status);
              const contact = [m.contact?.first_name, m.contact?.last_name].filter(Boolean).join(" ");
              return (
                <MobileListItem
                  key={m.id}
                  title={m.company?.name ?? "Company"}
                  subtitle={[contact, m.caller?.name ? `by ${m.caller.name}` : null].filter(Boolean).join(" · ")}
                  meta={`${m.scheduled_at ? formatDateTime(m.scheduled_at) : "No time yet"} · ${formatCurrency(Number(m.fee))}`}
                  trailing={<Badge tone={s?.tone}>{s?.label ?? m.status}</Badge>}
                >
                  {m.reason && <p className="mb-2 text-sm whitespace-pre-line text-ink/80">{m.reason}</p>}
                  <MeetingActions meetingId={m.id} status={m.status} fee={Number(m.fee)} isAdmin={isAdmin} />
                </MobileListItem>
              );
            })}
          </MobileList>

          <Table className="hidden md:block">
            <THead>
              <tr>
                <TH>Date</TH>
                <TH>Company and contact</TH>
                <TH>Caller</TH>
                <TH>Reason</TH>
                <TH>Status</TH>
                <TH className="text-right">Fee</TH>
                <TH>Actions</TH>
              </tr>
            </THead>
            <TBody>
              {meetings.map((m) => {
                const s = meetingStatuses.find((o) => o.value === m.status);
                const contact = [m.contact?.first_name, m.contact?.last_name].filter(Boolean).join(" ");
                return (
                  <TR key={m.id}>
                    <TD className="whitespace-nowrap">
                      {m.scheduled_at ? formatDateTime(m.scheduled_at) : <span className="text-muted">No time yet</span>}
                      <span className="block text-xs text-muted">{m.source === "calcom" ? "Cal.com" : m.source === "handmatig" ? "By hand" : m.source}</span>
                    </TD>
                    <TD>
                      {m.company ? (
                        <Link href={`/dashboard/leads/${m.company.id}`} className="font-medium text-ink hover:underline">
                          {m.company.name}
                        </Link>
                      ) : (
                        "Company"
                      )}
                      {contact && (
                        <span className="block text-xs text-muted">
                          {contact}
                          {m.contact?.title ? `, ${m.contact.title}` : ""}
                        </span>
                      )}
                    </TD>
                    <TD>{m.caller?.name ?? <span className="text-muted">Team</span>}</TD>
                    <TD className="max-w-64">
                      <span className="line-clamp-2 text-sm text-ink/80">{m.reason}</span>
                    </TD>
                    <TD>
                      <Badge tone={s?.tone}>{s?.label ?? m.status}</Badge>
                    </TD>
                    <TD className="text-right tabular-nums">{formatCurrency(Number(m.fee))}</TD>
                    <TD>
                      <MeetingActions meetingId={m.id} status={m.status} fee={Number(m.fee)} isAdmin={isAdmin} />
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </>
      )}
    </>
  );
}
