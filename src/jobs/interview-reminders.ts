import { defineJob, forEachSafe } from "@/lib/gtm/jobs";
import { escapeHtml, sendMail } from "@/lib/notify/mail";
import { isDueForReminder, reminderMail } from "@/lib/recruitment/interviews";

/**
 * Interview reminders (2.14): about 24 hours before a booked interview, one
 * mail to the candidate and one to the interviewer. Runs every hour; each
 * interview is reminded once (reminder_sent_at, cleared on a reschedule).
 * Override the window with --hours=36. Without Resend nothing is sent and
 * nothing is marked, so the reminder goes out once mail works.
 */
export const interviewReminders = defineJob({
  name: "interview-reminders",
  description: "Interviews: reminder to candidate and interviewer about 24 hours before",
  run: async (ctx) => {
    const hours = Math.min(Math.max(Number(ctx.params.hours) || 24, 1), 72);
    const now = new Date();
    const until = new Date(now.getTime() + hours * 3_600_000).toISOString();

    const { data, error } = await ctx.db
      .from("interviews")
      .select(
        "id, kind, status, starts_at, reminder_sent_at, interviewer:profiles!interviews_interviewer_id_fkey(full_name, email, time_zone), application:applications(candidate:candidates(id, full_name, email), vacancy:vacancies(title))",
      )
      .in("status", ["scheduled", "rescheduled"])
      .is("reminder_sent_at", null)
      .gt("starts_at", now.toISOString())
      .lte("starts_at", until);
    if (error) throw new Error(`Could not load interviews: ${error.message}`);

    const due = (data ?? []).filter((i) => isDueForReminder(i, now, hours));
    ctx.countIn(due.length);
    if (due.length === 0) {
      ctx.log("No interviews to remind.");
      return;
    }
    if (!process.env.RESEND_API_KEY || !process.env.MAIL_FROM) {
      ctx.log(`${due.length} interviews due, but RESEND_API_KEY or MAIL_FROM is missing: nothing sent.`);
      ctx.meta.mail_missing = true;
      return;
    }

    const site = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
    await forEachSafe(ctx, due, (i) => i.id, async (interview) => {
      const candidate = interview.application?.candidate;
      const vacancyTitle = interview.application?.vacancy?.title ?? "the vacancy";
      const interviewerName = interview.interviewer?.full_name || interview.interviewer?.email || "Nordavo";
      const base = {
        candidateName: candidate?.full_name ?? "the candidate",
        vacancyTitle,
        interviewerName,
        kind: interview.kind,
        startsAt: interview.starts_at!,
      };

      let sent = 0;
      if (candidate?.email) {
        const mail = reminderMail(escapeHtml, { ...base, to: "candidate", timeZone: "Asia/Kolkata" });
        if (await sendMail({ category: "interview_reminder", to: candidate.email, ...mail })) sent += 1;
      }
      if (interview.interviewer?.email) {
        const mail = reminderMail(escapeHtml, {
          ...base,
          to: "interviewer",
          timeZone: interview.interviewer.time_zone || "Europe/Amsterdam",
          portalUrl: site && candidate ? `${site}/dashboard/candidates/${candidate.id}` : undefined,
        });
        if (await sendMail({ category: "interview_reminder", to: interview.interviewer.email, ...mail })) sent += 1;
      }
      if (sent === 0) throw new Error("no reminder could be sent");

      const { error: updateError } = await ctx.db
        .from("interviews")
        .update({ reminder_sent_at: new Date().toISOString() })
        .eq("id", interview.id);
      if (updateError) throw new Error(updateError.message);
      ctx.countOut(sent);
    });
    ctx.log(`Reminders done for ${due.length} interviews.`);
  },
});
