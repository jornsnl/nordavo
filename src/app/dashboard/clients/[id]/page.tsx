import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink, Globe, Mail, Pencil, Phone, Plus } from "lucide-react";
import { EntityExtras } from "@/components/entity/entity-extras";
import { QuickActions, telHref, type QuickAction } from "@/components/entity/quick-actions";
import { PageHeader } from "@/components/dashboard/page-header";
import { ConfirmDeleteButton } from "@/components/clients/confirm-delete-button";
import { ContactsCard } from "@/components/clients/contacts-card";
import { RecordLayout } from "@/components/custom-fields/record-layout";
import { getRecordLayout } from "@/lib/custom-fields/data";
import { applyFieldLayout, blockLabel, coreField, findBlock } from "@/lib/custom-fields/layout";
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
  title: "Client",
};

type Params = Promise<{ id: string }>;

export default function Page({ params }: PageProps<"/dashboard/clients/[id]">) {
  return (
    <>
      <Link
        href="/dashboard/clients"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-brand-700 active:text-brand-700 pointer-coarse:mb-2 pointer-coarse:min-h-11"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        All clients
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

  const [contacts, vacancies, placements, layout] = await Promise.all([
    getClientContacts(client.id),
    getClientVacancies(client.id),
    getClientPlacements(client.id),
    getRecordLayout("client"),
  ]);
  const details = findBlock(layout, "details");
  const notesField = coreField(details, "notes", "Notes");
  const status = optionFor(clientStatuses, client.status);
  const websiteUrl = client.website && /^https?:\/\//i.test(client.website) ? client.website : null;

  // Phones: call or mail the first contact straight from the top of the page.
  const primary = contacts[0];
  const quickActions: QuickAction[] = [];
  if (primary?.phone) {
    quickActions.push({ label: "Call", href: telHref(primary.phone), icon: Phone, ariaLabel: `Call ${primary.full_name}` });
  }
  if (primary?.email) {
    quickActions.push({ label: "Email", href: `mailto:${primary.email}`, icon: Mail, ariaLabel: `Email ${primary.full_name}` });
  }
  if (websiteUrl) quickActions.push({ label: "Website", href: websiteUrl, icon: Globe, external: true });

  return (
    <>
      <PageHeader
        eyebrow="Client"
        title={
          <span className="flex flex-wrap items-center gap-3">
            {client.name}
            <Badge tone={status.tone}>{status.label}</Badge>
          </span>
        }
        description={[client.industry, client.city].filter(Boolean).join(", ") || undefined}
        actions={
          <>
            <ButtonLink href={`/dashboard/clients/${client.id}/edit`} variant="secondary">
              <Pencil aria-hidden="true" />
              Edit
            </ButtonLink>
            <ConfirmDeleteButton
              action={deleteClientAction.bind(null, client.id)}
              title="Delete client"
              description={`Are you sure you want to delete ${client.name}? The contacts, vacancies and pipelines of this client are deleted too. This cannot be undone.`}
            />
          </>
        }
      />

      <QuickActions label={`Quick contact with ${client.name}`} actions={quickActions} />

      <RecordLayout
        entity="client"
        recordId={client.id}
        layout={layout}
        blocks={{
          details: (
            <Card>
              <CardHeader title={blockLabel(layout, "details")} />
              <CardBody>
                <DetailList
                  items={applyFieldLayout(details, [
                    {
                      key: "website",
                      label: "Website",
                      value: websiteUrl ? (
                        <a
                          href={websiteUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-brand-700 hover:underline"
                        >
                          {websiteUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                          <ExternalLink className="size-3.5" aria-hidden="true" />
                          <span className="sr-only">(opens in a new tab)</span>
                        </a>
                      ) : (
                        client.website
                      ),
                    },
                    { key: "industry", label: "Industry", value: client.industry },
                    { key: "location", label: "Location", value: client.city },
                    {
                      key: "owner",
                      label: "Owner",
                      value: client.owner ? client.owner.full_name || client.owner.email : null,
                    },
                    { key: "client_since", label: "Client since", value: formatDate(client.created_at) },
                  ])}
                />
                {client.notes && !notesField.hidden && (
                  <div className="mt-6 border-t border-border pt-4">
                    <h3 className="text-xs font-medium tracking-wide text-muted uppercase">{notesField.label}</h3>
                    <p className="mt-1 text-sm whitespace-pre-line text-ink">{client.notes}</p>
                  </div>
                )}
              </CardBody>
            </Card>
          ),
          vacancies: <VacanciesCard clientId={client.id} vacancies={vacancies} title={blockLabel(layout, "vacancies")} />,
          placements: <PlacementsCard placements={placements} title={blockLabel(layout, "placements")} />,
          contacts: (
            <ContactsCard
              contacts={contacts}
              saveAction={saveContactAction.bind(null, client.id)}
              deleteAction={deleteContactAction.bind(null, client.id)}
            />
          ),
          extras: (
            <Suspense fallback={<ListSkeleton rows={3} />}>
              <EntityExtras entityType="client" entityId={client.id} />
            </Suspense>
          ),
        }}
      />
    </>
  );
}

function VacanciesCard({ clientId, vacancies, title }: { clientId: string; vacancies: ClientVacancyItem[]; title: string }) {
  return (
    <Card>
      <CardHeader
        title={title}
        description="All job profiles of this client."
        actions={
          <ButtonLink href={`/dashboard/vacancies/new?client=${clientId}`} variant="secondary" size="sm">
            <Plus aria-hidden="true" />
            New vacancy
          </ButtonLink>
        }
      />
      {vacancies.length === 0 ? (
        <CardBody>
          <p className="text-sm text-muted">No vacancies for this client yet.</p>
        </CardBody>
      ) : (
        <ul className="divide-y divide-border">
          {vacancies.map((v) => {
            const status = optionFor(vacancyStatuses, v.status);
            return (
              <li
                key={v.id}
                className="relative flex flex-col gap-2 px-5 py-3 transition active:bg-brand-50 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  {/* The link covers the row, so the whole row is a tap target. */}
                  <Link
                    href={`/dashboard/vacancies/${v.id}`}
                    className="font-medium text-brand-800 after:absolute after:inset-0 hover:underline"
                  >
                    {v.title}
                  </Link>
                  <p className="text-xs text-muted">Opened on {formatDate(v.openedAt)}</p>
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

function PlacementsCard({ placements, title }: { placements: ClientPlacementItem[]; title: string }) {
  return (
    <Card>
      <CardHeader title={title} description="Developers working at this client through Nordavo." />
      {placements.length === 0 ? (
        <CardBody>
          <p className="text-sm text-muted">No placements at this client yet.</p>
        </CardBody>
      ) : (
        <ul className="divide-y divide-border">
          {placements.map((p) => {
            const status = optionFor(placementStatuses, p.status);
            return (
              <li
                key={p.id}
                className="relative flex flex-col items-start gap-2 px-5 py-3 transition active:bg-brand-50 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <Link
                    href={`/dashboard/placements/${p.id}`}
                    className="font-medium text-brand-800 after:absolute after:inset-0 hover:underline"
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
    <div aria-busy="true" aria-label="Loading">
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
