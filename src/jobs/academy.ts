import "server-only";
import { env } from "@/lib/env";
import { defineJob, forEachSafe } from "@/lib/gtm/jobs";
import { safeZone } from "@/lib/academy/time";
import { DIGEST_MAX_ITEMS, digestDue, digestMail } from "@/lib/academy/media/digest";
import { runTranscription } from "@/lib/academy/media/transcribe-run";
import { transcriptionProvider } from "@/lib/academy/media/transcription";
import { sendMail } from "@/lib/notify/mail";

/**
 * Academy jobs of the media area (docs/academy.md).
 *
 *   academy-digest      hourly: the mail summary of unread notifications,
 *                       daily or weekly as each person chose, from 08:00 in
 *                       their own time zone. Without RESEND_API_KEY the mail
 *                       is logged (sendMail) and nothing is marked as sent,
 *                       so it goes out once mail works. --dry-run=1 only counts.
 *   academy-transcribe  safety net for automatic transcripts: versions still
 *                       pending (the upload's own run was cut off) are done
 *                       again. Without a provider key it does nothing.
 */
export const academyDigest = defineJob({
  name: "academy-digest",
  description: "Academy: daily or weekly mail summary of notifications, at 08:00 in each person's time zone",
  async run(ctx) {
    const now = new Date();
    const dryRun = ctx.params["dry-run"] === "1" || ctx.params["dry-run"] === "true";
    const { data: members, error } = await ctx.db
      .from("academy_members")
      .select("profile_id, locale, digest_frequency, digest_sent_at")
      .neq("digest_frequency", "off")
      .limit(10_000);
    if (error) throw new Error(`academy_members: ${error.message}`);

    const ids = (members ?? []).map((m) => m.profile_id);
    const profiles = new Map<string, { full_name: string | null; email: string | null; time_zone: string | null }>();
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await ctx.db.from("profiles").select("id, full_name, email, time_zone").in("id", ids.slice(i, i + 200));
      for (const p of data ?? []) profiles.set(p.id, p);
    }

    const due = (members ?? []).filter((m) =>
      digestDue({ frequency: m.digest_frequency, sentAt: m.digest_sent_at, timeZone: safeZone(profiles.get(m.profile_id)?.time_zone) }, now),
    );
    ctx.countIn(due.length);
    if (due.length === 0) {
      ctx.log("nobody is due");
      return;
    }

    // Unread notifications not yet in a summary, of the last 30 days.
    const since = new Date(now.getTime() - 30 * 86_400_000).toISOString();
    const byProfile = new Map<string, { id: string; title: string; body: string | null; link: string | null; created_at: string }[]>();
    const dueIds = due.map((m) => m.profile_id);
    for (let i = 0; i < dueIds.length; i += 200) {
      const { data, error: nError } = await ctx.db
        .from("academy_notifications")
        .select("id, profile_id, title, body, link, created_at")
        .in("profile_id", dueIds.slice(i, i + 200))
        .is("read_at", null)
        .is("digested_at", null)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(5000);
      if (nError) throw new Error(`academy_notifications: ${nError.message}`);
      for (const n of data ?? []) byProfile.set(n.profile_id, [...(byProfile.get(n.profile_id) ?? []), n]);
    }

    const withNews = due.filter((m) => (byProfile.get(m.profile_id)?.length ?? 0) > 0 && profiles.get(m.profile_id)?.email);
    ctx.log(`${due.length} due, ${withNews.length} with new notifications${dryRun ? " (dry run)" : ""}`);
    if (dryRun) return;

    let notSent = 0;
    const result = await forEachSafe(
      ctx,
      withNews,
      (m) => m.profile_id,
      async (m) => {
        const profile = profiles.get(m.profile_id)!;
        const items = byProfile.get(m.profile_id) ?? [];
        const mail = digestMail({
          name: profile.full_name || profile.email || "",
          locale: m.locale,
          frequency: m.digest_frequency === "daily" ? "daily" : "weekly",
          items: items.slice(0, DIGEST_MAX_ITEMS).map((n) => ({ title: n.title, body: n.body, link: n.link, createdAt: n.created_at })),
          total: items.length,
          timeZone: safeZone(profile.time_zone),
          siteUrl: env.siteUrl(),
        });
        const sent = await sendMail({ to: profile.email!, subject: mail.subject, html: mail.html, text: mail.text, category: "academy_digest" });
        if (!sent) {
          notSent += 1;
          return;
        }
        const stamp = new Date().toISOString();
        const ids = items.map((n) => n.id);
        for (let i = 0; i < ids.length; i += 200) {
          await ctx.db.from("academy_notifications").update({ digested_at: stamp }).in("id", ids.slice(i, i + 200));
        }
        await ctx.db.from("academy_members").update({ digest_sent_at: stamp }).eq("profile_id", m.profile_id);
        ctx.countOut();
      },
    );
    if (notSent) ctx.log(`${notSent} summaries not sent (RESEND_API_KEY or MAIL_FROM missing, or Resend refused); they go out on a later run`);
    ctx.meta.digest = { due: due.length, withNews: withNews.length, sent: result.ok - notSent, failed: result.failed, notSent };
  },
});

export const academyTranscribe = defineJob({
  name: "academy-transcribe",
  description: "Academy: finish automatic video transcripts that are still pending",
  async run(ctx) {
    if (!transcriptionProvider()) {
      ctx.log("no transcription provider (OPENAI_API_KEY or DEEPGRAM_API_KEY): nothing to do");
      return;
    }
    // Pending for more than 20 minutes: the run after the upload did not finish.
    const before = new Date(Date.now() - 20 * 60_000).toISOString();
    const { data, error } = await ctx.db
      .from("academy_video_versions")
      .select("id, created_at")
      .eq("transcript_status", "pending")
      .lt("created_at", before)
      .limit(20);
    if (error) throw new Error(`academy_video_versions: ${error.message}`);
    ctx.countIn(data?.length ?? 0);
    await forEachSafe(
      ctx,
      data ?? [],
      (v) => v.id,
      async (v) => {
        const result = await runTranscription(ctx.db, v.id);
        if (result.ok) ctx.countOut();
        else ctx.log(`${v.id}: ${result.error}`);
      },
    );
  },
});
