import { Suspense } from "react";
import { Handshake, ShieldCheck } from "lucide-react";
import { EmptyState } from "@/components/dashboard/empty-state";
import { PageHeader } from "@/components/dashboard/page-header";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody } from "@/components/ui/card";
import { ListSkeleton } from "@/components/ui/skeleton";
import { MobileList, MobileListItem } from "@/components/ui/mobile-list";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { getPortalPlacements, type PortalPlacement } from "@/lib/data/portal";
import { formatCurrency, formatDate, todayIso } from "@/lib/format";
import { optionFor, placementStatuses } from "@/lib/labels";

export default function PortalPlacementsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Placements"
        title="Your developers"
        description="The developers who work in your team through Nordavo. You can cancel with one month's notice; there is no minimum term."
      />
      <Suspense fallback={<ListSkeleton rows={4} />}>
        <PlacementsTable />
      </Suspense>

      <Card className="mt-6 sm:mt-8">
        <CardBody className="flex items-start gap-3 text-sm">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-brand-600" aria-hidden="true" />
          <div className="space-y-1 text-muted">
            <p className="font-medium text-brand-900">How our agreements work</p>
            <p>
              If a developer turns out not to fit within the first 30 days, we find a replacement at no extra cost. You are
              not locked in: you can cancel monthly, with one month&apos;s notice. Mail us at{" "}
              <a href="mailto:info@nordavo.nl" className="font-medium text-brand-700 hover:underline">
                info@nordavo.nl
              </a>{" "}
              or call +31 6 80227346.
            </p>
          </div>
        </CardBody>
      </Card>
    </>
  );
}

async function PlacementsTable() {
  const placements = await getPortalPlacements();
  const today = todayIso();

  if (!placements.length) {
    return (
      <EmptyState
        icon={Handshake}
        title="No placements yet"
        description="Once you choose one of our candidates, we arrange the contract, payroll and onboarding. The placement then shows up here, with its start date and guarantee period."
      />
    );
  }

  return (
    <>
      <MobileList label="Placements" className="md:hidden">
        {placements.map((p) => {
          const status = optionFor(placementStatuses, p.status);
          return (
            <MobileListItem
              key={p.id}
              leading={<Avatar name={p.candidateName ?? "Developer"} />}
              title={p.candidateName ?? "Developer"}
              subtitle={[p.candidateTitle, p.vacancyTitle].filter(Boolean).join(", ") || undefined}
              meta={`Started on ${formatDate(p.startDate)}`}
              trailing={<Badge tone={status.tone}>{status.label}</Badge>}
            >
              <div className="space-y-1 text-xs">
                <p className="text-ink">
                  {p.monthlyRate === null ? "Rate as quoted" : `${formatCurrency(p.monthlyRate)} per month`}
                </p>
                <NoticeInfo placement={p} />
                <p>
                  <GuaranteeInfo guaranteeUntil={p.guaranteeUntil} today={today} ended={p.status === "ended"} />
                </p>
              </div>
            </MobileListItem>
          );
        })}
      </MobileList>

      <Table className="hidden md:block">
        <THead>
          <tr>
            <TH>Developer</TH>
            <TH>Start</TH>
            <TH>Status</TH>
            <TH>Guarantee</TH>
            <TH className="text-right">Monthly rate</TH>
          </tr>
        </THead>
        <TBody>
          {placements.map((p) => {
            const status = optionFor(placementStatuses, p.status);
            return (
              <TR key={p.id}>
                <TD>
                  <p className="font-medium text-brand-900">{p.candidateName ?? "Developer"}</p>
                  <p className="text-xs text-muted">{[p.candidateTitle, p.vacancyTitle].filter(Boolean).join(", ")}</p>
                </TD>
                <TD className="whitespace-nowrap">{formatDate(p.startDate)}</TD>
                <TD>
                  <Badge tone={status.tone}>{status.label}</Badge>
                  <NoticeInfo placement={p} />
                </TD>
                <TD className="text-sm">
                  <GuaranteeInfo guaranteeUntil={p.guaranteeUntil} today={today} ended={p.status === "ended"} />
                </TD>
                <TD className="text-right whitespace-nowrap">{formatCurrency(p.monthlyRate, "As quoted")}</TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
    </>
  );
}

function NoticeInfo({ placement }: { placement: PortalPlacement }) {
  if (placement.status === "notice") {
    return (
      <p className="mt-1 text-xs text-muted">
        {placement.noticeGivenAt ? `Notice given on ${formatDate(placement.noticeGivenAt)}` : "Notice given"}
        {placement.endDate ? `, last working day ${formatDate(placement.endDate)}` : ""}
      </p>
    );
  }
  if (placement.status === "ended") {
    return placement.endDate ? <p className="mt-1 text-xs text-muted">Ended on {formatDate(placement.endDate)}</p> : null;
  }
  return <p className="mt-1 text-xs text-muted">One month&apos;s notice</p>;
}

function GuaranteeInfo({
  guaranteeUntil,
  today,
  ended,
}: {
  guaranteeUntil: string | null;
  today: string;
  ended: boolean;
}) {
  if (!guaranteeUntil || ended) return <span className="text-muted">Not applicable</span>;
  if (guaranteeUntil >= today) {
    return <span className="text-ink">Free replacement until {formatDate(guaranteeUntil)}</span>;
  }
  return <span className="text-muted">Guarantee period ended on {formatDate(guaranteeUntil)}</span>;
}
