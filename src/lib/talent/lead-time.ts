/**
 * T6 doorlooptijd: days from intake to profiles sent, against the promise
 * "3 kandidaten binnen 3 weken". Pure, used in the list, detail and tests.
 */

export type LeadTimeLevel = "none" | "ok" | "warning" | "danger" | "done" | "closed";

export type LeadTime = {
  level: LeadTimeLevel;
  /** Days since intake (open) or from intake to profiles sent (done). */
  days: number | null;
  label: string;
};

export const LEAD_TIME_WARNING_DAYS = 14;
export const LEAD_TIME_LIMIT_DAYS = 21;

function wholeDays(from: string, to: Date) {
  return Math.max(0, Math.floor((to.getTime() - new Date(from).getTime()) / 86_400_000));
}

function plural(days: number) {
  return days === 1 ? "1 dag" : `${days} dagen`;
}

export function leadTime(
  v: { intake_at: string | null; profiles_sent_at: string | null; talent_stage: string },
  now: Date = new Date(),
): LeadTime {
  if (!v.intake_at) return { level: "none", days: null, label: "Geen intake" };
  if (v.profiles_sent_at) {
    const days = wholeDays(v.intake_at, new Date(v.profiles_sent_at));
    return {
      level: days > LEAD_TIME_LIMIT_DAYS ? "warning" : "done",
      days,
      label: `Profielen na ${plural(days)}`,
    };
  }
  const days = wholeDays(v.intake_at, now);
  if (v.talent_stage === "gesloten") return { level: "closed", days, label: `Gesloten na ${plural(days)}` };
  if (days > LEAD_TIME_LIMIT_DAYS) return { level: "danger", days, label: `${plural(days)}, over de 3 weken` };
  if (days >= LEAD_TIME_WARNING_DAYS) return { level: "warning", days, label: `${plural(days)}, richting 3 weken` };
  return { level: "ok", days, label: `${plural(days)} sinds intake` };
}
