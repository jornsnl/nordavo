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
        eyebrow="Plaatsingen"
        title="Jouw developers"
        description="De developers die via Nordavo in je team werken. Opzeggen kan met een maand opzegtermijn, er is geen minimale looptijd."
      />
      <Suspense fallback={<ListSkeleton rows={4} />}>
        <PlacementsTable />
      </Suspense>

      <Card className="mt-6 sm:mt-8">
        <CardBody className="flex items-start gap-3 text-sm">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-brand-600" aria-hidden="true" />
          <div className="space-y-1 text-muted">
            <p className="font-medium text-brand-900">Zo werken onze afspraken</p>
            <p>
              Past een developer in de eerste 30 dagen toch niet, dan zoeken we vervanging zonder extra kosten. Je zit
              nergens aan vast: opzeggen kan per maand, met een maand opzegtermijn. Mail ons op{" "}
              <a href="mailto:info@nordavo.nl" className="font-medium text-brand-700 hover:underline">
                info@nordavo.nl
              </a>{" "}
              of bel +31 6 80227346.
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
        title="Nog geen plaatsingen"
        description="Kies je een van onze kandidaten, dan regelen wij contract, payroll en onboarding. Daarna zie je de plaatsing hier, met startdatum en garantieperiode."
      />
    );
  }

  return (
    <>
      <MobileList label="Plaatsingen" className="md:hidden">
        {placements.map((p) => {
          const status = optionFor(placementStatuses, p.status);
          return (
            <MobileListItem
              key={p.id}
              leading={<Avatar name={p.candidateName ?? "Developer"} />}
              title={p.candidateName ?? "Developer"}
              subtitle={[p.candidateTitle, p.vacancyTitle].filter(Boolean).join(", ") || undefined}
              meta={`Gestart op ${formatDate(p.startDate)}`}
              trailing={<Badge tone={status.tone}>{status.label}</Badge>}
            >
              <div className="space-y-1 text-xs">
                <p className="text-ink">
                  {p.monthlyRate === null ? "Tarief volgens offerte" : `${formatCurrency(p.monthlyRate)} per maand`}
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
            <TH>Garantie</TH>
            <TH className="text-right">Tarief per maand</TH>
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
                <TD className="text-right whitespace-nowrap">{formatCurrency(p.monthlyRate, "Volgens offerte")}</TD>
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
        {placement.noticeGivenAt ? `Opgezegd op ${formatDate(placement.noticeGivenAt)}` : "Opgezegd"}
        {placement.endDate ? `, laatste werkdag ${formatDate(placement.endDate)}` : ""}
      </p>
    );
  }
  if (placement.status === "ended") {
    return placement.endDate ? <p className="mt-1 text-xs text-muted">Gestopt op {formatDate(placement.endDate)}</p> : null;
  }
  return <p className="mt-1 text-xs text-muted">Een maand opzegtermijn</p>;
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
  if (!guaranteeUntil || ended) return <span className="text-muted">Niet van toepassing</span>;
  if (guaranteeUntil >= today) {
    return <span className="text-ink">Vervanging zonder extra kosten tot {formatDate(guaranteeUntil)}</span>;
  }
  return <span className="text-muted">Garantieperiode liep tot {formatDate(guaranteeUntil)}</span>;
}
