import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/dashboard/page-header";
import { VacancyForm } from "@/components/vacancies/vacancy-form";
import { Card, CardBody } from "@/components/ui/card";
import { ListSkeleton } from "@/components/ui/skeleton";
import { listClientOptions, listStaffOptions } from "@/lib/data/clients";
import { isUuid } from "@/lib/data/clients";
import { listCompanyOptions } from "@/lib/data/vacancies";
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
  const params = await searchParams;
  // ?company=<id>: the sales UI links here to start a vacancy for a prospect.
  const companyParam = isUuid(params.company) ? params.company : undefined;
  const [clients, companies, staff] = await Promise.all([
    listClientOptions(),
    listCompanyOptions(companyParam),
    listStaffOptions(),
  ]);
  const clientId = typeof params.client === "string" && clients.some((c) => c.id === params.client) ? params.client : undefined;
  const companyId = !clientId && companyParam && companies.some((c) => c.id === companyParam) ? companyParam : undefined;

  return (
    <VacancyForm
      action={createVacancyAction}
      defaults={{ client_id: clientId, company_id: companyId }}
      clients={clients}
      companies={companies}
      staff={staff}
      cancelHref={
        clientId ? `/dashboard/klanten/${clientId}` : companyId ? `/dashboard/leads/${companyId}` : "/dashboard/vacatures"
      }
      submitLabel="Vacature toevoegen"
    />
  );
}
