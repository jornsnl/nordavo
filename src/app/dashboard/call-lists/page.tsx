import type { Metadata } from "next";
import { Suspense } from "react";
import { ListChecks, Phone, Table2 } from "lucide-react";
import { EmptyState } from "@/components/dashboard/empty-state";
import { PageHeader } from "@/components/dashboard/page-header";
import { CallerListOrder, CallListToggle, ListCallersButton, UnassignCallerButton } from "@/components/calls/call-list-controls";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ListSkeleton } from "@/components/ui/skeleton";
import { requireModule } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { loadViews } from "@/lib/sales/data";
import { countCallLists } from "@/lib/sales/queue";
import { amsterdamDate } from "@/lib/sales/status";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Call lists",
};

export default function Page() {
  return (
    <>
      <PageHeader
        eyebrow="Sales"
        title="Call lists"
        description="A call list is a saved view of the Contacts table. Call it yourself, or open it for external callers until a date."
      />
      <Suspense fallback={<ListSkeleton rows={6} />}>
        <CallLists />
      </Suspense>
    </>
  );
}

async function CallLists() {
  const user = await requireModule("sales");
  const isAdmin = user.role === "admin";
  const db = await createClient();
  const today = amsterdamDate();
  const [views, callersResult, linksResult, assignedResult] = await Promise.all([
    loadViews(db, "contacts"),
    db.from("callers").select("id, name, party, status").neq("status", "stopped").order("name"),
    db.from("call_list_callers").select("view_id, caller_id, position, open_until").order("position"),
    db.from("contacts").select("assigned_caller_id, assigned_until").not("assigned_caller_id", "is", null).limit(20000),
  ]);
  const callLists = views.filter((v) => v.isCallList);
  const otherViews = views.filter((v) => !v.isCallList);
  const callers = callersResult.data ?? [];
  const activeCallers = callers.filter((c) => c.status === "active").map((c) => ({ id: c.id, name: c.name, party: c.party }));
  const callerName = new Map(callers.map((c) => [c.id, c.name]));
  const links = linksResult.data ?? [];
  const listName = new Map(callLists.map((v) => [v.id, v.name]));
  const assignedCount = new Map<string, number>();
  for (const a of assignedResult.data ?? []) {
    if (!a.assigned_caller_id || (a.assigned_until && a.assigned_until < today)) continue;
    assignedCount.set(a.assigned_caller_id, (assignedCount.get(a.assigned_caller_id) ?? 0) + 1);
  }

  const counts = await countCallLists(
    db,
    callLists.map((v) => ({ id: v.id, name: v.name, config: v.config })),
    user.id,
  );

  return (
    <div className="space-y-8">
      {callLists.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title="No call lists yet"
          description="Save a view in the Contacts table (filters and order), then mark it as a call list below."
        />
      ) : (
        <section aria-labelledby="lists-heading" className="space-y-3">
          <h2 id="lists-heading" className="font-display text-lg font-semibold text-brand-900">
            Call lists
          </h2>
          <ul className="space-y-3">
            {callLists.map((v) => {
              const c = counts.lists.get(v.id) ?? { total: 0, callable: 0 };
              const openFor = links.filter((l) => l.view_id === v.id);
              return (
                <li key={v.id}>
                  <Card>
                    <CardBody className="flex flex-col gap-4 py-4 lg:flex-row lg:items-center lg:justify-between">
                      <div className="min-w-0 space-y-1.5">
                        <p className="font-medium text-ink">{v.name}</p>
                        <p className="text-sm text-muted">
                          {c.total} {c.total === 1 ? "contact" : "contacts"} · {c.callable} to call now
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {openFor.length === 0 ? (
                            <span className="text-xs text-muted">Not open for callers</span>
                          ) : (
                            openFor.map((o) => {
                              const ended = o.open_until != null && o.open_until < today;
                              return (
                                <Badge key={o.caller_id} tone={ended ? "neutral" : "brand"}>
                                  {callerName.get(o.caller_id) ?? "Caller"}
                                  {o.open_until ? ` ${ended ? "ended" : "until"} ${formatDate(o.open_until)}` : ""}
                                </Badge>
                              );
                            })
                          )}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2 max-sm:*:flex-1">
                        <ButtonLink href={`/dashboard/contacts?view=${v.id}`} variant="secondary" size="sm">
                          <Table2 aria-hidden="true" />
                          Open in table
                        </ButtonLink>
                        <ButtonLink href={`/dashboard/calls?list=${v.id}`} size="sm">
                          <Phone aria-hidden="true" />
                          Start calling
                        </ButtonLink>
                        {isAdmin && (
                          <ListCallersButton
                            key={openFor.map((o) => `${o.caller_id}:${o.open_until}`).join(",")}
                            viewId={v.id}
                            listName={v.name}
                            callers={activeCallers}
                            openFor={openFor.map((o) => ({ callerId: o.caller_id, openUntil: o.open_until }))}
                          />
                        )}
                        <CallListToggle viewId={v.id} isCallList />
                      </div>
                    </CardBody>
                  </Card>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {isAdmin && callers.length > 0 && (
        <section aria-labelledby="order-heading" className="space-y-3">
          <div>
            <h2 id="order-heading" className="font-display text-lg font-semibold text-brand-900">
              Per caller
            </h2>
            <p className="mt-0.5 max-w-2xl text-sm text-muted">
              A caller first gets the contacts assigned to them, then due sequence calls, then their lists in this order.
              Drag the lists or use the arrows. Callers cannot change this themselves.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {callers.map((caller) => {
              const lists = links
                .filter((l) => l.caller_id === caller.id && listName.has(l.view_id))
                .map((l) => ({
                  viewId: l.view_id,
                  name: listName.get(l.view_id)!,
                  openUntil: l.open_until,
                  expired: l.open_until != null && l.open_until < today,
                }));
              const assigned = assignedCount.get(caller.id) ?? 0;
              return (
                <Card key={caller.id}>
                  <CardHeader
                    title={caller.name}
                    description={caller.status === "paused" ? "Paused" : (caller.party ?? undefined)}
                  />
                  <CardBody className="space-y-3">
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="text-muted">
                        {assigned} assigned {assigned === 1 ? "contact" : "contacts"}
                      </span>
                      <UnassignCallerButton callerId={caller.id} count={assigned} />
                    </div>
                    <CallerListOrder key={lists.map((l) => l.viewId).join(",")} callerId={caller.id} lists={lists} />
                  </CardBody>
                </Card>
              );
            })}
          </div>
        </section>
      )}

      {otherViews.length > 0 && (
        <section aria-labelledby="views-heading" className="space-y-3">
          <div>
            <h2 id="views-heading" className="font-display text-lg font-semibold text-brand-900">
              Other saved contact views
            </h2>
            <p className="mt-0.5 text-sm text-muted">Mark a view as a call list to call it and open it for callers.</p>
          </div>
          <Card>
            <ul className="divide-y divide-border">
              {otherViews.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5">
                  <span className="font-medium text-ink">{v.name}</span>
                  <span className="flex flex-wrap gap-2">
                    <ButtonLink href={`/dashboard/contacts?view=${v.id}`} variant="ghost" size="sm">
                      Open in table
                    </ButtonLink>
                    <CallListToggle viewId={v.id} isCallList={false} />
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}
    </div>
  );
}
