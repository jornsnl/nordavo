import type { Metadata } from "next";
import { Suspense } from "react";
import { ListChecks } from "lucide-react";
import { CampaignsTable } from "@/components/campaigns/campaigns-table";
import { PageHeader } from "@/components/dashboard/page-header";
import { ButtonLink } from "@/components/ui/button";
import { ListSkeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = {
  title: "Campagnes",
};

export default function Page() {
  return (
    <>
      <PageHeader
        eyebrow="Sales"
        title="Campagnes"
        description="Eén signaal per campagne, zodat je ziet wat werkt. Na 150 mails evalueren: onder 3% reply herschrijven of stoppen, boven 5% opschalen."
        actions={
          <ButtonLink href="/dashboard/lijsten?lijst=mailcampagne#voorbeeld">
            <ListChecks aria-hidden="true" />
            Maillijst vullen
          </ButtonLink>
        }
      />
      <Suspense fallback={<ListSkeleton rows={5} />}>
        <CampaignsTable />
      </Suspense>
      <p className="mt-4 text-sm text-muted">
        Leads zijn contacten die in de campagne zijn gezet. Replies en afspraken tellen per contact; een afspraak telt mee als hij na
        het eerste bericht uit de campagne is gepland.
      </p>
    </>
  );
}
