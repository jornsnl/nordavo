import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { HeartHandshake } from "lucide-react";
import { EmptyState } from "@/components/dashboard/empty-state";
import { PageHeader } from "@/components/dashboard/page-header";
import { PartnerForm } from "@/components/partners/partner-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { MobileList, MobileListItem } from "@/components/ui/mobile-list";
import { ListSkeleton, Skeleton } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { listPartners, listTeamOptions } from "@/lib/data/partners";
import { formatDate, formatRelativeDays } from "@/lib/format";
import { createPartnerAction } from "./actions";

export const metadata: Metadata = {
  title: "Partners",
};

const filters = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "all", label: "All" },
] as const;

export default function Page({ searchParams }: PageProps<"/dashboard/partners">) {
  return (
    <>
      <PageHeader
        eyebrow="Sales"
        title="Partners"
        description="People who bring in leads. Keep their details, log every contact moment and see which leads came from them and how far they got."
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0">
          <Suspense fallback={<ListSkeleton rows={5} />}>
            <PartnerList searchParams={searchParams} />
          </Suspense>
        </div>
        <Card className="self-start">
          <CardHeader title="New partner" />
          <CardBody>
            <Suspense fallback={<Skeleton className="h-96 w-full" />}>
              <NewPartner />
            </Suspense>
          </CardBody>
        </Card>
      </div>
    </>
  );
}

async function NewPartner() {
  const team = await listTeamOptions();
  return <PartnerForm action={createPartnerAction} team={team} submitLabel="Add partner" />;
}

async function PartnerList({ searchParams }: { searchParams: PageProps<"/dashboard/partners">["searchParams"] }) {
  const raw = (await searchParams).status;
  const status = filters.find((f) => f.value === raw)?.value ?? "active";
  const partners = await listPartners({ status });

  return (
    <div className="space-y-4">
      <nav aria-label="Filter partners" className="flex flex-wrap gap-2">
        {filters.map((f) => (
          <Link
            key={f.value}
            href={f.value === "active" ? "/dashboard/partners" : `/dashboard/partners?status=${f.value}`}
            aria-current={status === f.value ? "page" : undefined}
            className={`rounded-full px-3 py-1.5 text-sm font-medium ring-1 ring-inset pointer-coarse:min-h-9 ${
              status === f.value ? "bg-brand-700 text-white ring-brand-700" : "bg-white text-brand-900 ring-border hover:bg-brand-50"
            }`}
          >
            {f.label}
          </Link>
        ))}
      </nav>
      {partners.length === 0 ? (
        <EmptyState
          icon={HeartHandshake}
          title="No partners here"
          description="Add a partner on the right. Link leads to them from the lead page."
        />
      ) : (
        <>
          <MobileList label="Partners" className="md:hidden">
            {partners.map((p) => (
              <MobileListItem
                key={p.id}
                href={`/dashboard/partners/${p.id}`}
                title={p.name}
                subtitle={[p.companyName, p.ownerName ? `owner ${p.ownerName}` : null].filter(Boolean).join(", ") || undefined}
                meta={`${p.leads} ${p.leads === 1 ? "lead" : "leads"}, ${p.inPipeline} in pipeline, ${p.won} won. Last contact ${
                  p.lastContactAt ? formatRelativeDays(p.lastContactAt) : "never"
                }`}
                trailing={p.status === "inactive" ? <Badge tone="neutral">Inactive</Badge> : undefined}
              />
            ))}
          </MobileList>
          <Table className="hidden md:block">
            <THead>
              <tr>
                <TH>Partner</TH>
                <TH>Owner</TH>
                <TH>Last contact</TH>
                <TH className="text-right">Leads</TH>
                <TH className="text-right">In pipeline</TH>
                <TH className="text-right">Won</TH>
              </tr>
            </THead>
            <TBody>
              {partners.map((p) => (
                <TR key={p.id}>
                  <TD>
                    <Link href={`/dashboard/partners/${p.id}`} className="font-medium text-brand-900 hover:text-brand-600 hover:underline">
                      {p.name}
                    </Link>
                    {p.status === "inactive" && (
                      <span className="ml-2">
                        <Badge tone="neutral">Inactive</Badge>
                      </span>
                    )}
                    {p.companyName && <p className="text-xs text-muted">{p.companyName}</p>}
                  </TD>
                  <TD className="text-muted">{p.ownerName ?? "Nobody"}</TD>
                  <TD className="whitespace-nowrap text-muted">
                    {p.lastContactAt ? (
                      <>
                        {formatDate(p.lastContactAt)}
                        <span className="block text-xs">{formatRelativeDays(p.lastContactAt)}</span>
                      </>
                    ) : (
                      "Never"
                    )}
                  </TD>
                  <TD className="text-right tabular-nums">{p.leads}</TD>
                  <TD className="text-right tabular-nums">{p.inPipeline}</TD>
                  <TD className="text-right tabular-nums">{p.won}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </>
      )}
    </div>
  );
}
