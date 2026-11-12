/**
 * T6 lead time: days from intake to profiles sent, against the promise
 * "3 candidates within 3 weeks". Pure, used in the list, detail and tests.
 * Talent pool vacancies have no clock.
 */

import { daysOnHold, type HoldPeriod } from "@/lib/recruitment/vacancy-time";

export type LeadTimeLevel = "none" | "ok" | "warning" | "danger" | "done" | "closed" | "talent_pool";

export type LeadTime = {
  level: LeadTimeLevel;
  /** Days since intake (open) or from intake to profiles sent (done). Null without a clock. */
  days: number | null;
  label: string;
};

export const LEAD_TIME_WARNING_DAYS = 14;
export const LEAD_TIME_LIMIT_DAYS = 21;

function wholeDays(from: string, to: Date) {
  return Math.max(0, Math.floor((to.getTime() - new Date(from).getTime()) / 86_400_000));
}

function plural(days: number) {
  return days === 1 ? "1 day" : `${days} days`;
}

export function leadTime(
  v: { intake_at: string | null; profiles_sent_at: string | null; talent_stage: string; is_talent_pool?: boolean },
  now: Date = new Date(),
  /** On hold periods: the clock stands still while a vacancy is on hold. */
  holds: HoldPeriod[] = [],
): LeadTime {
  if (v.is_talent_pool) return { level: "talent_pool", days: null, label: "No clock (talent pool)" };
  if (!v.intake_at) return { level: "none", days: null, label: "No intake" };
  if (v.profiles_sent_at) {
    const sent = new Date(v.profiles_sent_at);
    const days = Math.max(0, wholeDays(v.intake_at, sent) - daysOnHold(holds, v.intake_at, sent));
    return {
      level: days > LEAD_TIME_LIMIT_DAYS ? "warning" : "done",
      days,
      label: `Profiles after ${plural(days)}`,
    };
  }
  const days = Math.max(0, wholeDays(v.intake_at, now) - daysOnHold(holds, v.intake_at, now));
  if (v.talent_stage === "gesloten") return { level: "closed", days, label: `Closed after ${plural(days)}` };
  if (days > LEAD_TIME_LIMIT_DAYS) return { level: "danger", days, label: `${plural(days)}, past 3 weeks` };
  if (days >= LEAD_TIME_WARNING_DAYS) return { level: "warning", days, label: `${plural(days)}, nearing 3 weeks` };
  return { level: "ok", days, label: `${plural(days)} since intake` };
}
