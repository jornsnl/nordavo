// Open vacancies (signals of type vacature) of a company as the Leads,
// Contacts and call list tables and the lead and call screens show them:
// how many, since when online, how many days open. Pure.

import type { FactsVacancy } from "@/lib/sales/leads-database";

const amsterdamDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Amsterdam", year: "numeric", month: "2-digit", day: "2-digit" });

/** Today in Amsterdam as YYYY-MM-DD. */
export function amsterdamToday(now = Date.now()): string {
  return amsterdamDay.format(new Date(now));
}

/**
 * Days a vacancy has been online on `now`'s day in Amsterdam: 0 on the day
 * it went online, 1 the next day, and so on. Null without a date.
 */
export function daysOnline(day: string | null | undefined, now = Date.now()): number | null {
  if (!day || !/^\d{4}-\d{2}-\d{2}/.test(day)) return null;
  const from = Date.parse(`${day.slice(0, 10)}T00:00:00Z`);
  const to = Date.parse(`${amsterdamToday(now)}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.max(0, Math.round((to - from) / 86_400_000));
}

/** The day a signal went online: the posted date, else the day we first saw it (Amsterdam). */
export function onlineSince(signal: { posted_at?: string | null; first_seen_at?: string | null }): string | null {
  if (signal.posted_at) return signal.posted_at.slice(0, 10);
  return signal.first_seen_at ? amsterdamToday(Date.parse(signal.first_seen_at)) : null;
}

export type VacancyListItem = FactsVacancy & { days: number | null };

export type VacancyFacts = {
  /** Open vacancies of the company (signals), oldest first. */
  vacancy_list: VacancyListItem[];
  vacancy_count: number;
  /** "Data engineer (12d), Backend developer (3d)". */
  vacancy_titles: string | null;
  oldest_vacancy_on: string | null;
  oldest_vacancy_days: number | null;
  newest_vacancy_on: string | null;
  newest_vacancy_days: number | null;
};

export function vacancyFacts(list: FactsVacancy[], now = Date.now()): VacancyFacts {
  const items = [...list]
    .sort((a, b) => a.onlineSince.localeCompare(b.onlineSince))
    .map((v) => ({ ...v, days: daysOnline(v.onlineSince, now) }));
  const oldest = items[0] ?? null;
  const newest = items[items.length - 1] ?? null;
  return {
    vacancy_list: items,
    vacancy_count: items.length,
    vacancy_titles: items.length ? items.map((v) => `${v.title} (${v.days ?? 0}d)`).join(", ") : null,
    oldest_vacancy_on: oldest?.onlineSince ?? null,
    oldest_vacancy_days: oldest?.days ?? null,
    newest_vacancy_on: newest?.onlineSince ?? null,
    newest_vacancy_days: newest?.days ?? null,
  };
}

/** "Online since 3 Nov 2026, 9 days" for the lead and call screens. */
export function onlineLabel(day: string | null, now = Date.now()): string | null {
  if (!day) return null;
  const days = daysOnline(day, now);
  const date = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${day}T12:00:00Z`),
  );
  return `Online since ${date}${days === null ? "" : `, ${days === 1 ? "1 day" : `${days} days`}`}`;
}
