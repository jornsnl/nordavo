import type { Metadata } from "next";
import { Briefcase } from "lucide-react";
import { EmptyState } from "@/components/dashboard/empty-state";
import { PageHeader } from "@/components/dashboard/page-header";

export const metadata: Metadata = {
  title: "Vacatures",
};

export default function Page() {
  return (
    <>
      <PageHeader
        eyebrow="Werving"
        title="Vacatures"
        description="Openstaande functieprofielen, van eerste vraag tot drie kandidaten."
      />
      <EmptyState
        icon={Briefcase}
        title="Nog geen vacatures"
        description="Hier volg je straks elke vacature: het profiel, de status en de doorlooptijd richting drie kandidaten."
      />
    </>
  );
}
