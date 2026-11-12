import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { Inbox } from "lucide-react";
import { EmptyState } from "@/components/dashboard/empty-state";
import { PageHeader } from "@/components/dashboard/page-header";
import { InboxList } from "@/components/sales/inbox-list";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody } from "@/components/ui/card";
import { ListSkeleton } from "@/components/ui/skeleton";
import { getCurrentUser } from "@/lib/auth";
import { loadInbox } from "@/lib/sales/inbox";
import { bucketOption, salesBuckets } from "@/lib/sales/triage";
import type { SalesBucket } from "@/lib/sales/flow-database";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Incoming",
};

export default function Page({ searchParams }: PageProps<"/dashboard/inbox">) {
  return (
    <>
      <PageHeader
        eyebrow="Sales"
        title="Incoming"
        description="New leads land here per list they came in with. Send each lead, or a selection, to one destination: find a number, call, a mail or LinkedIn campaign, park or no go. Every lead is always in exactly one bucket or flow."
      />
      <Suspense fallback={<ListSkeleton rows={8} />}>
        <InboxPage searchParams={searchParams} />
      </Suspense>
    </>
  );
}

function isBucket(value: unknown): value is SalesBucket {
  return typeof value === "string" && salesBuckets.some((b) => b.value === value);
}

async function InboxPage({ searchParams }: { searchParams: PageProps<"/dashboard/inbox">["searchParams"] }) {
  const params = await searchParams;
  const bucket: SalesBucket = isBucket(params.bucket) ? params.bucket : "incoming";
  const list = typeof params.list === "string" ? params.list : null;
  const db = await createClient();
  const user = await getCurrentUser();
  let inbox;
  try {
    inbox = await loadInbox(db);
  } catch (e) {
    console.error("loadInbox", e);
    return (
      <EmptyState
        icon={Inbox}
        title="Incoming is not set up yet"
        description="Apply the latest database migrations (sales triage and occupancy), then reload this page."
      />
    );
  }
  const callers =
    user.role === "admin" ? ((await db.from("callers").select("id, name").eq("status", "active").order("name")).data ?? []) : undefined;
  const rows = inbox.rows.filter((r) => r.bucket === bucket && (!list || r.sourceList === list));
  const current = bucketOption(bucket);

  return (
    <div className="space-y-6">
      <section aria-labelledby="buckets-heading" className="space-y-3">
        <h2 id="buckets-heading" className="sr-only">
          Buckets
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {inbox.buckets.map((b) => {
            const option = bucketOption(b.bucket);
            const active = b.bucket === bucket;
            return (
              <li key={b.bucket}>
                <Link
                  href={b.bucket === "incoming" ? "/dashboard/inbox" : `/dashboard/inbox?bucket=${b.bucket}`}
                  aria-current={active ? "page" : undefined}
                  className={`block h-full rounded-2xl border px-4 py-3 transition hover:border-brand-300 ${active ? "border-brand-500 bg-brand-50" : "border-border bg-card"}`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-medium text-ink">{option.label}</span>
                    <span className="font-display text-xl font-bold text-brand-900 tabular-nums">{b.count}</span>
                  </span>
                  <span className="mt-1 block text-xs text-muted">
                    {b.workers.filter((w) => w.name).length > 0
                      ? b.workers
                          .filter((w) => w.name)
                          .slice(0, 3)
                          .map((w) => `${w.name} ${w.count}`)
                          .join(" · ")
                      : option.description}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      {bucket === "incoming" && (
        <Card>
          <CardBody className="space-y-2 py-4">
            <h2 className="font-display text-base font-semibold text-brand-900">Per list</h2>
            <p className="text-sm text-muted">How many leads each list brought in, and how many of them still have no destination.</p>
            <ul className="flex flex-wrap gap-2">
              <li>
                <Link href="/dashboard/inbox" className={`inline-flex min-h-9 items-center rounded-full border px-3 text-sm ${!list ? "border-brand-500 bg-brand-50 font-medium" : "border-border"}`}>
                  All lists
                </Link>
              </li>
              {inbox.sourceLists.map((s) => (
                <li key={s.name}>
                  <Link
                    href={`/dashboard/inbox?list=${encodeURIComponent(s.name)}`}
                    className={`inline-flex min-h-9 items-center gap-2 rounded-full border px-3 text-sm ${list === s.name ? "border-brand-500 bg-brand-50 font-medium" : "border-border"}`}
                  >
                    {s.name}
                    <Badge tone={s.incoming > 0 ? "warning" : "success"}>
                      {s.incoming} of {s.total} without destination
                    </Badge>
                  </Link>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      <section aria-labelledby="rows-heading" className="space-y-3">
        <h2 id="rows-heading" className="font-display text-lg font-semibold text-brand-900">
          {current.label}
          {list ? `: ${list}` : ""} ({rows.length})
        </h2>
        {rows.length === 0 ? (
          <EmptyState icon={Inbox} title={`Nothing in ${current.label}`} description={current.description} />
        ) : (
          <InboxList
            rows={rows.slice(0, 1000)}
            truncated={rows.length > 1000}
            groupBy={bucket === "incoming" ? "list" : "worker"}
            callers={callers}
          />
        )}
      </section>
    </div>
  );
}
