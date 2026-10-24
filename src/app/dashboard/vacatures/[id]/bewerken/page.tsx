import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/dashboard/page-header";
import { VacancyForm } from "@/components/vacancies/vacancy-form";
import { Card, CardBody } from "@/components/ui/card";
import { ListSkeleton } from "@/components/ui/skeleton";
import { listClientOptions, listStaffOptions } from "@/lib/data/clients";
import { getVacancy, listCompanyOptions } from "@/lib/data/vacancies";
import { updateVacancyAction } from "../../actions";

export const metadata: Metadata = {
  title: "Vacature bewerken",
};

export default function Page({ params }: PageProps<"/dashboard/vacatures/[id]/bewerken">) {
  return (
    <>
      <PageHeader eyebrow="Vacatures" title="Vacature bewerken" />
      <Card className="max-w-3xl">
        <CardBody className="py-6">
          <Suspense fallback={<ListSkeleton rows={5} />}>
            <EditVacancyForm params={params} />
          </Suspense>
        </CardBody>
      </Card>
    </>
  );
}

async function EditVacancyForm({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const vacancy = await getVacancy(id);
  if (!vacancy) notFound();
  const [clients, companies, staff] = await Promise.all([
    listClientOptions(),
    listCompanyOptions(vacancy.company_id),
    listStaffOptions(),
  ]);

  return (
    <VacancyForm
      action={updateVacancyAction.bind(null, vacancy.id)}
      defaults={{
        client_id: vacancy.client_id ?? undefined,
        company_id: vacancy.company_id ?? undefined,
        talent_stage: vacancy.talent_stage,
        source: vacancy.source,
        onepage_deal_id: vacancy.onepage_deal_id,
        hours: vacancy.hours,
        timezone_overlap: vacancy.timezone_overlap,
        budget_min: vacancy.budget_min,
        budget_max: vacancy.budget_max,
        client_contact_required: vacancy.client_contact_required,
        must_haves: vacancy.must_haves,
        nice_to_haves: vacancy.nice_to_haves,
        unclear: vacancy.unclear,
        title: vacancy.title,
        description: vacancy.description,
        stack: vacancy.stack,
        seniority: vacancy.seniority,
        status: vacancy.status,
        monthly_budget: vacancy.monthly_budget,
        desired_start_date: vacancy.desired_start_date,
        owner_id: vacancy.owner_id,
      }}
      clients={clients}
      companies={companies}
      staff={staff}
      cancelHref={`/dashboard/vacatures/${vacancy.id}`}
      submitLabel="Wijzigingen opslaan"
    />
  );
}
