import type { Metadata } from "next";
import { Suspense } from "react";
import { Upload } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { ListMarker } from "@/components/leads/back-to-list";
import { ContactTabs } from "@/components/sales/contact-tabs";
import { SalesTable } from "@/components/sales/table-page";
import { ButtonLink } from "@/components/ui/button";
import { ListSkeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = {
  title: "Contacts",
};

export default function Page({ searchParams }: PageProps<"/dashboard/contacts">) {
  return (
    <>
      <PageHeader
        eyebrow="Sales"
        title="Contacts"
        description="Every contact person with role, status and caller. Save a filtered view as a call list; it is not an export, the list stays up to date."
        actions={
          <ButtonLink href="/dashboard/import" variant="secondary">
            <Upload aria-hidden="true" />
            Import
          </ButtonLink>
        }
      />
      <Suspense fallback={null}>
        <ListMarker />
      </Suspense>
      <ContactTabs active="all" />
      <Suspense fallback={<ListSkeleton rows={10} />}>
        <Table searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Table({ searchParams }: { searchParams: PageProps<"/dashboard/contacts">["searchParams"] }) {
  return <SalesTable kind="contacts" params={await searchParams} emptyText="No contacts match this view." />;
}
