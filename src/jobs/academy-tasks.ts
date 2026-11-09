import { defineJob } from "@/lib/gtm/jobs";

/**
 * Academy: reminders for overdue course tasks (Academy: takenblok). The
 * database finds every task instance past its real deadline (start date
 * plus the task's offset, in the person's time zone; shared tasks per
 * placement) and sends an in-app notification (academy_notify): personal
 * tasks to the person, shared tasks to whoever ticks them in the placement
 * (client admin, client member, developer). At most three reminders per
 * task, a week apart. The mail summary of notifications (digest) takes them
 * along. Nordavo sees the overdue tasks in /dashboard/academy/tasks.
 *
 *   npm run job -- academy-task-reminders
 *
 * Runs daily (.github/workflows/academy-task-reminders.yml, POST
 * /api/jobs/academy-task-reminders with CRON_SECRET).
 */
export const academyTaskReminders = defineJob({
  name: "academy-task-reminders",
  description: "Academy: reminder notifications for overdue course tasks (at most three, a week apart)",
  run: async (ctx) => {
    const { data, error } = await ctx.db.rpc("academy_remind_overdue_tasks");
    if (error) throw new Error(`Could not send the task reminders: ${error.message}`);
    const count = typeof data === "number" ? data : 0;
    ctx.countOut(count);
    ctx.meta.reminded = count;
    ctx.log(`${count} overdue tasks reminded.`);
  },
});
