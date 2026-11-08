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
import { IfModule } from "@/components/dashboard/if-module";
import { RecruitmentReportSection } from "@/components/report/recruitment-report";
import { ListSkeleton } from "@/components/ui/skeleton";
import { requireModule, requireStaff } from "@/lib/auth";
import { isRecruitmentPeriod } from "@/lib/recruitment/report";
import { loadRecruitmentReport } from "@/lib/recruitment/report-data";
import { formatDate } from "@/lib/format";
import { buildWeeklyReport, isReportPeriod, periodRange, reportPeriods, type ReportPeriodKey } from "@/lib/gtm/report";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Report",
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function readPeriod(params: Record<string, string | string[] | undefined>): ReportPeriodKey {
  return isReportPeriod(params.periode) ? params.periode : "deze-week";
}

export default function Page({ searchParams }: { searchParams: SearchParams }) {
  return (
    <>
      <PageHeader
        eyebrow="Report"
        title="Report"
        description="Sales: what the outreach delivers and which signal, segment and channel produced it, plus the lead time of open vacancies. Recruitment: the hiring report per vacancy, source and origin."
        actions={
          <Suspense fallback={<PeriodSelectorSkeleton />}>
            <IfModule module="sales">
              <Period searchParams={searchParams} />
            </IfModule>
          </Suspense>
        }
      />
      <Suspense fallback={<ReportSkeleton />}>
        <IfModule module="sales">
          <ReportContent searchParams={searchParams} />
        </IfModule>
      </Suspense>
      <Suspense fallback={<ListSkeleton rows={4} />}>
        <IfModule module="recruitment">
          <RecruitmentContent searchParams={searchParams} />
        </IfModule>
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
        {label}: {formatDate(range.from)} to {formatDate(range.to)}.
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Recruitment (2.16): its own period (rperiod) and an optional vacancy. */
async function RecruitmentContent({ searchParams }: { searchParams: SearchParams }) {
  await requireModule("recruitment");
  const params = await searchParams;
  const period = isRecruitmentPeriod(params.rperiod) ? params.rperiod : "90-days";
  const vacancyId = typeof params.vacancy === "string" && UUID_RE.test(params.vacancy) ? params.vacancy : null;
  const supabase = await createClient();
  const { report, vacancies } = await loadRecruitmentReport(supabase, { period, vacancyId });
  return (
    <RecruitmentReportSection
      report={report}
      vacancies={vacancies}
      filters={{ period, vacancyId, salesPeriod: isReportPeriod(params.periode) ? params.periode : undefined }}
    />
  );
}
