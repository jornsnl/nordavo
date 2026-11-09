import { defineJob } from "@/lib/gtm/jobs";
import { processWspOutbox } from "@/lib/wsp/outbox";

/**
 * Working Style Profile, daily (docs/working-style-profile.md): links older
 * than 14 days expire, one reminder 3 days after an invitation that was not
 * started, and retention: delete_after is recomputed and every profile that
 * is due is deleted (everything except one audit row without content).
 * Then the mail of all that is sent.
 *
 *   npm run job -- wsp-daily
 *
 * Daily at 07:00 Amsterdam (.github/workflows/wsp-jobs.yml).
 */
export const wspDaily = defineJob({
  name: "wsp-daily",
  description: "Working style profile: expire links, one reminder after 3 days, retention (delete what is due)",
  run: async (ctx) => {
    const { data, error } = await ctx.db.rpc("wsp_run_daily");
    if (error) throw new Error(`The daily run failed: ${error.message}`);
    const counts = (data ?? {}) as { expired?: number; reminded?: number; deleted?: number };
    ctx.meta.expired = counts.expired ?? 0;
    ctx.meta.reminded = counts.reminded ?? 0;
    ctx.meta.deleted = counts.deleted ?? 0;
    ctx.log(`${counts.expired ?? 0} links expired, ${counts.reminded ?? 0} reminders, ${counts.deleted ?? 0} profiles deleted (retention).`);
    const mail = await processWspOutbox(ctx.db, { log: ctx.log });
    ctx.countOut(mail.sent);
    ctx.meta.mail = mail;
  },
});

/**
 * Working Style Profile mail still waiting in the outbox (for example when
 * the app could not send right after the action, or mail was not configured
 * yet). Every hour.
 *
 *   npm run job -- wsp-mail
 */
export const wspMail = defineJob({
  name: "wsp-mail",
  description: "Working style profile: send mail waiting in the outbox (invitations, reminders, permission requests, withdrawals)",
  run: async (ctx) => {
    const summary = await processWspOutbox(ctx.db, { log: ctx.log });
    ctx.countOut(summary.sent);
    ctx.meta.mail = summary;
    ctx.log(`${summary.sent} sent, ${summary.skipped} skipped, ${summary.failed} failed, ${summary.waiting} waiting for mail settings.`);
  },
});
