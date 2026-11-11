import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";
import { EntityExtras } from "@/components/entity/entity-extras";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Briefcase, ExternalLink, ShieldAlert, TriangleAlert } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import {
  IcpBadge,
  OutcomeBadge,
  SegmentBadge,
  SignalTypeBadge,
} from "@/components/leads/badges";
import { AddContactButton } from "@/components/leads/add-contact-button";
import { LeadSalesPanel } from "@/components/sales/lead-sales-panel";
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
import { activityChannels, optionFor, suppressionReasons, suppressionScopes } from "@/lib/labels";
import {
  linkClientAction,
  logActivityAction,
  suppressAction,
  updateCompanyAction,
} from "../actions";
import { createContactAction } from "../manual-actions";
import { createClient } from "@/lib/supabase/server";
import { leadStatuses, pipelineStages } from "@/lib/sales/labels";
import { describeChange } from "@/lib/sales/timeline";

export const metadata: Metadata = {
  title: "Lead",
};

type Params = Promise<{ id: string }>;

export default function Page({ params }: PageProps<"/dashboard/leads/[id]">) {
  return (
    <>
      <Link
        href="/dashboard/leads"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-brand-700 max-md:-mt-2 max-md:mb-2 max-md:min-h-11 max-md:active:text-brand-700"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        All leads
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

  const supabase = await createClient();
  const [{ contacts, suppressions }, signals, clients, owners, partners] = await Promise.all([
    getCompanyContacts(company.id),
    getCompanySignals(company.id),
    company.client_id ? Promise.resolve([]) : listClientOptions(),
    supabase.from("profiles").select("id, full_name, email").in("role", ["admin", "member"]).order("full_name"),
    supabase.from("partners").select("id, name, company_name").order("name"),
  ]);
  const activities = await getCompanyActivities(
    company.id,
    contacts.map((c) => c.id),
  );

  const websiteHref =
    company.website && /^https?:\/\//i.test(company.website) ? company.website : `https://${company.domain}`;
  const contactOptions = contacts.map((c) => ({ id: c.id, name: c.title ? `${c.name}, ${c.title}` : c.name }));

  return (
    <>
      <PageHeader
        eyebrow="Lead"
        title={
          <span className="flex flex-wrap items-center gap-3">
            {company.name}
            <IcpBadge decision={company.icp_decision} score={company.icp_score} />
            <Badge tone={optionFor(leadStatuses, company.lead_status).tone}>{optionFor(leadStatuses, company.lead_status).label}</Badge>
            {company.pipeline_stage && (
              <Badge tone={optionFor(pipelineStages, company.pipeline_stage).tone}>
                Pipeline: {optionFor(pipelineStages, company.pipeline_stage).label}
              </Badge>
            )}
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
              <span className="sr-only">(opens in a new tab)</span>
            </a>
            <SegmentBadge segment={company.segment} />
          </span>
        }
        actions={
          <>
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
            <ButtonLink href={`/dashboard/vacancies/new?company=${company.id}`}>
              <Briefcase aria-hidden="true" />
              Add vacancy
            </ButtonLink>
          </>
        }
      />

      {/* Below lg both columns dissolve into one list, so the contacts (to call or mail) come right after the verdict. */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0 space-y-6 max-lg:contents max-lg:space-y-0">
          <LeadSalesPanel
            company={{
              id: company.id,
              lead_status: company.lead_status,
              pipeline_stage: company.pipeline_stage,
              lost_reason: company.lost_reason,
              parked_until: company.parked_until,
              profiles_due_on: company.profiles_due_on,
              prio: company.prio,
              category: company.category,
              owner_id: company.owner_id,
              partner_id: company.partner_id,
              next_action: company.next_action,
              next_action_date: company.next_action_date,
              description: company.description,
              general_phone: company.general_phone,
              opening_line: company.opening_line,
              red_flags: company.red_flags,
              source_note: company.source_note,
            }}
            contacts={contacts.map((c) => ({ id: c.id, name: c.title ? `${c.name}, ${c.title}` : c.name }))}
            owners={(owners.data ?? []).map((p) => ({ id: p.id, name: p.full_name || p.email || "Unnamed" }))}
            partners={(partners.data ?? []).map((p) => ({ id: p.id, name: p.company_name ? `${p.name} (${p.company_name})` : p.name }))}
            primaryContactId={contacts.find((c) => c.isPrimary)?.id ?? null}
          />
          <Card>
            <CardHeader
              title="ICP verdict"
              description={
                company.qualified_at
                  ? `Assessed on ${formatDate(company.qualified_at)}${
                      company.reviewer ? ` by ${company.reviewer.full_name || company.reviewer.email}` : " by Claude"
                    }`
                  : "Not assessed yet."
              }
              actions={
                company.icp_decision === "REVIEW" ? (
                  <ButtonLink href={`/dashboard/leads/review?id=${company.id}`} size="sm">
                    Review
                  </ButtonLink>
                ) : undefined
              }
            />
            <CardBody className="space-y-5">
              {company.client_contact_risk && (
                <p className="flex items-start gap-2 rounded-xl border border-danger/20 bg-danger-bg px-4 py-3 text-sm text-danger">
                  <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  Client contact risk: the developer would work directly with the client&rsquo;s own customers. That is always a No go.
                </p>
              )}
              <div>
                <h3 className="text-xs font-medium tracking-wide text-muted uppercase">Reason</h3>
                <p className="mt-1 text-sm whitespace-pre-line text-ink">{company.icp_reason || "No reason recorded."}</p>
              </div>
              {company.red_flags.length > 0 && (
                <div>
                  <h3 className="text-xs font-medium tracking-wide text-muted uppercase">Red flags</h3>
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
                  <h3 className="text-xs font-medium tracking-wide text-muted uppercase">Opening line</h3>
                  <p className="mt-1 text-sm text-ink italic">{company.opening_line}</p>
                </div>
              )}
              <div className="border-t border-border pt-4">
                <DetailList
                  items={[
                    { label: "Legal form", value: company.legal_form },
                    { label: "Employees", value: company.employees },
                    { label: "Sector", value: company.sector },
                    { label: "Location", value: company.city },
                    { label: "KvK number", value: company.kvk_number },
                    {
                      label: "LinkedIn",
                      value: company.linkedin_url ? (
                        <a
                          href={/^https?:\/\//i.test(company.linkedin_url) ? company.linkedin_url : `https://${company.linkedin_url}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="break-all text-brand-700 hover:underline"
                        >
                          Company page
                          <span className="sr-only">(opens in a new tab)</span>
                        </a>
                      ) : null,
                    },
                    {
                      label: "Sources",
                      value: company.sources.length > 0 ? company.sources.join(", ") : company.source,
                    },
                    { label: "In the system since", value: formatDate(company.created_at) },
                  ]}
                />
              </div>
            </CardBody>
          </Card>

          <div className="min-w-0 max-lg:order-2">
            <SignalsCard signals={signals} />
          </div>

          <div className="min-w-0 max-lg:order-3">
            <ActivitiesCard
            activities={activities}
              actions={<LogActivityButton contacts={contactOptions} action={logActivityAction.bind(null, company.id)} />}
            />
          </div>
        </div>

        <div className="min-w-0 space-y-6 max-lg:contents max-lg:space-y-0">
          <div className="min-w-0 max-lg:order-1">
            <ContactsPanel
              contacts={contacts}
              actions={
                <AddContactButton companyName={company.name} action={createContactAction.bind(null, company.id)} />
              }
            />
          </div>

          <Card className="max-lg:order-4">
            <CardHeader
              title="Client"
              description={company.client ? undefined : "Has this company become a client? Link it to a client record."}
            />
            <CardBody>
              {company.client ? (
                <p className="text-sm">
                  Linked to{" "}
                  <Link href={`/dashboard/clients/${company.client.id}`} className="font-medium text-brand-700 hover:underline">
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

          <div className="min-w-0 max-lg:order-5">
            <SuppressionCard
              suppressions={suppressions}
              contacts={contacts}
              actions={<SuppressButton contacts={contactOptions} action={suppressAction.bind(null, company.id)} />}
            />
          </div>

          <div className="min-w-0 max-lg:order-6">
            <Suspense fallback={<Skeleton className="h-64 w-full" />}>
              <EntityExtras entityType="company" entityId={company.id} />
            </Suspense>
          </div>
        </div>
      </div>
    </>
  );
}

function SignalsCard({ signals }: { signals: SignalItem[] }) {
  return (
    <Card>
      <CardHeader title="Signals" description="Vacancies and other buying signals, newest first." />
      {signals.length === 0 ? (
        <CardBody>
          <p className="text-sm text-muted">No signals for this company yet.</p>
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
                    {s.title || "View source"}
                    <ExternalLink className="size-3.5 shrink-0" aria-hidden="true" />
                    <span className="sr-only">(opens in a new tab)</span>
                  </a>
                ) : (
                  <p className="text-sm font-medium">{s.title || "Untitled"}</p>
                )}
              </div>
              <p className="shrink-0 text-xs text-muted">
                First seen {formatDate(s.firstSeenAt)}
                <br className="hidden sm:block" />
                <span className="sm:hidden">, </span>
                last seen {formatDate(s.lastSeenAt)}
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
      <CardHeader title="Timeline" description="Every contact moment and every change, newest first." actions={actions} />
      {activities.length === 0 ? (
        <CardBody>
          <p className="text-sm text-muted">Nobody at this company has been approached yet.</p>
        </CardBody>
      ) : (
        <ol className="divide-y divide-border">
          {activities.map((a) => {
            const channel = optionFor(activityChannels, a.channel);
            if (a.type === "change" || a.type === "view") {
              return (
                <li key={a.id} className="flex flex-wrap items-baseline gap-x-2 px-5 py-2 text-xs text-muted">
                  <span className="text-ink">
                    {a.type === "view" ? "Opened on the call screen" : describeChange(a.field, a.oldValue, a.newValue)}
                  </span>
                  {a.contactName && <span>{a.contactName}</span>}
                  <span>
                    {formatDateTime(a.date)}
                    {a.createdByName ? `, ${a.createdByName}` : ""}
                    {a.source !== "handmatig" ? `, via ${a.source}` : ""}
                  </span>
                </li>
              );
            }
            return (
              <li key={a.id} className="space-y-1.5 px-5 py-3">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge tone={channel.tone}>{channel.label}</Badge>
                  {a.outcome && <OutcomeBadge outcome={a.outcome} />}
                  {a.contactName && <span className="font-medium text-ink">{a.contactName}</span>}
                  <span className="text-xs text-muted">{formatDateTime(a.date)}</span>
                </div>
                {a.campaignName && <p className="text-xs text-muted">Campaign: {a.campaignName}</p>}
                {a.notes && <p className="text-sm whitespace-pre-line text-ink">{a.notes}</p>}
                {a.nextAction && (
                  <p className="text-sm text-muted">
                    <span className="font-medium text-ink">Next action:</span> {a.nextAction}
                    {a.nextActionDate ? ` on ${formatDate(a.nextActionDate)}` : ""}
                  </p>
                )}
                <p className="text-xs text-muted">
                  {a.source === "handmatig" ? `Manual${a.createdByName ? ` by ${a.createdByName}` : ""}` : `Via ${a.source}`}
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
    if (s.companyId) return "Whole company";
    return s.email ?? "Email address";
  };
  return (
    <Card>
      <CardHeader title="Suppressions" actions={actions} />
      {suppressions.length === 0 ? (
        <CardBody>
          <p className="text-sm text-muted">Nobody at this company is suppressed.</p>
        </CardBody>
      ) : (
        <ul className="divide-y divide-border">
          {suppressions.map((s) => {
            const reason = optionFor(suppressionReasons, s.reason);
            const scope = optionFor(suppressionScopes, s.scope);
            return (
              <li key={s.id} className="space-y-1 px-5 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 font-medium break-all text-ink">{nameFor(s)}</span>
                  <Badge tone={reason.tone}>{reason.label}</Badge>
                  <Badge tone={scope.tone}>{scope.label}</Badge>
                </div>
                {s.notes && <p className="text-muted">{s.notes}</p>}
                <p className="text-xs text-muted">Since {formatDate(s.createdAt)}</p>
              </li>
            );
          })}
        </ul>
      )}
      <CardBody className="border-t border-border">
        <Link href="/dashboard/suppressions" className="text-sm font-medium text-brand-700 hover:underline">
          All suppressions
        </Link>
      </CardBody>
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
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <ListSkeleton rows={8} />
        <ListSkeleton rows={5} />
      </div>
    </div>
  );
}
