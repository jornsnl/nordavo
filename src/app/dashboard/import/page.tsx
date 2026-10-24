import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/dashboard/page-header";
import { ImportWizard } from "@/components/import/import-wizard";
import { ListSkeleton } from "@/components/ui/skeleton";
import { requireStaff } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Import",
};

// One block of 500 rows does many upserts; give the import action time.
export const maxDuration = 300;

export default function Page() {
  return (
    <>
      <PageHeader
        eyebrow="Beheer"
        title="Import"
        description="Zet de oude leadlijsten uit Google Sheets in het systeem. Domeinen worden genormaliseerd en dubbelingen aangevuld."
      />
      <Suspense fallback={<ListSkeleton rows={4} />}>
        <StaffOnly />
      </Suspense>
    </>
  );
}

async function StaffOnly() {
  await requireStaff();
  return <ImportWizard />;
}
