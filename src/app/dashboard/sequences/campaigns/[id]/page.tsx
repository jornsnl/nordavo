import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { CampaignStatusButtons, ImportMembersForm } from "@/components/campaigns/campaign-controls";
import { campaignStatusTone, providerLabel } from "@/components/campaigns/campaign-list";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { getCampaign } from "@/lib/data/campaigns";
import { formatDate, formatDateTime } from "@/lib/format";

export const metadata: Metadata = {
  title: "Campaign",
};

const memberTone = {
  queued: "warning",
  active: "brand",
  replied: "success",
  finished: "neutral",
  stopped: "neutral",
  bounced: "danger",
  unsubscribed: "danger",
} as const;

const replyLabel: Record<string, string> = { reply_positief: "positive", reply_neutraal: "neutral", reply_negatief: "negative" };

export default function Page({ params }: PageProps<"/dashboard/sequences/campaigns/[id]">) {
  return (
    <>
      <Link href="/dashboard/sequences/campaigns" className="mb-4 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-muted hover:text-brand-700">
        <ArrowLeft className="size-4" aria-hidden="true" />
        Campaigns
      </Link>
      <Suspense fallback={<Skeleton className="h-96 w-full rounded-2xl" />}>
        <Detail params={params} />
      </Suspense>
    </>
  );
}

async function Detail({ params }: { params: PageProps<"/dashboard/sequences/campaigns/[id]">["params"] }) {
  const { id } = await params;
  const campaign = await getCampaign(id);
  if (!campaign) notFound();
  const replied = campaign.members.filter((m) => m.repliedAt);
  const running = campaign.members.filter((m) => m.status === "queued" || m.status === "active");
  return (
    <>
      <PageHeader
        eyebrow={`${providerLabel[campaign.provider] ?? campaign.provider} · ${campaign.channel === "linkedin" ? "LinkedIn" : "Mail"}`}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {campaign.name}
            <Badge tone={campaignStatusTone[campaign.status]}>{campaign.status}</Badge>
          </span>
        }
        description={`${campaign.members.length} leads, ${running.length} running, ${replied.length} replied.${campaign.syncedAt ? ` Last update ${formatDateTime(campaign.syncedAt)}.` : ""}${campaign.externalId ? ` Id there: ${campaign.externalId}.` : ""}`}
        actions={<CampaignStatusButtons id={campaign.id} status={campaign.status} />}
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          {campaign.members.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-border bg-card px-6 py-10 text-center text-sm text-muted">
              No leads in this campaign yet. Send leads here from Incoming, import the export on the right, or let Claude register them.
            </p>
          ) : (
            <Table>
              <THead>
                <tr>
                  <TH>Company</TH>
                  <TH>Contact</TH>
                  <TH>Status</TH>
                  <TH>In since</TH>
                  <TH>Replied</TH>
                </tr>
              </THead>
              <TBody>
                {campaign.members.map((m) => (
                  <TR key={m.id}>
                    <TD>
                      <Link href={`/dashboard/leads/${m.companyId}`} className="font-medium text-brand-800 hover:underline">
                        {m.companyName}
                      </Link>
                    </TD>
                    <TD>
                      {m.contactName ?? ""}
                      {m.email && <span className="block text-xs text-muted">{m.email}</span>}
                    </TD>
                    <TD>
                      <Badge tone={memberTone[m.status]}>{m.status}</Badge>
                    </TD>
                    <TD className="text-muted">
                      {formatDate(m.addedAt)}
                      {m.endedAt ? ` to ${formatDate(m.endedAt)}` : ""}
                    </TD>
                    <TD>{m.repliedAt ? `${formatDate(m.repliedAt)}${m.replyOutcome ? ` (${replyLabel[m.replyOutcome] ?? m.replyOutcome})` : ""}` : ""}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </div>
        <Card className="self-start">
          <CardHeader
            title="Import leads"
            description="The export of Seleqt or Instantly: a column with the mail address or the LinkedIn link, and optionally status and replied."
          />
          <CardBody>
            <ImportMembersForm id={campaign.id} />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
