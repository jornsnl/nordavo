import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { ExternalLink, PhoneMissed } from "lucide-react";
import { EmptyState } from "@/components/dashboard/empty-state";
import { PageHeader } from "@/components/dashboard/page-header";
import { ExportHistory } from "@/components/enrich/export-history";
import { MaxExportForm } from "@/components/enrich/max-export-form";
import { MaxImportForm } from "@/components/enrich/max-import-form";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { MobileList, MobileListItem } from "@/components/ui/mobile-list";
import { ListSkeleton, Skeleton } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { getEnrichPreview } from "@/lib/data/enrich";
import { linkedinUrl } from "@/lib/gtm/lists";

export const metadata: Metadata = {
  title: "Enrich",
};

export default function Page() {
  return (
    <>
      <PageHeader
        eyebrow="Contacts"
        title="Enrich"
        description="Contacts without a phone number go to Max: everyone with status Enrich, and the contacts of companies with lead status Enrich. Export the CSV, send it to Max and import his file here. Contacts that get a number go to Enriched."
      />
      <div className="mb-8 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Export for Max" description="Only contacts with a LinkedIn URL: Max matches on it. Suppressed contacts are left out." />
          <CardBody>
            <Suspense fallback={<Skeleton className="h-10 w-40" />}>
              <ExportBlock />
            </Suspense>
          </CardBody>
        </Card>
        <Card>
          <CardHeader
            title="Import phone numbers from Max"
            description="Numbers are only added to contacts without a number, with Max as the source. A company in Enrich that gets a number goes back to Ready."
          />
          <CardBody>
            <MaxImportForm />
          </CardBody>
        </Card>
      </div>

      <section aria-labelledby="enrich-preview" className="mb-10">
        <Suspense fallback={<ListSkeleton rows={6} />}>
          <Preview />
        </Suspense>
      </section>

      <section aria-labelledby="export-history">
        <h2 id="export-history" className="mb-3 font-display text-lg font-semibold text-brand-900">
          Export history
        </h2>
        <Suspense fallback={<ListSkeleton rows={4} />}>
          <ExportHistory />
        </Suspense>
      </section>
    </>
  );
}

async function ExportBlock() {
  const preview = await getEnrichPreview(0);
  return (
    <div className="space-y-3">
      <p className="text-sm text-ink">
        <span className="font-display text-2xl font-bold text-brand-900 tabular-nums">{preview.count}</span>{" "}
        {preview.count === 1 ? "contact goes" : "contacts go"} to Max.
        {preview.withoutLinkedin > 0 && (
          <span className="block text-xs text-muted">
            {preview.withoutLinkedin} more in Enrich without a LinkedIn URL: add one on the contact first.
          </span>
        )}
      </p>
      <MaxExportForm disabled={preview.count === 0} />
    </div>
  );
}

async function Preview() {
  const preview = await getEnrichPreview(25);
  return (
    <>
      <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <h2 id="enrich-preview" className="font-display text-lg font-semibold text-brand-900">
          In Enrich
        </h2>
        {preview.count > 0 && (
          <p className="text-sm text-muted">
            The first {Math.min(25, preview.count)} of {preview.count}, highest ICP score first.
          </p>
        )}
      </div>
      {preview.rows.length === 0 ? (
        <EmptyState
          icon={PhoneMissed}
          title="Nobody to enrich"
          description="Contacts land here with status Enrich, for example after a wrong number, or when a company runs out of numbers after three attempts."
        />
      ) : (
        <>
          <MobileList label="Contacts to enrich" className="md:hidden">
            {preview.rows.map((r) => (
              <MobileListItem key={r.contactId} href={`/dashboard/leads/${r.companyId}`} title={r.name} subtitle={r.companyName} meta={r.title ?? undefined} />
            ))}
          </MobileList>
          <Table className="hidden md:block">
            <THead>
              <tr>
                <TH>Contact</TH>
                <TH>Company</TH>
                <TH>LinkedIn</TH>
              </tr>
            </THead>
            <TBody>
              {preview.rows.map((r) => (
                <TR key={r.contactId}>
                  <TD>
                    <span className="font-medium">{r.name}</span>
                    {r.title && <span className="block text-xs text-muted">{r.title}</span>}
                  </TD>
                  <TD>
                    <Link href={`/dashboard/leads/${r.companyId}`} className="text-brand-900 hover:text-brand-600 hover:underline">
                      {r.companyName}
                    </Link>
                  </TD>
                  <TD>
                    <a
                      href={linkedinUrl(r.linkedin)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-brand-700 hover:underline"
                    >
                      Profile
                      <ExternalLink className="size-3.5" aria-hidden="true" />
                    </a>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </>
      )}
    </>
  );
}
