import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/dashboard/page-header";
import { CallListImport } from "@/components/import/call-list-import";
import { ImportWizard } from "@/components/import/import-wizard";
import { ListSkeleton } from "@/components/ui/skeleton";
import { hasModule, requireStaff } from "@/lib/auth";

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
        description="Bring the call list and the old lead lists into the system. Domains are normalised and duplicates are merged."
      />
      <Suspense fallback={<ListSkeleton rows={4} />}>
        <StaffOnly />
      </Suspense>
    </>
  );
}

async function StaffOnly() {
  const user = await requireStaff();
  return (
    <>
      {hasModule(user, "sales") && <CallListImport />}
      <ImportWizard />
    </>
  );
}
