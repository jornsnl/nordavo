import type { Metadata } from "next";
import { Users } from "lucide-react";
import { EmptyState } from "@/components/dashboard/empty-state";
import { PageHeader } from "@/components/dashboard/page-header";

export const metadata: Metadata = {
  title: "Kandidaten",
};

export default function Page() {
  return (
    <>
      <PageHeader
        eyebrow="Werving"
        title="Kandidaten"
        description="Developers en data engineers uit Bangalore, van screening tot eindgesprek."
      />
      <EmptyState
        icon={Users}
        title="Nog geen kandidaten"
        description="Hier komen kandidaatprofielen met assessmentuitslagen, video-intro en de stand van de selectie."
      />
    </>
  );
}
