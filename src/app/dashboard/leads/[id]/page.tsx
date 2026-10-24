import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";
import { EntityExtras } from "@/components/entity/entity-extras";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Briefcase, ExternalLink, ShieldAlert, TriangleAlert } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import {
  CompanyStatusBadge,
  IcpBadge,
  OutcomeBadge,
  SegmentBadge,
  SignalTypeBadge,
} from "@/components/leads/badges";
import { ContactsPanel } from "@/components/leads/contacts-panel";
import {
  EditCompanyButton,
  LinkClientButton,
  LogActivityButton,
  SuppressButton,
} from "@/components/leads/lead-forms";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader, DetailList } from "@/components/ui/card";
import { ListSkeleton, Skeleton } from "@/components/ui/skeleton";
import { getCompanyActivities, type GtmActivityItem } from "@/lib/data/activities";
import { listClientOptions } from "@/lib/data/clients";
import { getCompany, getCompanySignals, type SignalItem, type SuppressionItem } from "@/lib/data/companies";
import { getCompanyContacts, type CompanyContact } from "@/lib/data/gtm-contacts";
import { formatDate, formatDateTime } from "@/lib/format";
import { hasOnePage } from "@/lib/integrations/onepage";
import { activityChannels, optionFor, suppressionReasons, suppressionScopes } from "@/lib/labels";
import {
  linkClientAction,
  logActivityAction,
  pushToCrmAction,
  suppressAction,
  updateCompanyAction,
} from "../actions";

export const metadata: Metadata = {
  title: "Lead",
};

type Params = Promise<{ id: string }>;

export default function Page({ params }: PageProps<"/dashboard/leads/[id]">) {
  return (
    <>
      <Link
        href="/dashboard/leads"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-brand-700"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Alle leads
      </Link>
      <Suspense fallback={<DetailSkeleton />}>
        <LeadDetail params={params} />
      </Suspense>
    </>
  );
}

async function LeadDetail({ params }: { params: Params }) {
  const { id } = await params;
  const company = await getCompany(id);
  if (!company) notFound();

  const [{ contacts, suppressions }, signals, clients] = await Promise.all([
    getCompanyContacts(company.id),
    getCompanySignals(company.id),
    company.client_id ? Promise.resolve([]) : listClientOptions(),
  ]);
  const activities = await getCompanyActivities(
    company.id,
    contacts.map((c) => c.id),
  );

  const websiteHref =
    company.website && /^https?:\/\//i.test(company.website) ? company.website : `https://${company.domain}`;
  const contactOptions = contacts.map((c) => ({ id: c.id, name: c.title ? `${c.name}, ${c.title}` : c.name }));
  const crmBlockedReason = !hasOnePage()
    ? "OnePageCRM is nog niet gekoppeld: ONEPAGE_USER_ID en ONEPAGE_API_KEY ontbreken op de server. Versturen lukt pas als die er zijn."
    : company.icp_decision !== "GO"
      ? "Alleen contacten van een GO bedrijf gaan naar het CRM. Dit bedrijf is nog niet gekwalificeerd."
      : null;

  return (
    <>
      <PageHeader
        eyebrow="Lead"
        title={
          <span className="flex flex-wrap items-center gap-3">
            {company.name}
            <IcpBadge decision={company.icp_decision} score={company.icp_score} />
            <CompanyStatusBadge status={company.status} />
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-3">
            <a
              href={websiteHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-brand-700 hover:underline"
            >
              {company.domain}
              <ExternalLink className="size-3.5" aria-hidden="true" />
              <span className="sr-only">(opent in een nieuw tabblad)</span>
            </a>
            <SegmentBadge segment={company.segment} />
          </span>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <EditCompanyButton
              company={{
                name: company.name,
                legalForm: company.legal_form,
                employees: company.employees,
                sector: company.sector,
                city: company.city,
                segment: company.segment,
                status: company.status,
                kvkNumber: company.kvk_number,
                linkedinUrl: company.linkedin_url,
              }}
              action={updateCompanyAction.bind(null, company.id)}
            />
            <ButtonLink href={`/dashboard/vacatures/nieuw?company=${company.id}`}>
              <Briefcase aria-hidden="true" />
              Vacature toevoegen
            </ButtonLink>
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader
              title="ICP oordeel"
              description={
                company.qualified_at
                  ? `Beoordeeld op ${formatDate(company.qualified_at)}${
                      company.reviewer ? ` door ${company.reviewer.full_name || company.reviewer.email}` : " door Claude"
                    }`
                  : "Nog niet beoordeeld."
              }
              actions={
                company.icp_decision === "REVIEW" ? (
                  <ButtonLink href={`/dashboard/leads/review?id=${company.id}`} size="sm">
                    Beoordelen
                  </ButtonLink>
                ) : undefined
              }
            />
            <CardBody className="space-y-5">
              {company.client_contact_risk && (
                <p className="flex items-start gap-2 rounded-xl border border-danger/20 bg-danger-bg px-4 py-3 text-sm text-danger">
                  <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  Risico op klantcontact: de developer zou direct met klanten van de klant werken. Daarom altijd No go.
                </p>
              )}
              <div>
                <h3 className="text-xs font-medium tracking-wide text-muted uppercase">Reden</h3>
                <p className="mt-1 text-sm whitespace-pre-line text-ink">{company.icp_reason || "Geen reden vastgelegd."}</p>
              </div>
              {company.red_flags.length > 0 && (
                <div>
                  <h3 className="text-xs font-medium tracking-wide text-muted uppercase">Rode vlaggen</h3>
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {company.red_flags.map((flag) => (
                      <li key={flag}>
                        <Badge tone="danger">
                          <TriangleAlert className="size-3" aria-hidden="true" />
                          {flag}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {company.opening_line && (
                <div>
                  <h3 className="text-xs font-medium tracking-wide text-muted uppercase">Openingszin</h3>
                  <p className="mt-1 text-sm text-ink italic">{company.opening_line}</p>
                </div>
              )}
              <div className="border-t border-border pt-4">
                <DetailList
                  items={[
                    { label: "Rechtsvorm", value: company.legal_form },
                    { label: "Medewerkers", value: company.employees },
                    { label: "Sector", value: company.sector },
                    { label: "Plaats", value: company.city },
                    { label: "KvK-nummer", value: company.kvk_number },
                    {
                      label: "LinkedIn",
                      value: company.linkedin_url ? (
                        <a
                          href={/^https?:\/\//i.test(company.linkedin_url) ? company.linkedin_url : `https://${company.linkedin_url}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="break-all text-brand-700 hover:underline"
                        >
                          Bedrijfspagina
                          <span className="sr-only">(opent in een nieuw tabblad)</span>
                        </a>
                      ) : null,
                    },
                    {
                      label: "Bronnen",
                      value: company.sources.length > 0 ? company.sources.join(", ") : company.source,
                    },
                    { label: "In het systeem sinds", value: formatDate(company.created_at) },
                  ]}
                />
              </div>
            </CardBody>
          </Card>

          <SignalsCard signals={signals} />

          <ActivitiesCard
            activities={activities}
            actions={<LogActivityButton contacts={contactOptions} action={logActivityAction.bind(null, company.id)} />}
          />
        </div>

        <div className="min-w-0 space-y-6">
          <ContactsPanel
            contacts={contacts}
            crmActionFor={(contactId) => pushToCrmAction.bind(null, company.id, contactId)}
            crmBlockedReason={crmBlockedReason}
          />

          <Card>
            <CardHeader
              title="Klant"
              description={company.client ? undefined : "Is dit bedrijf klant geworden? Koppel het aan een klantrecord."}
            />
            <CardBody>
              {company.client ? (
                <p className="text-sm">
                  Gekoppeld aan{" "}
                  <Link href={`/dashboard/klanten/${company.client.id}`} className="font-medium text-brand-700 hover:underline">
                    {company.client.name}
                  </Link>
                  .
                </p>
              ) : (
                <LinkClientButton
                  clients={clients}
                  defaultName={company.name}
                  action={linkClientAction.bind(null, company.id)}
                />
              )}
            </CardBody>
          </Card>

          <SuppressionCard
            suppressions={suppressions}
            contacts={contacts}
            actions={<SuppressButton contacts={contactOptions} action={suppressAction.bind(null, company.id)} />}
          />

          <Suspense fallback={<Skeleton className="h-64 w-full" />}>
            <EntityExtras entityType="company" entityId={company.id} />
          </Suspense>
        </div>
      </div>
    </>
  );
}

function SignalsCard({ signals }: { signals: SignalItem[] }) {
  return (
    <Card>
      <CardHeader title="Signalen" description="Vacatures en andere koopsignalen, nieuwste eerst." />
      {signals.length === 0 ? (
        <CardBody>
          <p className="text-sm text-muted">Nog geen signalen bij dit bedrijf.</p>
        </CardBody>
      ) : (
        <ol className="divide-y divide-border">
          {signals.map((s) => (
            <li key={s.id} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <SignalTypeBadge type={s.type} />
                  <span className="text-xs text-muted capitalize">{s.source}</span>
                </div>
                {s.sourceUrl ? (
                  <a
                    href={s.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline"
                  >
                    {s.title || "Bekijk bron"}
                    <ExternalLink className="size-3.5 shrink-0" aria-hidden="true" />
                    <span className="sr-only">(opent in een nieuw tabblad)</span>
                  </a>
                ) : (
                  <p className="text-sm font-medium">{s.title || "Zonder titel"}</p>
                )}
              </div>
              <p className="shrink-0 text-xs text-muted">
                Eerst gezien {formatDate(s.firstSeenAt)}
                <br className="hidden sm:block" />
                <span className="sm:hidden">, </span>
                laatst {formatDate(s.lastSeenAt)}
              </p>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

function ActivitiesCard({ activities, actions }: { activities: GtmActivityItem[]; actions: ReactNode }) {
  return (
    <Card>
      <CardHeader title="Activiteiten" description="Alle contactmomenten, over alle kanalen." actions={actions} />
      {activities.length === 0 ? (
        <CardBody>
          <p className="text-sm text-muted">Nog niemand van dit bedrijf benaderd.</p>
        </CardBody>
      ) : (
        <ol className="divide-y divide-border">
          {activities.map((a) => {
            const channel = optionFor(activityChannels, a.channel);
            return (
              <li key={a.id} className="space-y-1.5 px-5 py-3">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge tone={channel.tone}>{channel.label}</Badge>
                  <OutcomeBadge outcome={a.outcome} />
                  {a.contactName && <span className="font-medium text-ink">{a.contactName}</span>}
                  <span className="text-xs text-muted">{formatDateTime(a.date)}</span>
                </div>
                {a.campaignName && <p className="text-xs text-muted">Campagne: {a.campaignName}</p>}
                {a.notes && <p className="text-sm whitespace-pre-line text-ink">{a.notes}</p>}
                {a.nextAction && (
                  <p className="text-sm text-muted">
                    <span className="font-medium text-ink">Volgende actie:</span> {a.nextAction}
                    {a.nextActionDate ? ` op ${formatDate(a.nextActionDate)}` : ""}
                  </p>
                )}
                <p className="text-xs text-muted">
                  {a.source === "handmatig" ? `Handmatig${a.createdByName ? ` door ${a.createdByName}` : ""}` : `Via ${a.source}`}
                </p>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}

function SuppressionCard({
  suppressions,
  contacts,
  actions,
}: {
  suppressions: SuppressionItem[];
  contacts: CompanyContact[];
  actions: ReactNode;
}) {
  const nameFor = (s: SuppressionItem) => {
    if (s.contactId) return contacts.find((c) => c.id === s.contactId)?.name ?? "Contact";
    if (s.companyId) return "Hele bedrijf";
    return s.email ?? "Mailadres";
  };
  return (
    <Card>
      <CardHeader title="Uitsluitingen" actions={actions} />
      {suppressions.length === 0 ? (
        <CardBody>
          <p className="text-sm text-muted">Niemand van dit bedrijf is uitgesloten.</p>
        </CardBody>
      ) : (
        <ul className="divide-y divide-border">
          {suppressions.map((s) => {
            const reason = optionFor(suppressionReasons, s.reason);
            const scope = optionFor(suppressionScopes, s.scope);
            return (
              <li key={s.id} className="space-y-1 px-5 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-ink">{nameFor(s)}</span>
                  <Badge tone={reason.tone}>{reason.label}</Badge>
                  <Badge tone={scope.tone}>{scope.label}</Badge>
                </div>
                {s.notes && <p className="text-muted">{s.notes}</p>}
                <p className="text-xs text-muted">Sinds {formatDate(s.createdAt)}</p>
              </li>
            );
          })}
        </ul>
      )}
      <CardBody className="border-t border-border">
        <Link href="/dashboard/uitsluitingen" className="text-sm font-medium text-brand-700 hover:underline">
          Alle uitsluitingen
        </Link>
      </CardBody>
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
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <ListSkeleton rows={8} />
        <ListSkeleton rows={5} />
      </div>
    </div>
  );
}
