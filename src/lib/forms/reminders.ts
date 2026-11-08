import type { ApplicationStage } from "@/lib/database.types";

/**
 * When the reminder job may mail someone (recruitment brief 2.9). Pure, so
 * the "never spam" rules are unit tested:
 *
 * - only invites that were sent, have a deadline and are not filled in;
 * - only after the deadline day has passed;
 * - at most maxReminders, at least intervalDays apart;
 * - not when the candidate already moved on, or was parked or rejected.
 */

export const REMINDER_STAGES: ApplicationStage[] = ["sourced", "techstack_check", "fill_out"];

export type InviteState = {
  sentAt: string | null;
  deadline: string | null;
  completedAt: string | null;
  remindedAt: string | null;
  reminderCount: number;
  stage: ApplicationStage;
  email: string | null;
};

export type ReminderPolicy = { maxReminders: number; intervalDays: number };

/** YYYY-MM-DD of a moment in a time zone. */
export function localDate(at: Date, timeZone = "Europe/Amsterdam") {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

export function reminderDue(invite: InviteState, policy: ReminderPolicy, now: Date): boolean {
  if (!invite.sentAt || !invite.deadline || invite.completedAt) return false;
  if (!invite.email) return false;
  if (!REMINDER_STAGES.includes(invite.stage)) return false;
  if (invite.reminderCount >= policy.maxReminders) return false;
  if (localDate(now) <= invite.deadline) return false;
  if (invite.remindedAt) {
    const days = (now.getTime() - new Date(invite.remindedAt).getTime()) / 86_400_000;
    if (days < policy.intervalDays) return false;
  }
  return true;
}

/** Split "a@x.nl, b@y.nl; c@z.nl" into clean, unique addresses. */
export function parseAddressList(value: string | null | undefined): string[] {
  if (!value) return [];
  const seen = new Set<string>();
  return value
    .split(/[,;\s]+/)
    .map((a) => a.trim().toLowerCase())
    .filter((a) => {
      if (!a || seen.has(a) || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a)) return false;
      seen.add(a);
      return true;
    });
}
