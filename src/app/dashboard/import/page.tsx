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
        eyebrow="Admin"
        title="Import"
        description="Bring the old lead lists from Google Sheets into the system. Domains are normalised and duplicates are merged."
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
