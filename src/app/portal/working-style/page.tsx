import type { Metadata } from "next";
import { Suspense } from "react";
import { ListSkeleton } from "@/components/ui/skeleton";
import { WspPortalSection } from "@/components/wsp/portal-section";
import { requireClient } from "@/lib/auth";

export const metadata: Metadata = { title: "Working style profiles" };

/** Profiles shared with this client (only with an active share; RLS and wsp_client_reports). */
export default function Page() {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="font-display text-2xl font-bold text-brand-900">Working style profiles</h1>
      <Suspense fallback={<ListSkeleton rows={3} />}>
        <List />
      </Suspense>
    </div>
  );
}

async function List() {
  await requireClient();
  return <WspPortalSection full />;
}
