// Holidays of the placement page (Academy: plaatsingspagina). The Dutch
// holidays follow rules (Easter, King's Day) and are computed; in India the
// days on a fixed date are computed too, the festival days of Karnataka come
// from the yearly state list (seeded in 20261113210000_academy_holidays.sql,
// checked by Nordavo). Pure, mirrors academy_easter() and
// academy_seed_holidays() in SQL, tested in tests/academy-placement.test.ts.

import { addDaysIso } from "@/lib/academy/time";

export type HolidayCountry = "NL" | "IN";

export type HolidayRule = {
  country: HolidayCountry;
  /** Subdivision, KA for Karnataka; null for the whole country. */
  region: string | null;
  date: string;
  nameNl: string;
  nameEn: string;
  /** False for days that are a holiday but in most jobs no day off. */
  dayOff: boolean;
};

const iso = (year: number, month: number, day: number) =>
  `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

/** Easter Sunday (Gregorian; anonymous algorithm of Meeus, Jones and Butcher). */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return iso(year, month, day);
}

/** ISO weekday, 1 (Monday) to 7 (Sunday). */
export function isoWeekday(dateIso: string): number {
  const [y, m, d] = dateIso.split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return day === 0 ? 7 : day;
}

/** The official Dutch holidays of a year. */
export function dutchHolidays(year: number): HolidayRule[] {
  const easter = easterSunday(year);
  let kings = iso(year, 4, 27);
  // On a Sunday King's Day moves to Saturday 26 April.
  if (isoWeekday(kings) === 7) kings = iso(year, 4, 26);
  const nl = (date: string, nameNl: string, nameEn: string, dayOff = true): HolidayRule => ({
    country: "NL",
    region: null,
    date,
    nameNl,
    nameEn,
    dayOff,
  });
  return [
    nl(iso(year, 1, 1), "Nieuwjaarsdag", "New Year's Day"),
    nl(addDaysIso(easter, -2), "Goede Vrijdag", "Good Friday", false),
    nl(easter, "Eerste Paasdag", "Easter Sunday"),
    nl(addDaysIso(easter, 1), "Tweede Paasdag", "Easter Monday"),
    nl(kings, "Koningsdag", "King's Day"),
    // A day off once every five years (2025, 2030) in most agreements.
    nl(iso(year, 5, 5), "Bevrijdingsdag", "Liberation Day", year % 5 === 0),
    nl(addDaysIso(easter, 39), "Hemelvaartsdag", "Ascension Day"),
    nl(addDaysIso(easter, 49), "Eerste Pinksterdag", "Whit Sunday"),
    nl(addDaysIso(easter, 50), "Tweede Pinksterdag", "Whit Monday"),
    nl(iso(year, 12, 25), "Eerste Kerstdag", "Christmas Day"),
    nl(iso(year, 12, 26), "Tweede Kerstdag", "Boxing Day"),
  ];
}

/** Indian (Karnataka) holidays on a fixed date, plus Good Friday. */
export function indiaFixedHolidays(year: number): HolidayRule[] {
  const ka = (date: string, nameNl: string, nameEn: string): HolidayRule => ({
    country: "IN",
    region: "KA",
    date,
    nameNl,
    nameEn,
    dayOff: true,
  });
  return [
    ka(iso(year, 1, 26), "Dag van de Republiek", "Republic Day"),
    ka(addDaysIso(easterSunday(year), -2), "Goede Vrijdag", "Good Friday"),
    ka(iso(year, 4, 14), "Ambedkar Jayanti", "Dr. B.R. Ambedkar Jayanti"),
    ka(iso(year, 5, 1), "Dag van de Arbeid", "May Day"),
    ka(iso(year, 8, 15), "Onafhankelijkheidsdag", "Independence Day"),
    ka(iso(year, 10, 2), "Gandhi Jayanti", "Gandhi Jayanti"),
    ka(iso(year, 11, 1), "Kannada Rajyotsava", "Kannada Rajyotsava"),
    ka(iso(year, 12, 25), "Kerstmis", "Christmas"),
  ];
}

/** Whose holidays count for someone: India for Kolkata, else the Netherlands. */
export function countryForZone(zone: string | null | undefined): HolidayCountry {
  return zone === "Asia/Kolkata" ? "IN" : "NL";
}
