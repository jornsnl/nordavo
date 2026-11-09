import "server-only";
import { defineJob } from "@/lib/gtm/jobs";

/**
 * Academy placements (docs/academy.md, Plaatsingspagina, rituelen en pulse).
 * The logic is in the database, so the reminders follow each person's own
 * time zone and work the same from a test: these jobs only call it with the
 * service role. Notifications go through academy_notify() (the bell in the
 * Academy and the mail summary).
 *
 *   npm run job -- academy-rituals      hourly
 *   npm run job -- academy-placements   daily
 */
export const academyRituals = defineJob({
  name: "academy-rituals",
  description: "Academy: rituals of new course rituals and members, and reminders when a ritual did not happen (from 16:00 local time)",
  async run(ctx) {
    const { data: copied, error: copyError } = await ctx.db.rpc("academy_ensure_all_placement_rituals");
    if (copyError) throw new Error(`academy_ensure_all_placement_rituals: ${copyError.message}`);
    const { data: sent, error } = await ctx.db.rpc("academy_send_ritual_reminders", {});
    if (error) throw new Error(`academy_send_ritual_reminders: ${error.message}`);
    ctx.meta.copied = copied ?? 0;
    ctx.countOut(sent ?? 0);
    ctx.log(`${copied ?? 0} rituals copied to placements, ${sent ?? 0} reminders.`);
  },
});

export const academyPlacements = defineJob({
  name: "academy-placements",
  description: "Academy: pulse rounds every two weeks, pulse reminders after three days, review forms when a moment of the timeline is due",
  async run(ctx) {
    const today = ctx.params.today && /^\d{4}-\d{2}-\d{2}$/.test(ctx.params.today) ? ctx.params.today : null;
    const { data, error } = await ctx.db.rpc("academy_open_pulse_rounds", { p_today: today });
    if (error) throw new Error(`academy_open_pulse_rounds: ${error.message}`);
    const result = data ?? { opened: 0, reminded: 0, reviews: 0 };
    ctx.meta.result = result;
    ctx.countOut(result.opened + result.reminded + result.reviews);
    ctx.log(`${result.opened} pulses opened, ${result.reminded} reminded, ${result.reviews} review moments announced.`);
  },
});
