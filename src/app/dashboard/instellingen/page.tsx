import type { Metadata } from "next";
import { Settings } from "lucide-react";
import { EmptyState } from "@/components/dashboard/empty-state";
import { PageHeader } from "@/components/dashboard/page-header";

export const metadata: Metadata = {
  title: "Instellingen",
};

export default function Page() {
  return (
    <>
      <PageHeader
        eyebrow="Beheer"
        title="Instellingen"
        description="Je account, het team en de koppelingen van het portaal."
      />
      <EmptyState
        icon={Settings}
        title="Instellingen volgen"
        description="Hier beheer je straks je profiel, gebruikers en rechten."
      />
    </>
  );
}
