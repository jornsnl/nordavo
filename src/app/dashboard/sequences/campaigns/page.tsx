import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { CampaignList } from "@/components/campaigns/campaign-list";
import { NewCampaignForm } from "@/components/campaigns/campaign-controls";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ListSkeleton } from "@/components/ui/skeleton";
import { listCampaigns } from "@/lib/data/campaigns";

export const metadata: Metadata = {
  title: "Campaigns",
};

export default function Page({ searchParams }: PageProps<"/dashboard/sequences/campaigns">) {
  return (
    <>
      <Link href="/dashboard/sequences" className="mb-4 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-muted hover:text-brand-700">
        <ArrowLeft className="size-4" aria-hidden="true" />
        Sequences
      </Link>
      <PageHeader
        eyebrow="Sales"
        title="Campaigns"
        description="Mail campaigns in Instantly and LinkedIn campaigns in Seleqt: which run, which leads are in them and who replied. A lead is in one running campaign at a time; when a campaign ends without a reply the lead is free again."
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          <Suspense fallback={<ListSkeleton rows={5} />}>
            <List searchParams={searchParams} />
          </Suspense>
        </div>
        <Card className="self-start">
          <CardHeader title="New campaign" description="Then send leads to it from Incoming or the Leads table." />
          <CardBody>
            <NewCampaignForm />
          </CardBody>
        </Card>
      </div>
    </>
  );
}

async function List({ searchParams }: { searchParams: PageProps<"/dashboard/sequences/campaigns">["searchParams"] }) {
  const all = (await searchParams).all === "1";
  const campaigns = await listCampaigns({ includeFinished: all });
  return (
    <div className="space-y-3">
      <CampaignList campaigns={campaigns} />
      <Link href={all ? "/dashboard/sequences/campaigns" : "/dashboard/sequences/campaigns?all=1"} className="text-sm font-semibold text-brand-600 hover:text-brand-800">
        {all ? "Only running campaigns" : "Also finished campaigns"}
      </Link>
    </div>
  );
}
