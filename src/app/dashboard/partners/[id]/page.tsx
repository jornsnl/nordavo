import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink, Mail, Phone, Radar } from "lucide-react";
import { EmptyState } from "@/components/dashboard/empty-state";
import { PageHeader } from "@/components/dashboard/page-header";
import { QuickActions, telHref, type QuickAction } from "@/components/entity/quick-actions";
import { ContactMomentForm, PartnerForm } from "@/components/partners/partner-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, DetailList } from "@/components/ui/card";
import { MobileList, MobileListItem } from "@/components/ui/mobile-list";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { getPartner, listTeamOptions, type PartnerDetail } from "@/lib/data/partners";
import { formatDate, formatDateTime, formatRelativeDays } from "@/lib/format";
import { activityChannels, optionFor } from "@/lib/labels";
import { labelOf, leadStatuses, pipelineStages } from "@/lib/sales/labels";
import { logPartnerContactAction, setPartnerNextAction, updatePartnerAction } from "../actions";
import { NextActionForm } from "@/components/partners/next-action-form";
import { EntityExtras } from "@/components/entity/entity-extras";
import { ListSkeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = {
  title: "Partner",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function Page({ params }: PageProps<"/dashboard/partners/[id]">) {
  return (
    <>
      <Link
        href="/dashboard/partners"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-brand-700 pointer-coarse:mb-2 pointer-coarse:min-h-11"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        All partners
      </Link>
      <Suspense fallback={<Skeleton className="h-96 w-full rounded-2xl" />}>
        <Detail params={params} />
      </Suspense>
    </>
  );
}

async function Detail({ params }: { params: PageProps<"/dashboard/partners/[id]">["params"] }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const [partner, team] = await Promise.all([getPartner(id), listTeamOptions()]);
  if (!partner) notFound();

  const quick: QuickAction[] = [];
  if (partner.phone) quick.push({ label: "Call", href: telHref(partner.phone), icon: Phone, ariaLabel: `Call ${partner.name}` });
  if (partner.email) quick.push({ label: "Email", href: `mailto:${partner.email}`, icon: Mail, ariaLabel: `Email ${partner.name}` });
  if (partner.linkedinUrl) quick.push({ label: "LinkedIn", href: partner.linkedinUrl, icon: ExternalLink, external: true });

  return (
    <>
      <PageHeader
        eyebrow="Partner"
        title={
          <span className="flex flex-wrap items-center gap-3">
            {partner.name}
            <Badge tone={partner.status === "active" ? "success" : "neutral"}>{partner.status === "active" ? "Active" : "Inactive"}</Badge>
          </span>
        }
        description={partner.companyName ?? undefined}
      />
      <QuickActions label={`Quick contact with ${partner.name}`} actions={quick} />

      <div className="grid grid-cols-1 gap-4 sm:gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0 space-y-4 sm:space-y-6">
          <Card>
            <CardHeader title="Details" />
            <CardBody>
              <DetailList
                items={[
                  { label: "Company", value: partner.companyName },
                  { label: "Owner", value: partner.ownerName },
                  { label: "Email", value: partner.email ? <a className="text-brand-700 hover:underline" href={`mailto:${partner.email}`}>{partner.email}</a> : null },
                  { label: "Phone", value: partner.phone ? <a className="text-brand-700 hover:underline" href={telHref(partner.phone)}>{partner.phone}</a> : null },
                  {
                    label: "LinkedIn",
                    value: partner.linkedinUrl ? (
                      <a href={partner.linkedinUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-brand-700 hover:underline">
                        Profile
                        <ExternalLink className="size-3.5" aria-hidden="true" />
                      </a>
                    ) : null,
                  },
                  {
                    label: "Last contact",
                    value: partner.lastContactAt ? `${formatDate(partner.lastContactAt)}, ${formatRelativeDays(partner.lastContactAt)}` : "Never",
                  },
                ]}
              />
              {partner.notes && <p className="mt-4 whitespace-pre-wrap text-sm text-ink">{partner.notes}</p>}
            </CardBody>
          </Card>

          <Leads partner={partner} />
          <Moments partner={partner} />
          {/* Tasks, notes and attachments, the same panel as on a lead (6fc01216). */}
          <Suspense fallback={<ListSkeleton rows={3} />}>
            <EntityExtras entityType="partner" entityId={partner.id} />
          </Suspense>
        </div>

        <div className="min-w-0 space-y-4 sm:space-y-6">
          <Card>
            <CardHeader
              title="Next action"
              description={
                partner.nextActionDate
                  ? `${partner.nextAction ?? "Next action"} on ${formatDate(partner.nextActionDate)}, ${formatRelativeDays(partner.nextActionDate)}`
                  : "What happens next with this partner, and when."
              }
            />
            <CardBody>
              <NextActionForm
                action={setPartnerNextAction.bind(null, partner.id)}
                nextAction={partner.nextAction}
                nextActionDate={partner.nextActionDate}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Log a contact moment" description="A call, mail, LinkedIn message or meeting with this partner." />
            <CardBody>
              <ContactMomentForm action={logPartnerContactAction.bind(null, partner.id)} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Edit partner" />
            <CardBody>
              <PartnerForm
                action={updatePartnerAction.bind(null, partner.id)}
                team={team}
                defaults={{
                  name: partner.name,
                  companyName: partner.companyName,
                  email: partner.email,
                  phone: partner.phone,
                  linkedinUrl: partner.linkedinUrl,
                  notes: partner.notes,
                  status: partner.status,
                  ownerId: partner.ownerId,
                }}
                submitLabel="Save"
              />
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}

function stageBadge(stage: PartnerDetail["leads"][number]["pipelineStage"]) {
  if (!stage) return <span className="text-sm text-muted">Not in pipeline</span>;
  const option = pipelineStages.find((s) => s.value === stage);
  return <Badge tone={option?.tone ?? "neutral"}>{option?.label ?? stage}</Badge>;
}

function Leads({ partner }: { partner: PartnerDetail }) {
  return (
    <section aria-labelledby="partner-leads" className="space-y-3">
      <h2 id="partner-leads" className="font-display text-lg font-semibold text-brand-900">
        Leads from {partner.name} ({partner.leads.length})
      </h2>
      {partner.leads.length === 0 ? (
        <EmptyState icon={Radar} title="No leads yet" description="Link a lead to this partner from the lead page." />
      ) : (
        <>
          <MobileList label="Leads" className="md:hidden">
            {partner.leads.map((l) => (
              <MobileListItem
                key={l.id}
                href={`/dashboard/leads/${l.id}`}
                title={l.name}
                subtitle={labelOf(leadStatuses, l.leadStatus)}
                meta={`Added ${formatDate(l.createdAt)}`}
                trailing={l.pipelineStage ? stageBadge(l.pipelineStage) : undefined}
              />
            ))}
          </MobileList>
          <Table className="hidden md:block">
            <THead>
              <tr>
                <TH>Company</TH>
                <TH>Lead status</TH>
                <TH>Pipeline stage</TH>
                <TH>Added</TH>
              </tr>
            </THead>
            <TBody>
              {partner.leads.map((l) => (
                <TR key={l.id}>
                  <TD>
                    <Link href={`/dashboard/leads/${l.id}`} className="font-medium text-brand-900 hover:text-brand-600 hover:underline">
                      {l.name}
                    </Link>
                    {l.city && <p className="text-xs text-muted">{l.city}</p>}
                  </TD>
                  <TD>
                    <Badge tone={leadStatuses.find((s) => s.value === l.leadStatus)?.tone ?? "neutral"}>
                      {labelOf(leadStatuses, l.leadStatus)}
                    </Badge>
                  </TD>
                  <TD>{stageBadge(l.pipelineStage)}</TD>
                  <TD className="whitespace-nowrap text-muted">{formatDate(l.createdAt)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </>
      )}
    </section>
  );
}

function Moments({ partner }: { partner: PartnerDetail }) {
  return (
    <Card>
      <CardHeader title="Contact moments" description="Newest first." />
      {partner.moments.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted">No contact moments yet.</p>
      ) : (
        <ol className="divide-y divide-border">
          {partner.moments.map((m) => (
            <li key={m.id} className="px-4 py-3 sm:px-5">
              <p className="flex flex-wrap items-center gap-2 text-sm">
                <Badge tone="brand">{optionFor(activityChannels, m.channel).label}</Badge>
                <span className="text-muted">
                  {formatDateTime(m.date)}
                  {m.byName ? `, ${m.byName}` : ""}
                  {m.direction === "inbound" ? ", the partner got in touch" : ""}
                </span>
              </p>
              {m.notes && <p className="mt-1 whitespace-pre-wrap break-words text-sm text-ink">{m.notes}</p>}
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
