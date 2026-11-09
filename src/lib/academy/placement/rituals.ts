// Rituals of a placement (Academy: rituelen per plaatsing): week plan on
// Monday, daily check-in, Friday review, monthly talk with Nordavo. One tick
// per ritual per period for the whole placement (academy_ritual_logs). Pure,
// mirrors academy_period_date() and academy_ritual_reminder_period() in SQL,
// tested in tests/academy-placement.test.ts.

import type { AcademyPlacementRole, AcademyRitualAudience, AcademyRitualCadence } from "@/lib/academy/database";
import { addDaysIso } from "@/lib/academy/time";
import { isoWeekday } from "./holidays";

export type RitualLike = {
  id: string;
  title: string;
  cadence: AcademyRitualCadence;
  weekday: number | null;
  audience: AcademyRitualAudience;
  active: boolean;
  position: number;
};

export type RitualLogLike = { ritual_id: string; period_date: string; done_at: string; done_by?: string | null };

/** The day a period starts: the day, the Monday of the week, the first of the month. */
export function periodStart(cadence: AcademyRitualCadence, dateIso: string): string {
  if (cadence === "daily") return dateIso;
  if (cadence === "weekly") return addDaysIso(dateIso, -(isoWeekday(dateIso) - 1));
  return `${dateIso.slice(0, 7)}-01`;
}

/** The Monday of the week of a date. */
export const weekStart = (dateIso: string) => periodStart("weekly", dateIso);

/**
 * The period a reminder is due for at this local wall clock moment, or null.
 * Daily: weekdays from 16:00. Weekly: from 16:00 on its weekday, or later in
 * that working week. Monthly: from the 20th, on working days, from 16:00.
 */
export function reminderPeriod(ritual: Pick<RitualLike, "cadence" | "weekday">, localDate: string, localHour: number): string | null {
  const dow = isoWeekday(localDate);
  if (ritual.cadence === "daily") return dow <= 5 && localHour >= 16 ? localDate : null;
  if (ritual.cadence === "weekly") {
    const day = ritual.weekday ?? 1;
    const due = dow >= day && (dow > day || localHour >= 16) && (dow <= 5 || dow === day);
    return due ? periodStart("weekly", localDate) : null;
  }
  return Number(localDate.slice(8, 10)) >= 20 && dow <= 5 && localHour >= 16 ? periodStart("monthly", localDate) : null;
}

/** May someone with this role in the placement tick this ritual? */
export function canTick(audience: AcademyRitualAudience, role: AcademyPlacementRole | null, isManager: boolean): boolean {
  if (isManager) return true;
  if (!role || role === "client_reader" || audience === "nordavo") return false;
  if (audience === "client") return role !== "developer";
  if (audience === "developer") return role === "developer";
  return true;
}

export type WeekItem = {
  ritual: RitualLike;
  periodDate: string;
  /** The day it should happen (weekly: its weekday; daily: today; monthly: the first). */
  dueDate: string;
  done: boolean;
  /** Daily: ticks this week so far. */
  doneThisWeek?: number;
  expectedThisWeek?: number;
};

/** What to tick now: today's daily rituals, this week's weekly ones, this month's monthly ones. */
export function ritualsNow(rituals: RitualLike[], logs: RitualLogLike[], today: string): WeekItem[] {
  const done = new Set(logs.map((l) => `${l.ritual_id}|${l.period_date}`));
  const monday = weekStart(today);
  const items: WeekItem[] = [];
  for (const ritual of [...rituals].filter((r) => r.active).sort((a, b) => a.position - b.position)) {
    if (ritual.cadence === "daily") {
      const days = workdaysOfWeek(monday).filter((d) => d <= today);
      items.push({
        ritual,
        periodDate: today,
        dueDate: today,
        done: done.has(`${ritual.id}|${today}`),
        doneThisWeek: days.filter((d) => done.has(`${ritual.id}|${d}`)).length,
        expectedThisWeek: days.length,
      });
    } else if (ritual.cadence === "weekly") {
      items.push({
        ritual,
        periodDate: monday,
        dueDate: addDaysIso(monday, (ritual.weekday ?? 1) - 1),
        done: done.has(`${ritual.id}|${monday}`),
      });
    } else {
      const first = periodStart("monthly", today);
      items.push({ ritual, periodDate: first, dueDate: first, done: done.has(`${ritual.id}|${first}`) });
    }
  }
  return items;
}

function workdaysOfWeek(monday: string): string[] {
  return [0, 1, 2, 3, 4].map((i) => addDaysIso(monday, i));
}

export type ConsistencyWeek = {
  weekStart: string;
  expected: number;
  done: number;
  /** null when nothing was expected (before the start). */
  percent: number | null;
  rituals: { id: string; expected: number; done: number }[];
};

export type Consistency = {
  weeks: ConsistencyWeek[];
  months: { month: string; rituals: { id: string; done: boolean }[] }[];
  /** All weeks together. */
  percent: number | null;
};

/**
 * Consistency over the weeks since the start (at most `weeks`, newest last).
 * Daily rituals count on working days from the start date up to today,
 * weekly ones once a week once their day has come. Monthly rituals are
 * counted per month.
 */
export function ritualConsistency(
  rituals: RitualLike[],
  logs: RitualLogLike[],
  options: { startDate: string; today: string; weeks?: number; months?: number },
): Consistency {
  const { startDate, today } = options;
  const maxWeeks = options.weeks ?? 8;
  const done = new Set(logs.map((l) => `${l.ritual_id}|${l.period_date}`));
  const active = rituals.filter((r) => r.active).sort((a, b) => a.position - b.position);
  const weekly = active.filter((r) => r.cadence !== "monthly");
  const monthly = active.filter((r) => r.cadence === "monthly");

  const weeks: ConsistencyWeek[] = [];
  if (startDate <= today) {
    const first = weekStart(startDate);
    let monday = weekStart(today);
    for (let i = 0; i < maxWeeks && monday >= first; i++) {
      const row: ConsistencyWeek = { weekStart: monday, expected: 0, done: 0, percent: null, rituals: [] };
      for (const ritual of weekly) {
        let expected = 0;
        let count = 0;
        if (ritual.cadence === "daily") {
          for (const day of workdaysOfWeek(monday)) {
            if (day < startDate || day > today) continue;
            expected++;
            if (done.has(`${ritual.id}|${day}`)) count++;
          }
        } else {
          const day = addDaysIso(monday, (ritual.weekday ?? 1) - 1);
          const ticked = done.has(`${ritual.id}|${monday}`);
          if ((day >= startDate && day <= today) || ticked) {
            expected = 1;
            count = ticked ? 1 : 0;
          }
        }
        row.rituals.push({ id: ritual.id, expected, done: count });
        row.expected += expected;
        row.done += count;
      }
      row.percent = row.expected === 0 ? null : Math.round((row.done / row.expected) * 100);
      weeks.unshift(row);
      monday = addDaysIso(monday, -7);
    }
  }

  const months: Consistency["months"] = [];
  if (monthly.length > 0 && startDate <= today) {
    let month = periodStart("monthly", today);
    const firstMonth = periodStart("monthly", startDate);
    for (let i = 0; i < (options.months ?? 3) && month >= firstMonth; i++) {
      months.unshift({ month, rituals: monthly.map((r) => ({ id: r.id, done: done.has(`${r.id}|${month}`) })) });
      month = periodStart("monthly", addDaysIso(month, -1));
    }
  }

  const expected = weeks.reduce((sum, w) => sum + w.expected, 0);
  const total = weeks.reduce((sum, w) => sum + w.done, 0);
  return { weeks, months, percent: expected === 0 ? null : Math.round((total / expected) * 100) };
}
