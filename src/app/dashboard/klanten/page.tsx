import type { Metadata } from "next";
import { Building2 } from "lucide-react";
import { EmptyState } from "@/components/dashboard/empty-state";
import { PageHeader } from "@/components/dashboard/page-header";

export const metadata: Metadata = {
  title: "Klanten",
};

export default function Page() {
  return (
    <>
      <PageHeader
        eyebrow="Werving"
        title="Klanten"
        description="De Nederlandse groeibedrijven waarvoor we developers en data engineers zoeken."
      />
      <EmptyState
        icon={Building2}
        title="Nog geen klanten"
        description="Hier komt het overzicht van klanten, contactpersonen en lopende afspraken. Deze module bouwen we binnenkort."
      />
    </>
  );
}
