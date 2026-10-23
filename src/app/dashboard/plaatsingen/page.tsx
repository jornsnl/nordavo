import type { Metadata } from "next";
import { Handshake } from "lucide-react";
import { EmptyState } from "@/components/dashboard/empty-state";
import { PageHeader } from "@/components/dashboard/page-header";

export const metadata: Metadata = {
  title: "Plaatsingen",
};

export default function Page() {
  return (
    <>
      <PageHeader
        eyebrow="Werving"
        title="Plaatsingen"
        description="Developers die fulltime in het team van een klant werken."
      />
      <EmptyState
        icon={Handshake}
        title="Nog geen plaatsingen"
        description="Hier zie je straks wie waar geplaatst is, sinds wanneer en hoe de begeleiding loopt."
      />
    </>
  );
}
