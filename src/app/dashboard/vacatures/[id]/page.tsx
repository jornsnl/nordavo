import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Building2, Pencil } from "lucide-react";
import { EntityExtras } from "@/components/entity/entity-extras";
import { PageHeader } from "@/components/dashboard/page-header";
import { ConfirmDeleteButton } from "@/components/clients/confirm-delete-button";
import { DaysOpen } from "@/components/vacancies/days-open";
import { PipelineSummary } from "@/components/vacancies/pipeline-summary";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader, DetailList } from "@/components/ui/card";
import { ListSkeleton, Skeleton } from "@/components/ui/skeleton";
import { getVacancy, getVacancyPipelineSummary, PRESENTED_TARGET } from "@/lib/data/vacancies";
import { formatCurrency, formatDate } from "@/lib/format";
import { optionFor, seniorities, vacancyStatuses } from "@/lib/labels";
import { deleteVacancyAction } from "../actions";

export const metadata: Metadata = {
  title: "Vacature",
};

type Params = Promise<{ id: string }>;

export default function Page({ params }: PageProps<"/dashboard/vacatures/[id]">) {
  return (
    <>
      <Link
        href="/dashboard/vacatures"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-brand-700"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Alle vacatures
      </Link>
      <Suspense fallback={<DetailSkeleton />}>
        <VacancyDetail params={params} />
      </Suspense>
    </>
  );
}

async function VacancyDetail({ params }: { params: Params }) {
  const { id } = await params;
  const vacancy = await getVacancy(id);
  if (!vacancy) notFound();

  const summary = await getVacancyPipelineSummary(vacancy.id);
  const status = optionFor(vacancyStatuses, vacancy.status);
  const seniority = optionFor(seniorities, vacancy.seniority);

  return (
    <>
      <PageHeader
        eyebrow="Vacature"
        title={
          <span className="flex flex-wrap items-center gap-3">
            {vacancy.title}
            <Badge tone={status.tone}>{status.label}</Badge>
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {vacancy.client && (
              <Link
                href={`/dashboard/klanten/${vacancy.client.id}`}
                className="inline-flex items-center gap-1.5 font-medium text-brand-700 hover:underline"
              >
                <Building2 className="size-4" aria-hidden="true" />
                {vacancy.client.name}
              </Link>
            )}
            <span className="inline-flex items-center gap-1.5 text-sm">
              <span className="text-muted">Open:</span>
              <DaysOpen days={vacancy.daysOpen} status={vacancy.status} showHint />
            </span>
          </span>
        }
        actions={
          <>
            <ButtonLink href={`/dashboard/vacatures/${vacancy.id}/bewerken`} variant="secondary">
              <Pencil aria-hidden="true" />
              Bewerken
            </ButtonLink>
            <ConfirmDeleteButton
              action={deleteVacancyAction.bind(null, vacancy.id)}
              title="Vacature verwijderen"
              description={`Weet je zeker dat je ${vacancy.title} wilt verwijderen? De pipeline met alle kandidaten voor deze vacature verdwijnt ook. Plaatsingen blijven bestaan. Dit kun je niet ongedaan maken.`}
            />
          </>
        }
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-6">
          <PipelineSummary vacancyId={vacancy.id} summary={summary} target={PRESENTED_TARGET} />

          <Card>
            <CardHeader title="Gegevens" />
            <CardBody>
              <DetailList
                items={[
                  { label: "Klant", value: vacancy.client?.name },
                  { label: "Senioriteit", value: seniority.label },
                  { label: "Budget per maand", value: formatCurrency(vacancy.monthly_budget, "Niet ingevuld") },
                  {
                    label: "Gewenste start",
                    value: formatDate(vacancy.desired_start_date, "Niet ingevuld"),
                  },
                  { label: "Geopend op", value: formatDate(vacancy.opened_at) },
                  ...(vacancy.closed_at ? [{ label: "Gesloten op", value: formatDate(vacancy.closed_at) }] : []),
                  {
                    label: "Eigenaar",
                    value: vacancy.owner ? vacancy.owner.full_name || vacancy.owner.email : null,
                  },
                ]}
              />
              <div className="mt-6 border-t border-border pt-4">
                <h3 className="text-xs font-medium tracking-wide text-muted uppercase">Stack</h3>
                {vacancy.stack.length > 0 ? (
                  <ul className="mt-2 flex flex-wrap gap-1.5">
                    {vacancy.stack.map((item, i) => (
                      <li key={`${item}-${i}`}>
                        <Badge tone="brand">{item}</Badge>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-sm text-muted">Nog geen stack ingevuld.</p>
                )}
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Functieprofiel" />
            <CardBody>
              {vacancy.description ? (
                <p className="max-w-prose text-sm leading-relaxed whitespace-pre-line text-ink">
                  {vacancy.description}
                </p>
              ) : (
                <p className="text-sm text-muted">
                  Nog geen functieprofiel. Vraag de klant om een functieomschrijving en zet die hier.
                </p>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="min-w-0 space-y-6">
          <Suspense fallback={<ListSkeleton rows={3} />}>
            <EntityExtras entityType="vacancy" entityId={vacancy.id} />
          </Suspense>
        </div>
      </div>
    </>
  );
}

function DetailSkeleton() {
  return (
    <div aria-busy="true" aria-label="Laden">
      <div className="mb-8 space-y-3">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-8 w-72 max-w-full" />
      </div>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <ListSkeleton rows={6} />
        <ListSkeleton rows={3} />
      </div>
    </div>
  );
}
