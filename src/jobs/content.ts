import "server-only";
import { defineJob } from "@/lib/gtm/jobs";
import type { Json } from "@/lib/database.types";
import { runContentEvents } from "@/lib/content/events";
import { deliverContentMail, sendWeeklySummaries } from "@/lib/content/notify";

/**
 * Content module jobs (docs/content.md). Mails for status changes go out
 * right after the change; content-notify runs every hour for the checks
 * (tomorrow's unapproved posts, missing URLs, results due, buffer and
 * rhythm), the internal event handlers and whatever mail is still queued.
 */
export const contentNotify = defineJob({
  name: "content-notify",
  description: "Content: hourly checks, event handlers and pending notification mails",
  async run(ctx) {
    const { data: checks, error } = await ctx.db.rpc("content_run_checks", {});
    if (error) throw new Error(`content_run_checks: ${error.message}`);
    ctx.meta.checks = checks as Json;
    ctx.log(`checks: ${JSON.stringify(checks)}`);

    const events = await runContentEvents(ctx.db, ctx.log);
    ctx.meta.events = events;
    ctx.log(`events: ${events.events} claimed, ${events.handled} handled, ${events.failed} failed`);

    const mail = await deliverContentMail(ctx.db);
    ctx.countIn(mail.claimed);
    ctx.countOut(mail.mails);
    if (mail.failed) ctx.log(`${mail.failed} mails not sent, retrying next round`);
  },
});

export const contentWeekly = defineJob({
  name: "content-weekly",
  description: "Content: Monday morning summary of what goes live this week and what is still missing",
  async run(ctx) {
    const result = await sendWeeklySummaries(ctx.db);
    ctx.countIn(result.users);
    ctx.countOut(result.mails);
    ctx.log(`summary: ${result.mails} mails to ${result.users} people`);
  },
});
