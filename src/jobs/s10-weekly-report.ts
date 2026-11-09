import type { Json } from "@/lib/database.types";
import { defineJob } from "@/lib/gtm/jobs";
import { buildWeeklyReport, renderReportHtml, reportSubject } from "@/lib/gtm/report";
import { sendMail } from "@/lib/notify/mail";

/**
 * S10: weekly report to Julius, every Friday. Covers the last 7 days
 * (override with --days=14). Calls, reach, mails and replies come from
 * Activities, the pipeline from the companies and meetings from the Meetings
 * register (src/lib/sales/stats.ts). The numbers are stored in job_runs.meta.
 */
export const s10WeeklyReport = defineJob({
  name: "s10-weekly-report",
  description: "S10: weekly report to Julius",
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
      pipeline: report.pipeline,
      perCaller: report.perCaller,
      repliesToReview: report.repliesToReview,
      goPerSegment: report.goPerSegment,
      attribution: report.attribution,
      warnings: report.warnings,
      openVacancies: report.leadTimes.length,
    } as unknown as Json;

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
    const sent = await sendMail({
      category: "weekly_report",
      to: process.env.REPORT_EMAIL_TO,
      subject: reportSubject(report),
      html: renderReportHtml(report, siteUrl ? `${siteUrl.replace(/\/$/, "")}/dashboard/report?periode=deze-week` : undefined),
    });
    ctx.meta.mail_sent = sent;
    if (!sent) {
      throw new Error("Weekly report not sent: check RESEND_API_KEY, MAIL_FROM and REPORT_EMAIL_TO. The numbers are in job_runs.meta.");
    }
    ctx.countOut();
    ctx.log(`Weekly report sent: ${report.meetings.planned} meetings, ${report.activity.calls} calls, ${report.warnings.length} warnings.`);
  },
});
