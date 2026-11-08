import { connection } from "next/server";
import { requireModule } from "@/lib/auth";
import { isRecruitmentPeriod, recruitmentPeriods, recruitmentReportCsv } from "@/lib/recruitment/report";
import { loadRecruitmentReport } from "@/lib/recruitment/report-data";
import { createClient } from "@/lib/supabase/server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The recruitment report as CSV (2.16), with the filters of the report page:
 *   GET /dashboard/report/recruitment-csv?rperiod=90-days&vacancy=<uuid>
 * Signed-in team members with the report and recruitment modules; the rows
 * are read with their own session, so RLS applies.
 */
export async function GET(request: Request) {
  await connection();
  await requireModule("report");
  await requireModule("recruitment");

  const params = new URL(request.url).searchParams;
  const rperiod = params.get("rperiod");
  const period = isRecruitmentPeriod(rperiod) ? rperiod : "90-days";
  const vacancyParam = params.get("vacancy");
  const vacancyId = vacancyParam && UUID_RE.test(vacancyParam) ? vacancyParam : null;

  const supabase = await createClient();
  const { report, vacancies } = await loadRecruitmentReport(supabase, { period, vacancyId });
  const vacancy = vacancyId ? vacancies.find((v) => v.id === vacancyId) : null;
  const periodLabel = recruitmentPeriods.find((p) => p.value === period)?.label ?? period;
  const today = new Date().toISOString().slice(0, 10);
  const heading = `Nordavo recruitment report, ${vacancy ? vacancy.title : "all vacancies"}, ${periodLabel.toLowerCase()}, ${today}`;

  // A BOM so Excel reads the file as UTF-8.
  return new Response(`﻿${recruitmentReportCsv(report, heading)}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="recruitment-report-${period}-${today}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
