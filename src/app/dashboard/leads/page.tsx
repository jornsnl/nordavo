import type { Metadata } from "next";
import { Suspense } from "react";
import { Plus, Upload } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { LeadTabs } from "@/components/leads/lead-tabs";
import { SalesTable } from "@/components/sales/table-page";
import { ButtonLink } from "@/components/ui/button";
import { ListSkeleton } from "@/components/ui/skeleton";
import { countReview } from "@/lib/data/companies";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Leads",
};

export default function Page({ searchParams }: PageProps<"/dashboard/leads">) {
  return (
    <>
      <PageHeader
        eyebrow="Sales"
        title="Leads"
        description="Every company, with its lead status. Edit cells like a spreadsheet, or switch to the board and drag cards between statuses."
        actions={
          <>
            <ButtonLink href="/dashboard/import" variant="secondary">
              <Upload aria-hidden="true" />
              Import
            </ButtonLink>
            <ButtonLink href="/dashboard/leads/new">
              <Plus aria-hidden="true" />
              Add lead
            </ButtonLink>
          </>
        }
      />
      <Suspense fallback={<LeadTabs active="all" reviewCount={null} />}>
        <Tabs />
      </Suspense>
      <Suspense fallback={<ListSkeleton rows={10} />}>
        <Table searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Tabs() {
  const supabase = await createClient();
  const [review, replies] = await Promise.all([
    countReview(),
    supabase.from("activities").select("id", { count: "exact", head: true }).eq("review_status", "pending"),
  ]);
  return <LeadTabs active="all" reviewCount={review} replyCount={replies.count ?? 0} />;
}

async function Table({ searchParams }: { searchParams: PageProps<"/dashboard/leads">["searchParams"] }) {
  return <SalesTable kind="companies" params={await searchParams} emptyText="No companies match this view." />;
}
