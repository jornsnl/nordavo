import { employeesBandLabel } from "@/lib/sales/employees";
import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";
import { EntityExtras } from "@/components/entity/entity-extras";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Briefcase, ExternalLink, ShieldCheck, TriangleAlert } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import {
  IcpBadge,
  OutcomeBadge,
  SegmentBadge,
  SignalTypeBadge,
} from "@/components/leads/badges";
import { AddContactButton } from "@/components/leads/add-contact-button";
import { BackToListLink } from "@/components/leads/back-to-list";
import { MergeCompanyButton, MergeContactsButton } from "@/components/leads/merge-buttons";
import { VacancyItem } from "@/components/leads/vacancy-item";
import { LeadSalesPanel } from "@/components/sales/lead-sales-panel";
import { ClientRatesCard } from "@/components/sales/client-rates-card";
import { LeadFlowCard } from "@/components/sales/lead-flow-card";
import { pickable } from "@/lib/sales/choices";
import { loadChoiceLists } from "@/lib/sales/flow-data";
import { CustomFieldsCard } from "@/components/custom-fields/custom-fields-card";
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
import {
  deleteLeadsAction,
  deleteSignalAction,
  setOwnContactAction,
  updateSignalAction,
} from "../edit-actions";
import { DeleteLeadsButton, DeleteSignalButton, EditSignalButton, OwnContactControl } from "@/components/leads/lead-edit-controls";
import { mergeCompaniesAction, mergeContactsAction, searchMergeCompanies } from "../merge-actions";
import { createClient } from "@/lib/supabase/server";
import { leadStatuses, pipelineStages } from "@/lib/sales/labels";
import { describeChange } from "@/lib/sales/timeline";
import { parseRedFlags } from "@/lib/sales/call-brief";
import { formatScore, parseScore, scoreGroup, signalState, type SignalPoint } from "@/lib/sales/score";
import { loadSignalPoints } from "@/lib/sales/score-data";
import { IcpCard } from "@/components/leads/icp-card";
import { AddSignalButton } from "@/components/leads/add-signal-button";
import { addSignalAction } from "../edit-actions";

export const metadata: Metadata = {
  title: "Lead",
};

type Params = Promise<{ id: string }>;

export default function Page({ params }: PageProps<"/dashboard/leads/[id]">) {
  return (
    <>
      {/* Back to the Leads or Contacts table it came from, restored from the browser history at once. */}
      <BackToListLink
        href="/dashboard/leads"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-brand-700 max-md:-mt-2 max-md:mb-2 max-md:min-h-11 max-md:active:text-brand-700"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        All leads
      </BackToListLink>
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
  const [{ contacts, suppressions }, signals, clients, owners, partners, similar, choiceLists, scoreRaw, points, campaigns, groups] = await Promise.all([
    getCompanyContacts(company.id),
    getCompanySignals(company.id),
    company.client_id ? Promise.resolve([]) : listClientOptions(),
    supabase.from("profiles").select("id, full_name, email").in("role", ["admin", "member"]).order("full_name"),
    supabase.from("partners").select("id, name, company_name").order("name"),
    supabase.rpc("sales_similar_companies", { p_name: company.name, p_domain: company.domain, p_exclude: company.id }),
    loadChoiceLists(supabase),
    supabase.rpc("sales_company_score", { p_company: company.id }),
    loadSignalPoints(supabase),
    supabase
      .from("campaign_members")
      .select("id, status, added_at, ended_at, replied_at, reply_outcome, contact_id, campaign:campaigns!campaign_members_campaign_id_fkey(id, name, provider, channel, status)")
      .eq("company_id", company.id)
      .order("added_at", { ascending: false })
      .limit(50),
    supabase.from("sales_score_groups").select("key, label, approach"),
  ]);
  const duplicates = similar.data ?? [];
  const score = parseScore(scoreRaw.data);
  // Before 20 November 2026 everything sat in red_flags as loose pieces: read it back into whole sentences.
  const legacy = parseRedFlags(company.red_flags);
  const legacyTalking = [
    ...legacy.objections.map((o) => [o.objection, o.answer ? `Antwoord: ${o.answer}` : null].filter(Boolean).join(" ")),
    ...legacy.questions,
  ];
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
            {company.own_contact && (
              <Badge tone="brand">
                <ShieldCheck className="size-3" aria-hidden="true" />
                Own contact
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
                domain: company.domain.startsWith("nodomain:") ? "" : company.domain,
                website: company.website,
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
            <MergeCompanyButton
              companyName={company.name}
              duplicates={duplicates}
              search={searchMergeCompanies}
              action={mergeCompaniesAction.bind(null, company.id)}
            />
            <DeleteLeadsButton
              count={1}
              name={company.name}
              action={deleteLeadsAction.bind(null, [company.id])}
              redirectTo="/dashboard/leads"
            />
            <ButtonLink href={`/dashboard/vacancies/new?company=${company.id}`}>
              <Briefcase aria-hidden="true" />
              Add vacancy
            </ButtonLink>
          </>
        }
      />

      {company.own_contact ? (
        <div className="mb-6 flex flex-wrap items-start justify-between gap-3 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-900">
          <p className="flex min-w-0 flex-1 items-start gap-2">
            <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              <span className="font-medium">Own contact{company.own_contact_reason ? `: ${company.own_contact_reason}` : ""}.</span> We have contact with this
              company ourselves, so it never goes into a cold mail campaign, on a call list or in a list Claude makes.
              {" "}Owner: {(owners.data ?? []).find((p) => p.id === company.owner_id)?.full_name ?? (owners.data ?? []).find((p) => p.id === company.owner_id)?.email ?? "nobody yet, pick one under Owner"}.
            </span>
          </p>
          <OwnContactControl ownContact reason={company.own_contact_reason} action={setOwnContactAction.bind(null, company.id)} />
        </div>
      ) : (
        <div className="mb-4 flex justify-end">
          <OwnContactControl ownContact={false} reason={null} action={setOwnContactAction.bind(null, company.id)} />
        </div>
      )}

      {duplicates.length > 0 && (
        <p className="mb-6 flex flex-wrap items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            Possible duplicate of{" "}
            {duplicates.slice(0, 3).map((d, i) => (
              <span key={d.id}>
                {i > 0 && ", "}
                <Link href={`/dashboard/leads/${d.id}`} className="font-medium underline">
                  {d.name}
                </Link>{" "}
                ({d.domain.startsWith("nodomain:") ? "no website" : d.domain}, {d.reason})
              </span>
            ))}
            . Same company? Use Merge to make it one lead.
          </span>
        </p>
      )}

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
              category: company.category,
              recontact_from: company.recontact_from,
              declined_channel: company.declined_channel,
              owner_id: company.owner_id,
              partner_id: company.partner_id,
              next_action: company.next_action,
              next_action_date: company.next_action_date,
              description: company.description,
              general_phone: company.general_phone,
              opening_line: company.opening_line,
              source_note: company.source_note,
            }}
            contacts={contacts.map((c) => ({ id: c.id, name: c.title ? `${c.name}, ${c.title}` : c.name }))}
            owners={(owners.data ?? []).map((p) => ({ id: p.id, name: p.full_name || p.email || "Unnamed" }))}
            partners={(partners.data ?? []).map((p) => ({ id: p.id, name: p.company_name ? `${p.name} (${p.company_name})` : p.name }))}
            primaryContactId={contacts.find((c) => c.isPrimary)?.id ?? null}
            statusOptions={pickable(choiceLists.lead_status, company.lead_status).map((o) => ({ value: o.value, label: o.label, description: o.description }))}
            categoryOptions={pickable(choiceLists.category, company.category)}
          />
          {/* Bucket, occupancy, prio reason, follow and own columns (round 4). */}
          <Suspense fallback={null}>
            <LeadFlowCard companyId={company.id} />
          </Suspense>
          <CustomFieldsCard entity="company" recordId={company.id} />
          <IcpCard
            companyId={company.id}
            decision={company.icp_decision}
            reason={company.icp_reason}
            segment={company.segment}
            score={company.icp_score}
            scoreLine={formatScore(score)}
            talkingPoints={company.talking_points ?? []}
            redFlags={company.talking_points?.length ? company.red_flags : legacy.redFlags}
            legacyTalkingPoints={legacyTalking}
            clientContactRisk={company.client_contact_risk}
            scoreGroup={(groups.data ?? []).find((g) => g.key === scoreGroup(company.icp_score)) ?? null}
            assessed={
              company.qualified_at
                ? `Assessed on ${formatDate(company.qualified_at)}${company.reviewer ? ` by ${company.reviewer.full_name || company.reviewer.email}` : " by Claude"}. The score is the segment base plus the active signals.`
                : "Not judged yet. The score follows once there is a GO with a segment."
            }
          />
          <Card>
            <CardHeader title="Company" />
            <CardBody className="space-y-5">
              {company.opening_line && (
                <div>
                  <h3 className="text-xs font-medium tracking-wide text-muted uppercase">Opening line</h3>
                  <p className="mt-1 text-sm text-ink italic">{company.opening_line}</p>
                </div>
              )}
              <div>
                <DetailList
                  items={[
                    { label: "Legal form", value: company.legal_form },
                    { label: "Employees", value: employeesBandLabel(company.employees) },
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
            <SignalsCard companyId={company.id} signals={signals} points={points} />
          </div>

          <div className="min-w-0 max-lg:order-2">
            <CampaignsCard members={campaigns.data ?? []} contacts={contacts} />
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
              companyId={company.id}
              contacts={contacts}
              orderManual={company.contact_order_manual}
              actions={
                <>
                  <MergeContactsButton contacts={contactOptions} action={mergeContactsAction.bind(null, company.id)} />
                  <AddContactButton companyName={company.name} action={createContactAction.bind(null, company.id)} />
                </>
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

          <div className="min-w-0 max-lg:order-4">
            <Suspense fallback={<Skeleton className="h-40 w-full" />}>
              <ClientRatesCard companyId={company.id} clientId={company.client?.id ?? null} />
            </Suspense>
          </div>

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

function SignalsCard({ companyId, signals, points }: { companyId: string; signals: SignalItem[]; points: SignalPoint[] }) {
  // Signals that count first, then the rest; closed ones last.
  const rows = signals
    .map((s) => ({
      s,
      state: signalState(
        { type: s.type, title: s.title, role_group: s.roleGroup, posted_at: s.postedAt ?? null, first_seen_at: s.firstSeenAt, closed_at: s.closedAt, valid_until: s.validUntil },
        points,
      ),
    }))
    .sort((x, y) => Number(y.state.counts) - Number(x.state.counts) || Number(Boolean(x.s.closedAt)) - Number(Boolean(y.s.closedAt)));
  const kinds = [
    ...points.filter((p) => !p.derived || p.type === "vacature").map((p) => ({ value: p.type, label: p.label, points: p.active ? p.points : null })),
    { value: "overig", label: "Other", points: null },
  ];
  return (
    <Card>
      <CardHeader
        title="Signals"
        description="Each signal with its kind, date, source, until when it counts and its points. Evergreen vacancies (open over 180 days or an open application) and expired signals do not count."
        actions={<AddSignalButton kinds={kinds} action={addSignalAction.bind(null, companyId)} />}
      />
      {signals.length === 0 ? (
        <CardBody>
          <p className="text-sm text-muted">No signals for this company yet.</p>
        </CardBody>
      ) : (
        <ol className="divide-y divide-border">
          {rows.map(({ s, state }) => (
            <li key={s.id} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <SignalTypeBadge type={s.type} />
                  {state.counts && state.points !== null && (
                    <Badge tone={state.points < 0 ? "danger" : "success"}>
                      {state.points > 0 ? "+" : ""}
                      {state.points}
                    </Badge>
                  )}
                  {state.evergreen && <Badge tone="neutral">Evergreen: does not count</Badge>}
                  {s.closedAt ? <Badge tone="neutral">Offline</Badge> : !state.active && <Badge tone="neutral">Expired</Badge>}
                  {s.validUntil && <span className="text-xs text-muted">Valid until {formatDate(s.validUntil)}</span>}
                </div>
                <VacancyItem
                  title={s.title}
                  url={s.sourceUrl}
                  source={s.source}
                  postedAt={s.postedAt}
                  firstSeenAt={s.firstSeenAt}
                  closedAt={s.closedAt}
                  description={s.description}
                  roleGroup={s.roleGroup}
                />
              </div>
              <div className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
                <p className="text-xs text-muted">Last seen {formatDate(s.lastSeenAt)}</p>
                <div className="-mr-2 flex items-center">
                  <EditSignalButton
                    signal={{
                      id: s.id,
                      title: s.title,
                      url: s.sourceUrl,
                      description: s.description ?? null,
                      closed: Boolean(s.closedAt),
                      postedAt: s.postedAt ?? null,
                      validUntil: s.validUntil ?? null,
                    }}
                    action={updateSignalAction.bind(null, companyId, s.id)}
                  />
                  <DeleteSignalButton title={s.title ?? "this signal"} action={deleteSignalAction.bind(null, companyId, s.id)} />
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

type CampaignMembership = {
  id: string;
  status: string;
  added_at: string;
  ended_at: string | null;
  replied_at: string | null;
  reply_outcome: string | null;
  contact_id: string | null;
  campaign: { id: string; name: string; provider: string; channel: string; status: string } | null;
};

const memberStatusLabel: Record<string, string> = {
  queued: "Queued",
  active: "Running",
  replied: "Replied",
  finished: "Finished",
  stopped: "Stopped",
  bounced: "Bounced",
  unsubscribed: "Unsubscribed",
};

/** Every campaign in Instantly or Seleqt this company was in, with the contact and how it went (leadregels, deel 10). */
function CampaignsCard({ members, contacts }: { members: CampaignMembership[]; contacts: CompanyContact[] }) {
  return (
    <Card>
      <CardHeader title="Campaigns" description="Every campaign in Instantly or Seleqt this company was in, newest first." />
      {members.length === 0 ? (
        <CardBody>
          <p className="text-sm text-muted">This company has not been in a campaign.</p>
        </CardBody>
      ) : (
        <ul className="divide-y divide-border">
          {members.map((m) => (
            <li key={m.id} className="flex flex-col gap-1 px-5 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                {m.campaign ? (
                  <Link href={`/dashboard/sequences/campaigns/${m.campaign.id}`} className="font-medium text-brand-700 hover:underline">
                    {m.campaign.name}
                  </Link>
                ) : (
                  <span className="font-medium">Campaign removed</span>
                )}
                <p className="text-xs text-muted">
                  {m.campaign ? `${m.campaign.provider === "seleqt" ? "Seleqt" : m.campaign.provider === "instantly" ? "Instantly" : m.campaign.provider}, campaign ${m.campaign.status}` : ""}
                  {m.contact_id ? `, ${contacts.find((c) => c.id === m.contact_id)?.name ?? "contact"}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2 text-xs text-muted">
                <Badge tone={m.status === "replied" ? "success" : m.status === "active" || m.status === "queued" ? "accent" : "neutral"}>
                  {memberStatusLabel[m.status] ?? m.status}
                </Badge>
                <span>
                  {formatDate(m.added_at)}
                  {m.ended_at ? ` to ${formatDate(m.ended_at)}` : ""}
                  {m.replied_at ? `, replied ${formatDate(m.replied_at)}` : ""}
                </span>
              </div>
            </li>
          ))}
        </ul>
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
