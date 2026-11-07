import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/dashboard/page-header";
import { PeriodSelector, PeriodSelectorSkeleton } from "@/components/report/period-selector";
import {
  AttributionTables,
  EmptyReportHint,
  FunnelCard,
  GoPerSegmentCard,
  LeadTimeTable,
  ReportSkeleton,
  ReportStatCards,
  WarningsBanner,
} from "@/components/report/report-sections";
import { requireStaff } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { buildWeeklyReport, isReportPeriod, periodRange, reportPeriods, type ReportPeriodKey } from "@/lib/gtm/report";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Rapport",
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function readPeriod(params: Record<string, string | string[] | undefined>): ReportPeriodKey {
  return isReportPeriod(params.periode) ? params.periode : "deze-week";
}

export default function Page({ searchParams }: { searchParams: SearchParams }) {
  return (
    <>
      <PageHeader
        eyebrow="Sales"
        title="Rapport"
        description="Wat de outreach oplevert: benaderd, bereikt, replies en afspraken, en welk signaal, segment en kanaal ze opleverde. Plus de doorlooptijd van open vacatures."
        actions={
          <Suspense fallback={<PeriodSelectorSkeleton />}>
            <Period searchParams={searchParams} />
          </Suspense>
        }
      />
      <Suspense fallback={<ReportSkeleton />}>
        <ReportContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Period({ searchParams }: { searchParams: SearchParams }) {
  return <PeriodSelector current={readPeriod(await searchParams)} />;
}

async function ReportContent({ searchParams }: { searchParams: SearchParams }) {
  await requireStaff();
  const key = readPeriod(await searchParams);
  const range = periodRange(key);
  const supabase = await createClient();
  const report = await buildWeeklyReport(supabase, range);
  const label = reportPeriods.find((p) => p.value === key)?.label ?? "";
  const hasActivity = report.activity.approached + report.meetings + report.newCompanies > 0;

  return (
    <>
      <p className="mb-4 text-sm text-muted">
        {label}: {formatDate(range.from)} tot en met {formatDate(range.to)}.
      </p>
      <WarningsBanner warnings={report.warnings} />
      {!hasActivity && <EmptyReportHint />}
      <ReportStatCards report={report} />
      <div className="mb-8 grid gap-6 lg:grid-cols-2">
        <GoPerSegmentCard report={report} />
        <FunnelCard funnel={report.funnel} />
      </div>
      <AttributionTables report={report} />
      <LeadTimeTable rows={report.leadTimes} />
    </>
  );
}
