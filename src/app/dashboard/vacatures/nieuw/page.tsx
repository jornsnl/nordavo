import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/dashboard/page-header";
import { VacancyForm } from "@/components/vacancies/vacancy-form";
import { Card, CardBody } from "@/components/ui/card";
import { ListSkeleton } from "@/components/ui/skeleton";
import { listClientOptions, listStaffOptions } from "@/lib/data/clients";
import { createVacancyAction } from "../actions";

export const metadata: Metadata = {
  title: "Nieuwe vacature",
};

export default function Page({ searchParams }: PageProps<"/dashboard/vacatures/nieuw">) {
  return (
    <>
      <PageHeader
        eyebrow="Vacatures"
        title="Nieuwe vacature"
        description="Leg het functieprofiel vast. Vanaf vandaag loopt de klok richting drie kandidaten."
      />
      <Card className="max-w-3xl">
        <CardBody className="py-6">
          <Suspense fallback={<ListSkeleton rows={5} />}>
            <NewVacancyForm searchParams={searchParams} />
          </Suspense>
        </CardBody>
      </Card>
    </>
  );
}

async function NewVacancyForm({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ client }, clients, staff] = await Promise.all([
    searchParams,
    listClientOptions(),
    listStaffOptions(),
  ]);
  const clientId = typeof client === "string" && clients.some((c) => c.id === client) ? client : undefined;

  return (
    <VacancyForm
      action={createVacancyAction}
      defaults={{ client_id: clientId }}
      clients={clients}
      staff={staff}
      cancelHref={clientId ? `/dashboard/klanten/${clientId}` : "/dashboard/vacatures"}
      submitLabel="Vacature toevoegen"
    />
  );
}
