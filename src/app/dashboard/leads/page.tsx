import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import Form from "next/form";
import { ClipboardCheck, Radar, Search, Upload } from "lucide-react";
import { EmptyState } from "@/components/dashboard/empty-state";
import { PageHeader } from "@/components/dashboard/page-header";
import {
  CompanyStatusBadge,
  IcpBadge,
  SegmentBadge,
  SignalTypeBadge,
} from "@/components/leads/badges";
import { ChipStrip, hrefWith } from "@/components/leads/chip-strip";
import { FilterSheet } from "@/components/leads/filter-sheet";
import { LeadTabs } from "@/components/leads/lead-tabs";
import { Pagination } from "@/components/leads/pagination";
import { Button, ButtonLink } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { MobileList, MobileListItem } from "@/components/ui/mobile-list";
import { ListSkeleton, Skeleton } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import {
  countReview,
  isCompanyStatus,
  isIcpDecision,
  isSegment,
  LEADS_PAGE_SIZE,
  listLeads,
  type LeadFilters,
} from "@/lib/data/companies";
import { formatDate, formatRelativeDays } from "@/lib/format";
import { companyStatuses, icpDecisions, segments } from "@/lib/labels";

export const metadata: Metadata = {
  title: "Leads",
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const SIGNAL_WINDOWS = [7, 14, 30, 60, 90];

function first(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value)?.trim() || undefined;
}

function readFilters(params: Record<string, string | string[] | undefined>): LeadFilters {
  const icp = first(params.icp);
  const segment = first(params.segment);
  const status = first(params.status);
  const signal = Number(first(params.signal));
  const minScore = Number(first(params.min));
  const page = Number(first(params.page));
  return {
    q: first(params.q),
    icp: icp === "none" ? "none" : isIcpDecision(icp) ? icp : undefined,
    segment: isSegment(segment) ? segment : undefined,
    status: isCompanyStatus(status) ? status : undefined,
    signalDays: SIGNAL_WINDOWS.includes(signal) ? signal : undefined,
    minScore: Number.isFinite(minScore) && minScore > 0 && minScore <= 100 ? Math.round(minScore) : undefined,
    sort: first(params.sort) === "new" ? "new" : "score",
    page: Number.isInteger(page) && page > 1 ? page : 1,
  };
}

/** Filters back to URL params, for pagination links. */
function toParams(f: LeadFilters): Record<string, string | undefined> {
  return {
    q: f.q,
    icp: f.icp,
    segment: f.segment,
    status: f.status,
    signal: f.signalDays ? String(f.signalDays) : undefined,
    min: f.minScore ? String(f.minScore) : undefined,
    sort: f.sort === "new" ? "new" : undefined,
  };
}

export default function Page({ searchParams }: PageProps<"/dashboard/leads">) {
  return (
    <>
      <PageHeader
        eyebrow="Sales"
        title="Leads"
        description="Alle bedrijven uit scrapes en oude lijsten, met het oordeel van Claude en het laatste signaal."
        actions={
          <>
            <ButtonLink href="/dashboard/import" variant="secondary">
              <Upload aria-hidden="true" />
              Importeren
            </ButtonLink>
            <ButtonLink href="/dashboard/leads/review">
              <ClipboardCheck aria-hidden="true" />
              Review
            </ButtonLink>
          </>
        }
      />
      <Suspense fallback={<LeadTabs active="all" reviewCount={null} />}>
        <Tabs />
      </Suspense>
      <Suspense fallback={<Skeleton className="mb-6 h-24 w-full" />}>
        <Filters searchParams={searchParams} />
      </Suspense>
      <Suspense fallback={<ListSkeleton rows={8} />}>
        <LeadTable searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Tabs() {
  const count = await countReview();
  return <LeadTabs active="all" reviewCount={count} />;
}

async function Filters({ searchParams }: { searchParams: SearchParams }) {
  const f = readFilters(await searchParams);
  const params = toParams(f);
  const active = [f.icp, f.segment, f.status, f.signalDays, f.minScore].filter(Boolean).length;
  // Quick filters on phones: sort and the ICP verdict, keeping the other filters.
  const chips = [
    { label: "Hoogste score", href: hrefWith("/dashboard/leads", { ...params, sort: undefined }), active: f.sort !== "new" },
    { label: "Nieuwste eerst", href: hrefWith("/dashboard/leads", { ...params, sort: "new" }), active: f.sort === "new" },
    ...icpDecisions.map((o) => ({
      label: o.label,
      href: hrefWith("/dashboard/leads", { ...params, icp: f.icp === o.value ? undefined : o.value }),
      active: f.icp === o.value,
    })),
    {
      label: "Nog niet beoordeeld",
      href: hrefWith("/dashboard/leads", { ...params, icp: f.icp === "none" ? undefined : "none" }),
      active: f.icp === "none",
    },
  ];
  return (
    <Form action="/dashboard/leads" role="search" className="mb-6 space-y-3">
      <div className="flex flex-wrap items-center gap-2 md:gap-3">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted"
            aria-hidden="true"
          />
          <label htmlFor="lead-q" className="sr-only">
            Zoek op naam of domein
          </label>
          <Input
            id="lead-q"
            name="q"
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            defaultValue={f.q ?? ""}
            placeholder="Zoek op naam of domein"
            className="pl-10"
          />
        </div>
        {/* On phones the sort is a chip below; the select stays in the form so a search keeps it. */}
        <div className="max-md:hidden">
          <label htmlFor="lead-sort" className="sr-only">
            Sorteren
          </label>
          <Select id="lead-sort" name="sort" defaultValue={f.sort === "new" ? "new" : ""} className="sm:w-48">
            <option value="">Hoogste score</option>
            <option value="new">Nieuwste eerst</option>
          </Select>
        </div>
        <FilterSheet activeCount={active} resetHref="/dashboard/leads" title="Leads filteren" className="md:basis-full">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(5,minmax(0,1fr))_auto]">
            <div>
              <label htmlFor="lead-icp" className="sr-only">
                ICP oordeel
              </label>
              <Select id="lead-icp" name="icp" defaultValue={f.icp ?? ""}>
                <option value="">Elk oordeel</option>
                {icpDecisions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
                <option value="none">Nog niet beoordeeld</option>
              </Select>
            </div>
            <div>
              <label htmlFor="lead-segment" className="sr-only">
                Segment
              </label>
              <Select id="lead-segment" name="segment" defaultValue={f.segment ?? ""}>
                <option value="">Alle segmenten</option>
                {segments.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label htmlFor="lead-status" className="sr-only">
                Status
              </label>
              <Select id="lead-status" name="status" defaultValue={f.status ?? ""}>
                <option value="">Alle statussen</option>
                {companyStatuses.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label htmlFor="lead-signal" className="sr-only">
                Signaal in de laatste dagen
              </label>
              <Select id="lead-signal" name="signal" defaultValue={f.signalDays ? String(f.signalDays) : ""}>
                <option value="">Elk signaal</option>
                {SIGNAL_WINDOWS.map((d) => (
                  <option key={d} value={d}>
                    Signaal laatste {d} dagen
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label htmlFor="lead-min" className="sr-only">
                Minimale score
              </label>
              <Input
                id="lead-min"
                name="min"
                type="number"
                min={1}
                max={100}
                inputMode="numeric"
                placeholder="Minimale score"
                defaultValue={f.minScore ?? ""}
              />
            </div>
            <Button type="submit" variant="secondary" className="max-md:hidden">
              Filteren
            </Button>
          </div>
        </FilterSheet>
      </div>
      <ChipStrip label="Snelfilters" chips={chips} className="md:hidden" />
    </Form>
  );
}

async function LeadTable({ searchParams }: { searchParams: SearchParams }) {
  const f = readFilters(await searchParams);
  const { items, total } = await listLeads(f);

  if (items.length === 0) {
    const filtered = Boolean(f.q || f.icp || f.segment || f.status || f.signalDays || f.minScore);
    return (
      <EmptyState
        icon={Radar}
        title={filtered ? "Geen leads gevonden" : "Nog geen leads"}
        description={
          filtered
            ? "Niets gevonden met deze filters. Pas ze aan of wis de zoekterm."
            : "Leads komen binnen via de maandagflow (S1) of via een import van een oude lijst."
        }
      />
    );
  }

  return (
    <>
      <MobileList label="Leads" className="md:hidden">
        {items.map((lead) => (
          <MobileListItem
            key={lead.id}
            href={`/dashboard/leads/${lead.id}`}
            title={lead.name}
            subtitle={lead.domain}
            meta={
              lead.latestSignal
                ? `${lead.latestSignal.title ?? "Signaal"}, gezien ${formatRelativeDays(lead.latestSignal.lastSeenAt)}`
                : lead.lastActivityAt
                  ? `Laatst benaderd ${formatDate(lead.lastActivityAt)}`
                  : "Geen signaal, nog niet benaderd"
            }
          >
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
              <IcpBadge decision={lead.icpDecision} score={lead.icpScore} />
              <SegmentBadge segment={lead.segment} />
              <CompanyStatusBadge status={lead.status} />
              <span className="tabular-nums">
                {lead.contactsCount} {lead.contactsCount === 1 ? "contact" : "contacten"}
              </span>
            </div>
          </MobileListItem>
        ))}
      </MobileList>
      <Table className="hidden md:block">
        <THead>
          <tr>
            <TH>Bedrijf</TH>
            <TH>Segment</TH>
            <TH>ICP</TH>
            <TH>Laatste signaal</TH>
            <TH className="text-right">Contacten</TH>
            <TH>Status</TH>
            <TH>Laatste activiteit</TH>
          </tr>
        </THead>
        <TBody>
          {items.map((lead) => (
            <TR key={lead.id}>
              <TD>
                <Link
                  href={`/dashboard/leads/${lead.id}`}
                  className="font-medium text-brand-800 hover:underline focus-visible:outline-2 focus-visible:outline-brand-500"
                >
                  {lead.name}
                </Link>
                <p className="text-xs text-muted">{lead.domain}</p>
              </TD>
              <TD>
                <SegmentBadge segment={lead.segment} />
              </TD>
              <TD>
                <IcpBadge decision={lead.icpDecision} score={lead.icpScore} />
              </TD>
              <TD className="max-w-xs">
                {lead.latestSignal ? (
                  <div className="space-y-1">
                    <SignalTypeBadge type={lead.latestSignal.type} />
                    {lead.latestSignal.title && (
                      <p className="truncate text-sm" title={lead.latestSignal.title}>
                        {lead.latestSignal.title}
                      </p>
                    )}
                    <p className="text-xs text-muted">Gezien {formatRelativeDays(lead.latestSignal.lastSeenAt)}</p>
                  </div>
                ) : (
                  <span className="text-muted">Geen signaal</span>
                )}
              </TD>
              <TD className="text-right tabular-nums">{lead.contactsCount}</TD>
              <TD>
                <CompanyStatusBadge status={lead.status} />
              </TD>
              <TD className="text-muted">
                {lead.lastActivityAt ? formatDate(lead.lastActivityAt) : "Nog niet benaderd"}
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
      <Pagination
        basePath="/dashboard/leads"
        params={toParams(f)}
        page={f.page ?? 1}
        pageSize={LEADS_PAGE_SIZE}
        total={total}
      />
    </>
  );
}
