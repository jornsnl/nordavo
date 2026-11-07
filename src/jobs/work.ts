import "server-only";
import { defineJob } from "@/lib/gtm/jobs";
import { importFromClickUp } from "@/lib/work/clickup";
import { deliverNotifications } from "@/lib/work/notify";

/**
 * Task tool (Work) jobs. Instant mails normally go out right after the change
 * that caused them; work-notify catches whatever that missed.
 */
export const workNotify = defineJob({
  name: "work-notify",
  description: "Work: send pending instant notifications (safety net, every 15 minutes)",
  async run(ctx) {
    const result = await deliverNotifications("instant", ctx.db);
    ctx.countIn(result.claimed);
    ctx.countOut(result.mails);
    if (result.failed) ctx.log(`${result.failed} mails not sent, retrying next round`);
  },
});

export const workDaily = defineJob({
  name: "work-daily",
  description: "Work: deadlines, expired access, the daily mail digest and emptying the trash",
  async run(ctx) {
    const { data: checks, error } = await ctx.db.rpc("work_daily_checks");
    if (error) throw new Error(`work_daily_checks: ${error.message}`);
    ctx.log(`checks: ${JSON.stringify(checks)}`);
    ctx.meta.checks = checks;

    // Deadline mails may be instant for some people; send those first.
    await deliverNotifications("instant", ctx.db);
    const digest = await deliverNotifications("digest", ctx.db);
    ctx.countIn(digest.claimed);
    ctx.countOut(digest.mails);
    ctx.log(`daily digest: ${digest.mails} mails, ${digest.failed} failed`);

    // Trash older than 30 days: rows first, then their files.
    const { data: paths, error: purgeError } = await ctx.db.rpc("work_purge_trash");
    if (purgeError) throw new Error(`work_purge_trash: ${purgeError.message}`);
    const files = (paths ?? []) as unknown as (string | { work_purge_trash: string })[];
    const names = files.map((p) => (typeof p === "string" ? p : p.work_purge_trash));
    for (let i = 0; i < names.length; i += 100) {
      const { error: removeError } = await ctx.db.storage.from("work").remove(names.slice(i, i + 100));
      if (removeError) ctx.log(`could not remove files: ${removeError.message}`);
    }
    ctx.log(`trash: ${names.length} files removed`);
  },
});

export const clickupImport = defineJob({
  name: "clickup-import",
  description: "Work: one-off import from ClickUp (open tasks and tasks in review). --dry-run=true only counts",
  async run(ctx) {
    const token = process.env.CLICKUP_API_TOKEN;
    if (!token) throw new Error("CLICKUP_API_TOKEN is missing (ClickUp > Settings > Apps > API Token).");
    let map: Record<string, string> | undefined;
    if (process.env.CLICKUP_IMPORT_MAP) {
      try {
        map = JSON.parse(process.env.CLICKUP_IMPORT_MAP) as Record<string, string>;
      } catch {
        throw new Error('CLICKUP_IMPORT_MAP is not valid JSON, for example {"9012345":"nordavo"}');
      }
    }
    const counts = await importFromClickUp({
      token,
      db: ctx.db,
      map,
      dryRun: ctx.params["dry-run"] === "true",
      projectVisibility: ctx.params.private === "true" ? "private" : "open",
      log: ctx.log,
    });
    ctx.meta.counts = counts;
    ctx.countIn(counts.tasks + counts.skipped);
    ctx.countOut(counts.tasks);
    ctx.log(`done: ${JSON.stringify(counts)}`);
  },
});
