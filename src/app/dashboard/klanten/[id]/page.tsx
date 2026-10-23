import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink, Pencil, Plus } from "lucide-react";
import { EntityExtras } from "@/components/entity/entity-extras";
import { PageHeader } from "@/components/dashboard/page-header";
import { ConfirmDeleteButton } from "@/components/clients/confirm-delete-button";
import { ContactsCard } from "@/components/clients/contacts-card";
import { DaysOpen } from "@/components/vacancies/days-open";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader, DetailList } from "@/components/ui/card";
import { ListSkeleton, Skeleton } from "@/components/ui/skeleton";
import {
  getClient,
  getClientContacts,
  getClientPlacements,
  getClientVacancies,
  type ClientPlacementItem,
  type ClientVacancyItem,
} from "@/lib/data/clients";
import { formatDate } from "@/lib/format";
import { clientStatuses, optionFor, placementStatuses, vacancyStatuses } from "@/lib/labels";
import { deleteClientAction, deleteContactAction, saveContactAction } from "../actions";

export const metadata: Metadata = {
  title: "Klant",
};

type Params = Promise<{ id: string }>;

export default function Page({ params }: PageProps<"/dashboard/klanten/[id]">) {
  return (
    <>
      <Link
        href="/dashboard/klanten"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-brand-700"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Alle klanten
      </Link>
      <Suspense fallback={<DetailSkeleton />}>
        <ClientDetail params={params} />
      </Suspense>
    </>
  );
}

async function ClientDetail({ params }: { params: Params }) {
  const { id } = await params;
  const client = await getClient(id);
  if (!client) notFound();

  const [contacts, vacancies, placements] = await Promise.all([
    getClientContacts(client.id),
    getClientVacancies(client.id),
    getClientPlacements(client.id),
  ]);
  const status = optionFor(clientStatuses, client.status);

  return (
    <>
      <PageHeader
        eyebrow="Klant"
        title={
          <span className="flex flex-wrap items-center gap-3">
            {client.name}
            <Badge tone={status.tone}>{status.label}</Badge>
          </span>
        }
        description={[client.industry, client.city].filter(Boolean).join(", ") || undefined}
        actions={
          <>
            <ButtonLink href={`/dashboard/klanten/${client.id}/bewerken`} variant="secondary">
              <Pencil aria-hidden="true" />
              Bewerken
            </ButtonLink>
            <ConfirmDeleteButton
              action={deleteClientAction.bind(null, client.id)}
              title="Klant verwijderen"
              description={`Weet je zeker dat je ${client.name} wilt verwijderen? De contactpersonen, vacatures en pipelines van deze klant worden ook verwijderd. Dit kun je niet ongedaan maken.`}
            />
          </>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader title="Gegevens" />
            <CardBody>
              <DetailList
                items={[
                  {
                    label: "Website",
                    value: client.website && /^https?:\/\//i.test(client.website) ? (
                      <a
                        href={client.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-brand-700 hover:underline"
                      >
                        {client.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                        <ExternalLink className="size-3.5" aria-hidden="true" />
                        <span className="sr-only">(opent in een nieuw tabblad)</span>
                      </a>
                    ) : (
                      client.website
                    ),
                  },
                  { label: "Branche", value: client.industry },
                  { label: "Plaats", value: client.city },
                  {
                    label: "Eigenaar",
                    value: client.owner ? client.owner.full_name || client.owner.email : null,
                  },
                  { label: "Klant sinds", value: formatDate(client.created_at) },
                ]}
              />
              {client.notes && (
                <div className="mt-6 border-t border-border pt-4">
                  <h3 className="text-xs font-medium tracking-wide text-muted uppercase">Notities</h3>
                  <p className="mt-1 text-sm whitespace-pre-line text-ink">{client.notes}</p>
                </div>
              )}
            </CardBody>
          </Card>

          <VacanciesCard clientId={client.id} vacancies={vacancies} />
          <PlacementsCard placements={placements} />
        </div>

        <div className="min-w-0 space-y-6">
          <ContactsCard
            contacts={contacts}
            saveAction={saveContactAction.bind(null, client.id)}
            deleteAction={deleteContactAction.bind(null, client.id)}
          />
          <Suspense fallback={<ListSkeleton rows={3} />}>
            <EntityExtras entityType="client" entityId={client.id} />
          </Suspense>
        </div>
      </div>
    </>
  );
}

function VacanciesCard({ clientId, vacancies }: { clientId: string; vacancies: ClientVacancyItem[] }) {
  return (
    <Card>
      <CardHeader
        title="Vacatures"
        description="Alle functieprofielen van deze klant."
        actions={
          <ButtonLink href={`/dashboard/vacatures/nieuw?client=${clientId}`} variant="secondary" size="sm">
            <Plus aria-hidden="true" />
            Nieuwe vacature
          </ButtonLink>
        }
      />
      {vacancies.length === 0 ? (
        <CardBody>
          <p className="text-sm text-muted">Nog geen vacatures voor deze klant.</p>
        </CardBody>
      ) : (
        <ul className="divide-y divide-border">
          {vacancies.map((v) => {
            const status = optionFor(vacancyStatuses, v.status);
            return (
              <li key={v.id} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <Link
                    href={`/dashboard/vacatures/${v.id}`}
                    className="font-medium text-brand-800 hover:underline"
                  >
                    {v.title}
                  </Link>
                  <p className="text-xs text-muted">Geopend op {formatDate(v.openedAt)}</p>
                </div>
                <div className="flex shrink-0 items-center gap-3 text-sm">
                  <Badge tone={status.tone}>{status.label}</Badge>
                  <DaysOpen days={v.daysOpen} status={v.status} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function PlacementsCard({ placements }: { placements: ClientPlacementItem[] }) {
  return (
    <Card>
      <CardHeader title="Plaatsingen" description="Developers die via Nordavo bij deze klant werken." />
      {placements.length === 0 ? (
        <CardBody>
          <p className="text-sm text-muted">Nog geen plaatsingen bij deze klant.</p>
        </CardBody>
      ) : (
        <ul className="divide-y divide-border">
          {placements.map((p) => {
            const status = optionFor(placementStatuses, p.status);
            return (
              <li key={p.id} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <Link
                    href={`/dashboard/plaatsingen/${p.id}`}
                    className="font-medium text-brand-800 hover:underline"
                  >
                    {p.candidateName}
                  </Link>
                  <p className="text-xs text-muted">
                    {p.vacancyTitle ? `${p.vacancyTitle}, ` : ""}start {formatDate(p.startDate)}
                  </p>
                </div>
                <Badge tone={status.tone}>{status.label}</Badge>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function DetailSkeleton() {
  return (
    <div aria-busy="true" aria-label="Laden">
      <div className="mb-8 space-y-3">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-8 w-72 max-w-full" />
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <ListSkeleton rows={6} />
        <ListSkeleton rows={3} />
      </div>
    </div>
  );
}
