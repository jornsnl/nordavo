import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/dashboard/page-header";
import { RoutesTable } from "@/components/sales/routes-table";
import { ListSkeleton } from "@/components/ui/skeleton";
import { requireModule } from "@/lib/auth";
import type { SalesRouteRow } from "@/lib/sales/routes";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Running routes",
};

export default function Page() {
  return (
    <>
      <PageHeader
        eyebrow="Sales"
        title="Running routes"
        description="What runs now in outreach: call lists, mail and LinkedIn campaigns and the rest. Kept by hand; it changes nothing in leads, buckets or campaigns."
      />
      <Suspense fallback={<ListSkeleton rows={6} />}>
        <Routes />
      </Suspense>
    </>
  );
}

async function Routes() {
  await requireModule("sales");
  const supabase = await createClient();
  const { data, error } = await supabase.from("sales_routes").select("*").limit(1000);
  if (error) {
    return <p className="rounded-xl border border-danger/20 bg-danger-bg px-3 py-2 text-sm text-danger">Could not load the routes.</p>;
  }
  return <RoutesTable initialRows={(data ?? []) as SalesRouteRow[]} />;
}
