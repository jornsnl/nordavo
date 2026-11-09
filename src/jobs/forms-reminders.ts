import { env } from "@/lib/env";
import { defineJob, forEachSafe } from "@/lib/gtm/jobs";
import { applyUrl, reminderMail } from "@/lib/forms/mail-content";
import { localDate, reminderDue } from "@/lib/forms/reminders";
import { hasRecruitmentMail, recruitmentFrom, sendMail } from "@/lib/notify/mail";

/**
 * Forms: remind candidates who did not fill in the application form by the
 * deadline (recruitment brief 2.9). One mail per candidate with their
 * personal link, CC as on the original mail. Never spams: at most the
 * number of reminders set on the form, that many days apart, and never once
 * the candidate filled in, moved on, or was parked or rejected.
 *
 *   npm run job -- forms-reminders [--dry-run=1]
 *
 * Run daily (POST /api/jobs/forms-reminders with CRON_SECRET). Without
 * RESEND_API_KEY it only counts who would get a reminder.
 */
export const formsReminders = defineJob({
  name: "forms-reminders",
  description: "Forms: reminder mail to candidates who did not fill in the form by the deadline",
  run: async (ctx) => {
    const now = new Date();
    const dryRun = ctx.params["dry-run"] === "1" || ctx.params["dry-run"] === "true";
    const mail = hasRecruitmentMail();

    const { data, error } = await ctx.db
      .from("form_invites")
      .select(
        "id, application_id, cc, deadline, sent_at, completed_at, reminded_at, reminder_count, token, form:recruitment_forms(status, max_reminders, reminder_interval_days, vacancy:vacancies(title)), application:applications(stage, candidate:candidates(full_name, email))",
      )
      .is("completed_at", null)
      .not("sent_at", "is", null)
      .lt("deadline", localDate(now))
      .limit(2000);
    if (error) throw new Error(`Could not load the invites: ${error.message}`);
    ctx.countIn(data.length);

    const due = data.filter(
      (i) =>
        i.form?.status === "published" &&
        reminderDue(
          {
            sentAt: i.sent_at,
            deadline: i.deadline,
            completedAt: i.completed_at,
            remindedAt: i.reminded_at,
            reminderCount: i.reminder_count,
            stage: i.application?.stage ?? "rejected",
            email: i.application?.candidate?.email ?? null,
          },
          { maxReminders: i.form.max_reminders, intervalDays: i.form.reminder_interval_days },
          now,
        ),
    );
    ctx.meta.due = due.length;
    if (!mail || dryRun) {
      ctx.log(`${due.length} reminders due; ${dryRun ? "dry run" : "mail is not configured (RESEND_API_KEY)"}, nothing sent.`);
      return;
    }

    const siteUrl = env.siteUrl();
    const result = await forEachSafe(
      ctx,
      due,
      (i) => `invite ${i.id}`,
      async (i) => {
        const candidate = i.application!.candidate!;
        const content = reminderMail({
          candidateName: candidate.full_name,
          vacancyTitle: i.form?.vacancy?.title ?? "the role",
          link: applyUrl(siteUrl, i.token),
          deadline: i.deadline,
        });
        const ok = await sendMail({ category: "form_reminder", to: candidate.email!, cc: i.cc ?? undefined, from: recruitmentFrom(), ...content });
        if (!ok) throw new Error("mail not sent");
        const at = new Date().toISOString();
        await ctx.db.from("form_invites").update({ reminded_at: at, reminder_count: i.reminder_count + 1 }).eq("id", i.id);
        await ctx.db.from("applications").update({ form_reminded_at: at }).eq("id", i.application_id);
        ctx.countOut();
      },
    );
    ctx.log(`${result.ok} reminders sent, ${result.failed} failed.`);
  },
});
