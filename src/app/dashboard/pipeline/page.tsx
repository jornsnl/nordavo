import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/dashboard/page-header";
import { PipelineSummary } from "@/components/sales/pipeline-summary";
import { SalesTable } from "@/components/sales/table-page";
import { ListSkeleton, Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = {
  title: "Pipeline",
};

export default function Page({ searchParams }: PageProps<"/dashboard/pipeline">) {
  return (
    <>
      <PageHeader
        eyebrow="Sales"
        title="Pipeline"
        description="Only companies that showed interest, in 8 stages. Leads stay cold until then. Intake, profiles, interviews and won follow from the recruitment data by themselves."
      />
      <Suspense fallback={<Skeleton className="mb-6 h-20 w-full" />}>
        <PipelineSummary />
      </Suspense>
      <Suspense fallback={<ListSkeleton rows={8} />}>
        <Table searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Table({ searchParams }: { searchParams: PageProps<"/dashboard/pipeline">["searchParams"] }) {
  const params = await searchParams;
  return (
    <SalesTable
      kind="pipeline"
      params={params.mode ? params : { ...params, mode: "board" }}
      emptyText="No company in the pipeline yet. A company comes in by itself on interest: a call outcome Reached interested, a booked meeting or a positive reply."
    />
  );
}
