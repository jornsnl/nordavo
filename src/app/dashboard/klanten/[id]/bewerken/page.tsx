import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/dashboard/page-header";
import { ClientForm } from "@/components/clients/client-form";
import { Card, CardBody } from "@/components/ui/card";
import { ListSkeleton } from "@/components/ui/skeleton";
import { getClient, listStaffOptions } from "@/lib/data/clients";
import { updateClientAction } from "../../actions";

export const metadata: Metadata = {
  title: "Klant bewerken",
};

export default function Page({ params }: PageProps<"/dashboard/klanten/[id]/bewerken">) {
  return (
    <>
      <PageHeader eyebrow="Klanten" title="Klant bewerken" />
      <Card className="max-w-3xl">
        <CardBody className="py-6">
          <Suspense fallback={<ListSkeleton rows={4} />}>
            <EditClientForm params={params} />
          </Suspense>
        </CardBody>
      </Card>
    </>
  );
}

async function EditClientForm({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [client, staff] = await Promise.all([getClient(id), listStaffOptions()]);
  if (!client) notFound();

  return (
    <ClientForm
      action={updateClientAction.bind(null, client.id)}
      defaults={client}
      staff={staff}
      cancelHref={`/dashboard/klanten/${client.id}`}
      submitLabel="Wijzigingen opslaan"
    />
  );
}
