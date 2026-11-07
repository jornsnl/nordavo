import type { Metadata } from "next";
import { Suspense } from "react";
import { ListChecks } from "lucide-react";
import { CampaignsTable } from "@/components/campaigns/campaigns-table";
import { PageHeader } from "@/components/dashboard/page-header";
import { ButtonLink } from "@/components/ui/button";
import { ListSkeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = {
  title: "Campaigns",
};

export default function Page() {
  return (
    <>
      <PageHeader
        eyebrow="Sales"
        title="Campaigns"
        description="One signal per campaign, so you can see what works. Review after 150 emails: below 3% replies, rewrite or stop; above 5%, scale up."
        actions={
          <ButtonLink href="/dashboard/lists?lijst=mailcampagne#voorbeeld">
            <ListChecks aria-hidden="true" />
            Fill mailing list
          </ButtonLink>
        }
      />
      <Suspense fallback={<ListSkeleton rows={5} />}>
        <CampaignsTable />
      </Suspense>
      <p className="mt-4 text-sm text-muted">
        Leads are contacts that were added to the campaign. Replies and meetings count per contact; a meeting counts if it was
        booked after the first message of the campaign.
      </p>
    </>
  );
}
