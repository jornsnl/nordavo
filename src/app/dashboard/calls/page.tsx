import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { ArrowLeft, ListChecks, Phone, Route } from "lucide-react";
import { EmptyState } from "@/components/dashboard/empty-state";
import { PageHeader } from "@/components/dashboard/page-header";
import { CallScreen } from "@/components/calls/call-screen";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { ListSkeleton } from "@/components/ui/skeleton";
import { requireModule } from "@/lib/auth";
import { loadViews } from "@/lib/sales/data";
import { countCallLists, type QueueScope } from "@/lib/sales/queue";
import { createClient } from "@/lib/supabase/server";
import { logTeamCall, releaseTeamCall, skipTeamCall, startTeamCalls } from "./actions";

export const metadata: Metadata = {
  title: "Calls",
};

export default function Page({ searchParams }: PageProps<"/dashboard/calls">) {
  return (
    <>
      <PageHeader
        eyebrow="Sales"
        title="Calls"
        description="Call through a call list or the sequence calls due today. Every outcome is saved at once and the next contact opens."
      />
      <Suspense fallback={<ListSkeleton rows={4} />}>
        <Calls searchParams={searchParams} />
      </Suspense>
    </>
  );
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function Calls({ searchParams }: { searchParams: PageProps<"/dashboard/calls">["searchParams"] }) {
  const user = await requireModule("sales");
  const params = await searchParams;
  const list = typeof params.list === "string" ? params.list : undefined;
  const db = await createClient();
  const views = await loadViews(db, "contacts", { callListsOnly: true });

  const scope: QueueScope | null =
    list === "sequence"
      ? { kind: "sequence" }
      : list && uuid.test(list) && views.some((v) => v.id === list)
        ? { kind: "list", listId: list }
        : null;

  if (scope) {
    const name = scope.kind === "sequence" ? "Sequence calls due today" : views.find((v) => v.id === list)?.name;
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            href="/dashboard/calls"
            className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-muted hover:text-brand-700"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            All lists
          </Link>
          <p className="font-display text-base font-semibold text-brand-900">{name}</p>
        </div>
        <CallScreen
          key={list}
          emptyText={
            scope.kind === "sequence"
              ? "No sequence call steps are due today, or the contacts are open elsewhere, called today or not callable."
              : "Everyone on this list is called today, open with someone else, assigned to a caller, waiting for a call back or not callable."
          }
          actions={{
            start: startTeamCalls.bind(null, scope),
            log: logTeamCall.bind(null, scope),
            skip: skipTeamCall.bind(null, scope),
            release: releaseTeamCall,
          }}
        />
      </div>
    );
  }

  const counts = await countCallLists(
    db,
    views.map((v) => ({ id: v.id, name: v.name, config: v.config })),
    user.id,
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardBody className="flex flex-wrap items-center justify-between gap-4 py-5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-100 text-brand-900">
              <Route className="size-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="font-medium text-ink">Sequence calls due today</p>
              <p className="text-sm text-muted">
                {counts.sequenceDue === 0 ? "Nothing due" : `${counts.sequenceDue} to call`}
              </p>
            </div>
          </div>
          <ButtonLink href="/dashboard/calls?list=sequence" className="max-sm:w-full" variant={counts.sequenceDue ? "primary" : "secondary"}>
            <Phone aria-hidden="true" />
            Start calling
          </ButtonLink>
        </CardBody>
      </Card>

      {views.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title="No call lists yet"
          description="A call list is a saved view of the Contacts table. Save a view there and mark it as a call list on the Call lists page."
        />
      ) : (
        <section aria-labelledby="lists-heading" className="space-y-3">
          <h2 id="lists-heading" className="font-display text-lg font-semibold text-brand-900">
            Call lists
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {views.map((v) => {
              const c = counts.lists.get(v.id) ?? { total: 0, callable: 0 };
              return (
                <li key={v.id}>
                  <Card className="h-full">
                    <CardBody className="flex h-full flex-col justify-between gap-4 py-5">
                      <div>
                        <p className="font-medium text-ink">{v.name}</p>
                        <p className="text-sm text-muted">
                          {c.callable} to call now · {c.total} on the list
                        </p>
                      </div>
                      <ButtonLink
                        href={`/dashboard/calls?list=${v.id}`}
                        variant={c.callable ? "primary" : "secondary"}
                        className="w-full"
                      >
                        <Phone aria-hidden="true" />
                        Start calling
                      </ButtonLink>
                    </CardBody>
                  </Card>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
