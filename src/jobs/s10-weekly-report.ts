import type { Json } from "@/lib/database.types";
import { defineJob } from "@/lib/gtm/jobs";
import { buildWeeklyReport, renderReportHtml, reportSubject } from "@/lib/gtm/report";
import { sendMail } from "@/lib/notify/mail";

/**
 * S10: weekly report to Julius, every Friday. Covers the last 7 days
 * (override with --days=14). The numbers are stored in job_runs.meta.
 */
export const s10WeeklyReport = defineJob({
  name: "s10-weekly-report",
  description: "S10: weekrapport naar Julius",
  run: async (ctx) => {
    const days = Number(ctx.params.days) || 7;
    const now = new Date();
    const from = new Date(now.getTime() - days * 86_400_000).toISOString();
    const report = await buildWeeklyReport(ctx.db, { from, to: now.toISOString() }, now);

    ctx.countIn(report.newCompanies);
    ctx.meta.report = {
      period: report.period,
      newCompanies: report.newCompanies,
      activity: report.activity,
      meetings: report.meetings,
      goPerSegment: report.goPerSegment,
      attribution: report.attribution,
      warnings: report.warnings,
      openVacancies: report.leadTimes.length,
    } as unknown as Json;

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
    const sent = await sendMail({
      to: process.env.REPORT_EMAIL_TO,
      subject: reportSubject(report),
      html: renderReportHtml(report, siteUrl ? `${siteUrl.replace(/\/$/, "")}/dashboard/rapport?periode=deze-week` : undefined),
    });
    ctx.meta.mail_sent = sent;
    if (!sent) {
      throw new Error("Weekrapport niet verstuurd: controleer RESEND_API_KEY, MAIL_FROM en REPORT_EMAIL_TO. De cijfers staan in job_runs.meta.");
    }
    ctx.countOut();
    ctx.log(`Weekrapport verstuurd: ${report.meetings} afspraken, ${report.warnings.length} waarschuwingen.`);
  },
});
