import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { Archive, Route } from "lucide-react";
import { EmptyState } from "@/components/dashboard/empty-state";
import { PageHeader } from "@/components/dashboard/page-header";
import { channelLabel } from "@/components/sequences/channel";
import { SequenceForm } from "@/components/sequences/sequence-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { MobileList, MobileListItem } from "@/components/ui/mobile-list";
import { ListSkeleton } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { listSequences, type SequenceListItem } from "@/lib/data/sequences";
import { listCampaigns } from "@/lib/data/campaigns";
import { CampaignList } from "@/components/campaigns/campaign-list";
import { formatDate } from "@/lib/format";
import { sequenceStatuses } from "@/lib/sales/labels";
import { createSequenceAction } from "./actions";

export const metadata: Metadata = {
  title: "Sequences",
};

function StatusBadge({ status }: { status: SequenceListItem["status"] }) {
  const option = sequenceStatuses.find((s) => s.value === status);
  return <Badge tone={option?.tone ?? "neutral"}>{option?.label ?? status}</Badge>;
}

function approvalText(s: SequenceListItem) {
  if (s.steps === 0) return "No steps yet";
  if (s.toApprove > 0) return `${s.toApprove} ${s.toApprove === 1 ? "text" : "texts"} to approve`;
  return "All texts approved";
}

export default function Page({ searchParams }: PageProps<"/dashboard/sequences">) {
  return (
    <>
      <PageHeader
        eyebrow="Sales"
        title="Sequences"
        description="Steps over mail, LinkedIn and calls, each on its own day. Claude writes concept texts, you approve them; only approved text is used. Start a sequence for companies from here or let Claude do it."
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-8">
          <section aria-labelledby="campaigns-heading" className="space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 id="campaigns-heading" className="font-display text-lg font-semibold text-brand-900">
                  Running campaigns
                </h2>
                <p className="text-sm text-muted">Instantly (mail) and Seleqt (LinkedIn): the leads in them and who replied.</p>
              </div>
              <Link href="/dashboard/sequences/campaigns" className="text-sm font-semibold text-brand-600 hover:text-brand-800">
                All campaigns
              </Link>
            </div>
            <Suspense fallback={<ListSkeleton rows={3} />}>
              <RunningCampaigns />
            </Suspense>
          </section>
          <section aria-labelledby="sequences-heading" className="space-y-3">
            <h2 id="sequences-heading" className="font-display text-lg font-semibold text-brand-900">
              Sequences
            </h2>
            <Suspense fallback={<ListSkeleton rows={5} />}>
              <SequenceList searchParams={searchParams} />
            </Suspense>
          </section>
        </div>
        <Card className="self-start">
          <CardHeader title="New sequence" description="Give it a name; add the steps on the next page." />
          <CardBody>
            <SequenceForm action={createSequenceAction} submitLabel="Create sequence" />
          </CardBody>
        </Card>
      </div>
    </>
  );
}

async function RunningCampaigns() {
  return <CampaignList campaigns={await listCampaigns()} />;
}

async function SequenceList({ searchParams }: { searchParams: PageProps<"/dashboard/sequences">["searchParams"] }) {
  const archived = (await searchParams).archived === "1";
  const sequences = await listSequences({ archived });
  const toggle = (
    <Link
      href={archived ? "/dashboard/sequences" : "/dashboard/sequences?archived=1"}
      className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600 hover:text-brand-800 pointer-coarse:min-h-11"
    >
      <Archive className="size-4" aria-hidden="true" />
      {archived ? "Show current sequences" : "Show archived"}
    </Link>
  );

  if (sequences.length === 0) {
    return (
      <div className="space-y-3">
        <EmptyState
          icon={Route}
          title={archived ? "No archived sequences" : "No sequences yet"}
          description={
            archived
              ? "Archived sequences show up here."
              : "Create the first sequence on the right, then add its steps with their day, channel and text."
          }
        />
        {toggle}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <MobileList label="Sequences" className="md:hidden">
        {sequences.map((s) => (
          <MobileListItem
            key={s.id}
            href={`/dashboard/sequences/${s.id}`}
            title={s.name}
            subtitle={`${s.steps} ${s.steps === 1 ? "step" : "steps"}${s.channels.length ? `: ${s.channels.map(channelLabel).join(", ")}` : ""}`}
            meta={`${approvalText(s)}. ${s.active} active, ${s.paused} paused.`}
            trailing={<StatusBadge status={s.status} />}
          />
        ))}
      </MobileList>
      <Table className="hidden md:block">
        <THead>
          <tr>
            <TH>Sequence</TH>
            <TH>Status</TH>
            <TH>Steps</TH>
            <TH>Texts</TH>
            <TH className="text-right">Active</TH>
            <TH className="text-right">Paused</TH>
            <TH>Updated</TH>
          </tr>
        </THead>
        <TBody>
          {sequences.map((s) => (
            <TR key={s.id}>
              <TD>
                <Link href={`/dashboard/sequences/${s.id}`} className="font-medium text-brand-900 hover:text-brand-600 hover:underline">
                  {s.name}
                </Link>
                {s.description && <p className="line-clamp-1 max-w-md text-xs text-muted">{s.description}</p>}
              </TD>
              <TD>
                <StatusBadge status={s.status} />
              </TD>
              <TD className="text-muted">
                {s.steps}
                {s.channels.length ? `: ${s.channels.map(channelLabel).join(", ")}` : ""}
              </TD>
              <TD>
                {s.toApprove > 0 ? <Badge tone="warning">{approvalText(s)}</Badge> : <span className="text-sm text-muted">{approvalText(s)}</span>}
                {s.concepts > 0 && (
                  <span className="mt-1 block text-xs text-accent-600">
                    {s.concepts} {s.concepts === 1 ? "concept" : "concepts"} waiting
                  </span>
                )}
              </TD>
              <TD className="text-right tabular-nums">{s.active}</TD>
              <TD className="text-right tabular-nums">{s.paused}</TD>
              <TD className="whitespace-nowrap text-muted">{formatDate(s.updatedAt)}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
      {toggle}
    </div>
  );
}
