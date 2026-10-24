import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { ArrowLeft, PartyPopper } from "lucide-react";
import { EmptyState } from "@/components/dashboard/empty-state";
import { PageHeader } from "@/components/dashboard/page-header";
import { IcpBadge } from "@/components/leads/badges";
import { LeadTabs } from "@/components/leads/lead-tabs";
import { ReviewWorkspace } from "@/components/leads/review-workspace";
import { Card, CardHeader } from "@/components/ui/card";
import { ListSkeleton } from "@/components/ui/skeleton";
import { listReviewQueue } from "@/lib/data/companies";
import { reviewDecisionAction } from "../actions";

export const metadata: Metadata = {
  title: "Review leads",
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function Page({ searchParams }: PageProps<"/dashboard/leads/review">) {
  return (
    <>
      <Link
        href="/dashboard/leads"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-brand-700 max-md:-mt-2 max-md:mb-2 max-md:min-h-11 max-md:active:text-brand-700"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Alle leads
      </Link>
      <PageHeader
        eyebrow="Sales"
        title="Review"
        description="Bedrijven waar Claude twijfelt. Kies GO of No go; daarna komt direct het volgende bedrijf."
      />
      <Suspense
        fallback={
          <>
            <LeadTabs active="review" reviewCount={null} />
            <ListSkeleton rows={8} />
          </>
        }
      >
        <ReviewQueue searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function ReviewQueue({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const queue = await listReviewQueue(100);
  const requested = typeof params.id === "string" ? params.id : undefined;

  if (queue.length === 0) {
    return (
      <>
        <LeadTabs active="review" reviewCount={0} />
        <EmptyState
          icon={PartyPopper}
          title="Niets te beoordelen"
          description="Alle bedrijven hebben een oordeel. Nieuwe twijfelgevallen komen hier na de maandagflow."
        />
      </>
    );
  }

  const index = Math.max(0, requested ? queue.findIndex((c) => c.id === requested) : 0);
  const item = queue[index];
  const next = queue[index + 1] ?? (index > 0 ? queue[0] : undefined);

  return (
    <>
      <LeadTabs active="review" reviewCount={queue.length} />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          <ReviewWorkspace
            item={item}
            action={reviewDecisionAction.bind(null, item.id)}
            position={index + 1}
            total={queue.length}
            nextId={next && next.id !== item.id ? next.id : null}
          />
        </div>
        <Card className="h-fit">
          <CardHeader
            title="Wachtrij"
            description={queue.length >= 100 ? "De eerste 100, hoogste score eerst." : "Hoogste score eerst."}
          />
          <ol className="max-h-[70dvh] divide-y divide-border overflow-y-auto">
            {queue.map((c, i) => (
              <li key={c.id}>
                <Link
                  href={`/dashboard/leads/review?id=${c.id}`}
                  scroll={false}
                  aria-current={i === index ? "true" : undefined}
                  className={`flex items-center justify-between gap-3 px-5 py-3 text-sm hover:bg-brand-50/60 active:bg-brand-50 max-md:min-h-12 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-500 ${
                    i === index ? "bg-brand-50 font-semibold text-brand-900" : "text-ink"
                  }`}
                >
                  <span className="min-w-0 truncate">{c.name}</span>
                  <IcpBadge decision="REVIEW" score={c.icpScore} />
                </Link>
              </li>
            ))}
          </ol>
        </Card>
      </div>
      {/* Room for the fixed decision bar on phones and tablets. */}
      <div aria-hidden="true" className="h-20 lg:hidden" />
    </>
  );
}
