import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getPlacement, getPlacementFormOptions } from "@/lib/data/placements";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PlacementForm } from "@/components/placements/placement-form";
import { updatePlacement } from "../../actions";

export const metadata: Metadata = {
  title: "Plaatsing bewerken",
};

type Params = Promise<{ id: string }>;

export default function Page({ params }: { params: Params }) {
  return (
    <>
      <PageHeader eyebrow="Plaatsingen" title="Plaatsing bewerken" />
      <Card className="max-w-3xl">
        <CardBody className="py-6">
          <Suspense fallback={<Skeleton className="h-96 w-full" />}>
            <EditPlacement params={params} />
          </Suspense>
        </CardBody>
      </Card>
    </>
  );
}

async function EditPlacement({ params }: { params: Params }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const [placement, options] = await Promise.all([getPlacement(id), getPlacementFormOptions()]);
  if (!placement) notFound();

  return (
    <PlacementForm
      action={updatePlacement.bind(null, placement.id)}
      mode="edit"
      options={options}
      locked={Boolean(placement.application_id)}
      defaults={{
        client_id: placement.client_id,
        candidate_id: placement.candidate_id,
        vacancy_id: placement.vacancy_id,
        start_date: placement.start_date,
        end_date: placement.end_date,
        monthly_rate: placement.monthly_rate,
        next_checkin_at: placement.next_checkin_at,
        notes: placement.notes,
      }}
      cancelHref={`/dashboard/plaatsingen/${placement.id}`}
    />
  );
}
