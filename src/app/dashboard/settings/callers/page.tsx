import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, PhoneCall } from "lucide-react";
import { EmptyState } from "@/components/dashboard/empty-state";
import { PageHeader } from "@/components/dashboard/page-header";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { AddCallerForm, CallerControls } from "@/components/settings/callers/caller-forms";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { MobileList, MobileListItem } from "@/components/ui/mobile-list";
import { ListSkeleton } from "@/components/ui/skeleton";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { requireAdmin } from "@/lib/auth";
import { formatCurrency, formatDate } from "@/lib/format";
import {
  currentMonth,
  emptyStats,
  isMonth,
  loadCallerStats,
  monthLabel,
  nextMonth,
  previousMonth,
} from "@/lib/sales/caller-stats";
import { callerStatuses, labelOf } from "@/lib/sales/labels";
import { hasAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { addCaller, resendCallerInvite, setCallerStatus, updateCaller } from "../caller-actions";

export const metadata: Metadata = {
  title: "Callers",
};

export default function Page({ searchParams }: PageProps<"/dashboard/settings/callers">) {
  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title="Settings"
        description="Your own account and, as an admin, who has access to the portal."
      />
      <SettingsTabs active="callers" isAdmin />
      <Suspense fallback={<ListSkeleton rows={6} />}>
        <Callers searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Callers({ searchParams }: { searchParams: PageProps<"/dashboard/settings/callers">["searchParams"] }) {
  await requireAdmin();
  const params = await searchParams;
  const month = isMonth(params.month) ? params.month : currentMonth();
  const supabase = await createClient();
  const [{ data: callers, error }, monthStats, allStats] = await Promise.all([
    supabase
      .from("callers")
      .select("id, name, email, phone, party, fee_per_meeting, status, invited_at, created_at")
      .order("status")
      .order("name"),
    loadCallerStats(supabase, { month }),
    loadCallerStats(supabase, { month: null }),
  ]);
  if (error) throw new Error(`Could not load callers: ${error.message}`);
  const list = callers ?? [];
  const canInvite = hasAdminClient();

  const monthNav = (
    <div className="flex items-center gap-1">
      <Link
        href={`/dashboard/settings/callers?month=${previousMonth(month)}`}
        className="flex size-10 items-center justify-center rounded-lg text-muted hover:bg-brand-50 hover:text-brand-900"
        aria-label="Previous month"
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
      </Link>
      <span className="min-w-32 text-center text-sm font-medium text-ink">{monthLabel(month)}</span>
      <Link
        href={`/dashboard/settings/callers?month=${nextMonth(month)}`}
        className="flex size-10 items-center justify-center rounded-lg text-muted hover:bg-brand-50 hover:text-brand-900"
        aria-label="Next month"
      >
        <ChevronRight className="size-4" aria-hidden="true" />
      </Link>
    </div>
  );

  return (
    <div className="space-y-6">
      <section aria-labelledby="callers-heading" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="callers-heading" className="font-display text-lg font-semibold text-brand-900">
              External callers
            </h2>
            <p className="mt-0.5 max-w-2xl text-sm text-muted">
              Callers only see their own call list, the call screen and their own overview, with a required authenticator app.
              Open lists for them on Call lists. Numbers per month: called, reached, meetings and approved, with the fees earned.
            </p>
          </div>
          {monthNav}
        </div>

        {list.length === 0 ? (
          <EmptyState icon={PhoneCall} title="No callers yet" description="Add a caller below. They get an invitation by mail." />
        ) : (
          <>
            <MobileList label="Callers" className="md:hidden">
              {list.map((c) => {
                const s = monthStats.stats.get(c.id) ?? emptyStats;
                const f = monthStats.fees.get(c.id) ?? { approved: 0, fees: 0 };
                const status = callerStatuses.find((o) => o.value === c.status);
                return (
                  <MobileListItem
                    key={c.id}
                    leading={<Avatar name={c.name} />}
                    title={c.name}
                    subtitle={[c.party, c.email].filter(Boolean).join(" · ")}
                    meta={`${s.called} called · ${s.reached} reached · ${s.meetings} meetings · ${s.approved} approved · ${formatCurrency(f.fees)}`}
                    trailing={<Badge tone={status?.tone}>{status?.label ?? c.status}</Badge>}
                  >
                    <CallerControls
                      caller={{ id: c.id, name: c.name, email: c.email, phone: c.phone, party: c.party, fee: Number(c.fee_per_meeting), status: c.status }}
                      updateAction={updateCaller}
                      statusAction={setCallerStatus}
                      resendAction={resendCallerInvite}
                    />
                  </MobileListItem>
                );
              })}
            </MobileList>

            <Table className="hidden md:block">
              <THead>
                <tr>
                  <TH>Caller</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Fee</TH>
                  <TH className="text-right">Called</TH>
                  <TH className="text-right">Reached</TH>
                  <TH className="text-right">Meetings</TH>
                  <TH className="text-right">Approved</TH>
                  <TH className="text-right">Fees earned</TH>
                  <TH>Manage</TH>
                </tr>
              </THead>
              <TBody>
                {list.map((c) => {
                  const s = monthStats.stats.get(c.id) ?? emptyStats;
                  const all = allStats.stats.get(c.id) ?? emptyStats;
                  const f = monthStats.fees.get(c.id) ?? { approved: 0, fees: 0 };
                  const status = callerStatuses.find((o) => o.value === c.status);
                  return (
                    <TR key={c.id}>
                      <TD>
                        <div className="flex items-center gap-3">
                          <Avatar name={c.name} size="sm" />
                          <div className="min-w-0">
                            <p className="truncate font-medium text-ink">{c.name}</p>
                            <p className="truncate text-xs text-muted">
                              {[c.party, c.email, c.phone].filter(Boolean).join(" · ")}
                            </p>
                            <p className="text-xs text-muted">
                              {c.invited_at ? `Invited ${formatDate(c.invited_at)}` : "Not invited"} · all time {all.called} called,{" "}
                              {all.approved} approved
                            </p>
                          </div>
                        </div>
                      </TD>
                      <TD>
                        <Badge tone={status?.tone}>{status?.label ?? labelOf(callerStatuses, c.status)}</Badge>
                      </TD>
                      <TD className="text-right tabular-nums">{formatCurrency(Number(c.fee_per_meeting))}</TD>
                      <TD className="text-right tabular-nums">{s.called}</TD>
                      <TD className="text-right tabular-nums">{s.reached}</TD>
                      <TD className="text-right tabular-nums">{s.meetings}</TD>
                      <TD className="text-right tabular-nums">{s.approved}</TD>
                      <TD className="text-right font-medium tabular-nums">{formatCurrency(f.fees)}</TD>
                      <TD>
                        <CallerControls
                          caller={{ id: c.id, name: c.name, email: c.email, phone: c.phone, party: c.party, fee: Number(c.fee_per_meeting), status: c.status }}
                          updateAction={updateCaller}
                          statusAction={setCallerStatus}
                          resendAction={resendCallerInvite}
                        />
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </>
        )}
      </section>

      <Card>
        <CardHeader
          title="Add caller"
          description="The caller gets an invitation to set a password, then sets up an authenticator app. Without the app the call screen stays closed."
        />
        <CardBody className="py-5">
          <AddCallerForm action={addCaller} enabled={canInvite} />
        </CardBody>
      </Card>
    </div>
  );
}
