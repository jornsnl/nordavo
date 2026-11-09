import { env } from "@/lib/env";
import { defineJob, forEachSafe } from "@/lib/gtm/jobs";
import { stuckReminderMail } from "@/lib/academy/ats/mail";
import { processAtsEvents } from "@/lib/academy/ats/process";
import { sendMail } from "@/lib/notify/mail";

// Scheduled jobs of the Academy and ATS link (docs/academy.md,
// ATS-koppeling). Run with `npm run job -- <name> [--dry-run=1]` or POST
// /api/jobs/<name>; scheduled in .github/workflows/academy-ats-jobs.yml.
// Every run is logged in job_runs (runJob); failures mail Julius.

const dryRunOf = (params: Record<string, string>) => params["dry-run"] === "1" || params["dry-run"] === "true";

/**
 * Hourly safety net for the ATS automation: placements, enrolments from
 * the ATS and vacancy groups, top candidate mails that the app could not
 * finish right away (no secret key at that moment, mail down, a bug).
 */
export const academyAtsSync = defineJob({
  name: "academy-ats-sync",
  description: "Academy: finish the ATS automation (placed, enrolments, top candidate mails)",
  run: async (ctx) => {
    if (dryRunOf(ctx.params)) {
      const { count } = await ctx.db.from("academy_ats_events").select("id", { count: "exact", head: true }).eq("status", "pending");
      ctx.meta.pending = count ?? 0;
      ctx.log(`${count ?? 0} events pending; dry run, nothing done.`);
      return;
    }
    const limit = Number(ctx.params.limit ?? "500");
    const summary = await processAtsEvents(ctx.db, { limit: Number.isFinite(limit) ? limit : 500, log: ctx.log });
    ctx.countIn(summary.seen);
    ctx.countOut(summary.done);
    ctx.meta.summary = summary;
    ctx.log(`${summary.done} done, ${summary.skipped} skipped, ${summary.failed} failed.`);
  },
});

/**
 * Candidates who get stuck: no activity for reminder_after_days, at most
 * reminder_max reminders since their last activity, reminder_repeat_days
 * apart (settings on /dashboard/academy/automation). A notification in the
 * app and a mail with the next lesson. Daily.
 */
export const academyReminders = defineJob({
  name: "academy-reminders",
  description: "Academy: remind candidates who got stuck, with their next lesson",
  run: async (ctx) => {
    const dryRun = dryRunOf(ctx.params);
    const { data, error } = await ctx.db.rpc("academy_stuck_candidates", {});
    if (error) throw new Error(`Could not load stuck candidates: ${error.message}`);
    ctx.countIn(data.length);
    ctx.meta.due = data.length;
    if (dryRun) {
      ctx.log(`${data.length} reminders due; dry run, nothing sent.`);
      return;
    }
    const site = env.siteUrl().replace(/\/$/, "");
    const result = await forEachSafe(
      ctx,
      data,
      (row) => `person ${row.profile_id}`,
      async (row) => {
        const path = `/academy/courses/${row.course_id}/lessons/${row.next_lesson_id}`;
        const mail = stuckReminderMail({
          name: row.full_name,
          locale: row.locale,
          courseTitle: row.course_title,
          lessonTitle: row.next_lesson_title,
          url: `${site}${path}`,
          daysInactive: row.days_inactive,
        });
        const mailed = await sendMail({ category: "academy_reminder", to: row.email, ...mail });
        await ctx.db.rpc("academy_notify", {
          p_profile_id: row.profile_id,
          p_kind: "reminder",
          p_title: row.locale === "nl" ? "Je volgende les wacht" : "Your next lesson is waiting",
          p_body: row.next_lesson_title,
          p_link: path,
          p_payload: { lesson_id: row.next_lesson_id },
        });
        const { error: logError } = await ctx.db.from("academy_reminders").insert({
          profile_id: row.profile_id,
          course_id: row.course_id,
          lesson_id: row.next_lesson_id,
          days_inactive: row.days_inactive,
          mailed,
        });
        if (logError) throw new Error(logError.message);
        ctx.countOut();
      },
    );
    ctx.log(`${result.ok} reminders, ${result.failed} failed.`);
  },
});

/**
 * Retention: the Academy data of candidates who were never placed, after
 * the talent pool retention period without activity (settings). Careful by
 * design: a dry run (only counted and logged) unless retention is switched
 * on in the settings and the run is not a dry run; at most `limit` people
 * per run (default 50); each person is checked again in the database right
 * before anything happens. Anonymise: free text and files removed, name,
 * mail and the link to the ATS gone, the sign-in account renamed and
 * blocked; scores stay as anonymous numbers. Delete: the whole account and
 * all Academy data. The ATS candidate itself is not touched.
 */
export const academyRetention = defineJob({
  name: "academy-retention",
  description: "Academy: anonymise or delete Academy data of never placed candidates after the retention period",
  run: async (ctx) => {
    const { data: settings, error: settingsError } = await ctx.db.from("academy_ats_settings").select("*").maybeSingle();
    if (settingsError || !settings) throw new Error(`Could not load the settings: ${settingsError?.message ?? "missing"}`);
    const dryRun = dryRunOf(ctx.params) || !settings.retention_enabled;
    const limit = Math.min(Math.max(Number(ctx.params.limit ?? "50") || 50, 1), 500);
    // job_runs has the run; the log rows carry their own time.
    const runId: string | null = null;

    const { data, error } = await ctx.db.rpc("academy_retention_candidates", {});
    if (error) throw new Error(`Could not load the candidates: ${error.message}`);
    ctx.countIn(data.length);
    ctx.meta.due = data.length;
    ctx.meta.action = settings.retention_action;
    ctx.meta.dry_run = dryRun;

    if (dryRun) {
      for (const row of data.slice(0, limit)) {
        await ctx.db.rpc("academy_retention_note", {
          p_profile_id: row.profile_id,
          p_candidate_id: row.candidate_id,
          p_action: "dry_run",
          p_last: row.last_activity_at,
          p_detail: { would: settings.retention_action },
          p_job_run_id: runId,
        });
      }
      ctx.log(
        `${data.length} people past ${settings.retention_months} months; dry run${settings.retention_enabled ? "" : " (retention is off in the settings)"}, nothing changed.`,
      );
      return;
    }

    const result = await forEachSafe(
      ctx,
      data.slice(0, limit),
      (row) => `person ${row.profile_id}`,
      async (row) => {
        try {
          if (settings.retention_action === "delete") {
            // Checked again right before: still a candidate who qualifies.
            const { data: still } = await ctx.db.rpc("academy_retention_candidates", {});
            if (!still?.some((r) => r.profile_id === row.profile_id)) throw new Error("no longer qualifies");
            const paths = await listPersonFiles(ctx.db, row.profile_id);
            if (paths.length) await ctx.db.storage.from("attachments").remove(paths);
            const { error: deleteError } = await ctx.db.auth.admin.deleteUser(row.profile_id);
            if (deleteError) throw new Error(deleteError.message);
            await ctx.db.rpc("academy_retention_note", {
              p_profile_id: row.profile_id,
              p_candidate_id: row.candidate_id,
              p_action: "delete",
              p_last: row.last_activity_at,
              p_detail: { files: paths.length },
              p_job_run_id: runId,
            });
          } else {
            const { data: anonymised, error: anonError } = await ctx.db.rpc("academy_retention_anonymise", {
              p_profile_id: row.profile_id,
              p_job_run_id: runId,
            });
            if (anonError) throw new Error(anonError.message);
            const paths = asPaths(anonymised);
            if (paths.length) await ctx.db.storage.from("attachments").remove(paths);
            // The sign-in account: no personal address, blocked.
            const { error: userError } = await ctx.db.auth.admin.updateUserById(row.profile_id, {
              email: `anonymised-${row.profile_id}@invalid.nordavo.nl`,
              user_metadata: {},
              ban_duration: "876000h",
            });
            if (userError) throw new Error(`account: ${userError.message}`);
          }
          ctx.countOut();
        } catch (cause) {
          await ctx.db.rpc("academy_retention_note", {
            p_profile_id: row.profile_id,
            p_candidate_id: row.candidate_id,
            p_action: "failed",
            p_last: row.last_activity_at,
            p_detail: { error: cause instanceof Error ? cause.message.slice(0, 500) : "unknown" },
            p_job_run_id: runId,
          });
          throw cause;
        }
      },
    );
    ctx.log(`${result.ok} people ${settings.retention_action === "delete" ? "deleted" : "anonymised"}, ${result.failed} failed.`);
  },
});

function asPaths(value: unknown): string[] {
  const paths = value && typeof value === "object" && "paths" in value ? (value as { paths: unknown }).paths : null;
  return Array.isArray(paths) ? paths.filter((p): p is string => typeof p === "string" && p.startsWith("academy/")) : [];
}

async function listPersonFiles(db: Parameters<typeof processAtsEvents>[0], profileId: string): Promise<string[]> {
  const [subs, certs] = await Promise.all([
    db.from("academy_assignment_submissions").select("file_path").eq("profile_id", profileId).not("file_path", "is", null),
    db.from("academy_certificates").select("storage_path").eq("profile_id", profileId).not("storage_path", "is", null),
  ]);
  return [...(subs.data ?? []).map((s) => s.file_path), ...(certs.data ?? []).map((c) => c.storage_path)].filter(
    (p): p is string => typeof p === "string" && p.startsWith("academy/"),
  );
}
