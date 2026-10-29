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
  description: "Work: verstuur openstaande directe meldingen (vangnet, elk kwartier)",
  async run(ctx) {
    const result = await deliverNotifications("instant", ctx.db);
    ctx.countIn(result.claimed);
    ctx.countOut(result.mails);
    if (result.failed) ctx.log(`${result.failed} mails niet verstuurd, volgende ronde opnieuw`);
  },
});

export const workDaily = defineJob({
  name: "work-daily",
  description: "Work: deadlines, verlopen toegang, dagelijks overzicht per mail en de prullenbak legen",
  async run(ctx) {
    const { data: checks, error } = await ctx.db.rpc("work_daily_checks");
    if (error) throw new Error(`work_daily_checks: ${error.message}`);
    ctx.log(`controles: ${JSON.stringify(checks)}`);
    ctx.meta.checks = checks;

    // Deadline mails may be instant for some people; send those first.
    await deliverNotifications("instant", ctx.db);
    const digest = await deliverNotifications("digest", ctx.db);
    ctx.countIn(digest.claimed);
    ctx.countOut(digest.mails);
    ctx.log(`dagelijks overzicht: ${digest.mails} mails, ${digest.failed} mislukt`);

    // Trash older than 30 days: rows first, then their files.
    const { data: paths, error: purgeError } = await ctx.db.rpc("work_purge_trash");
    if (purgeError) throw new Error(`work_purge_trash: ${purgeError.message}`);
    const files = (paths ?? []) as unknown as (string | { work_purge_trash: string })[];
    const names = files.map((p) => (typeof p === "string" ? p : p.work_purge_trash));
    for (let i = 0; i < names.length; i += 100) {
      const { error: removeError } = await ctx.db.storage.from("work").remove(names.slice(i, i + 100));
      if (removeError) ctx.log(`bestanden verwijderen mislukt: ${removeError.message}`);
    }
    ctx.log(`prullenbak: ${names.length} bestanden verwijderd`);
  },
});

export const clickupImport = defineJob({
  name: "clickup-import",
  description: "Work: eenmalige import uit ClickUp (open taken en taken op review). --dry-run=true telt alleen",
  async run(ctx) {
    const token = process.env.CLICKUP_API_TOKEN;
    if (!token) throw new Error("CLICKUP_API_TOKEN ontbreekt (ClickUp > Settings > Apps > API Token).");
    let map: Record<string, string> | undefined;
    if (process.env.CLICKUP_IMPORT_MAP) {
      try {
        map = JSON.parse(process.env.CLICKUP_IMPORT_MAP) as Record<string, string>;
      } catch {
        throw new Error('CLICKUP_IMPORT_MAP is geen geldige JSON, bijvoorbeeld {"9012345":"nordavo"}');
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
    ctx.log(`klaar: ${JSON.stringify(counts)}`);
  },
});
