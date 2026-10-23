import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/dashboard/page-header";
import { ClientForm } from "@/components/clients/client-form";
import { Card, CardBody } from "@/components/ui/card";
import { ListSkeleton } from "@/components/ui/skeleton";
import { listStaffOptions } from "@/lib/data/clients";
import { createClientAction } from "../actions";

export const metadata: Metadata = {
  title: "Nieuwe klant",
};

export default function Page() {
  return (
    <>
      <PageHeader
        eyebrow="Klanten"
        title="Nieuwe klant"
        description="Leg het bedrijf vast. Contactpersonen en vacatures voeg je daarna toe."
      />
      <Card className="max-w-3xl">
        <CardBody className="py-6">
          <Suspense fallback={<ListSkeleton rows={4} />}>
            <NewClientForm />
          </Suspense>
        </CardBody>
      </Card>
    </>
  );
}

async function NewClientForm() {
  const staff = await listStaffOptions();
  return (
    <ClientForm
      action={createClientAction}
      staff={staff}
      cancelHref="/dashboard/klanten"
      submitLabel="Klant toevoegen"
    />
  );
}
