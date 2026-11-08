/**
 * Salary and rate conversions (recruitment brief 2.8). Pure functions.
 *
 * Fulltime: CTC per year in INR; shown per year INR, per month INR
 * (yearly / 12) and per month EUR. Freelance: hourly rate in INR, also in
 * EUR per hour. The rate is INR per EUR (for example 97.25 INR = 1 EUR).
 */

export type CtcBreakdown = {
  perYearInr: number;
  perMonthInr: number;
  perMonthEur: number | null;
};

export type HourlyBreakdown = {
  perHourInr: number;
  perHourEur: number | null;
};

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function validRate(inrPerEur: number | null | undefined): inrPerEur is number {
  return typeof inrPerEur === "number" && Number.isFinite(inrPerEur) && inrPerEur > 0;
}

export function inrToEur(inr: number, inrPerEur: number | null | undefined): number | null {
  if (!validRate(inrPerEur) || !Number.isFinite(inr)) return null;
  return round2(inr / inrPerEur);
}

export function ctcBreakdown(perYearInr: number, inrPerEur?: number | null): CtcBreakdown {
  const perMonthInr = round2(perYearInr / 12);
  return {
    perYearInr: round2(perYearInr),
    perMonthInr,
    perMonthEur: inrToEur(perYearInr / 12, inrPerEur),
  };
}

export function hourlyBreakdown(perHourInr: number, inrPerEur?: number | null): HourlyBreakdown {
  return { perHourInr: round2(perHourInr), perHourEur: inrToEur(perHourInr, inrPerEur) };
}

const UNITS: [RegExp, number][] = [
  [/^(cr|crore|crores)$/, 10_000_000],
  [/^(l|lac|lacs|lakh|lakhs|lpa)$/, 100_000],
  [/^(k|thousand)$/, 1_000],
  [/^(m|mn|million)$/, 1_000_000],
];

/**
 * An amount in rupees as candidates type it: "12,00,000", "₹ 1200000",
 * "12 LPA", "12.5 lakh", "1.2 Cr", "800/hr", "INR 950". Returns null when
 * it is not one clear amount.
 */
export function parseInrAmount(input: string | number | null | undefined): number | null {
  if (typeof input === "number") return Number.isFinite(input) && input >= 0 ? input : null;
  if (!input) return null;
  let text = input
    .toLowerCase()
    .replace(/₹|rs\.?|inr|rupees?/g, " ")
    .replace(/(per|\/)\s*(hour|hr|h|annum|year|yr|month|mo)\b/g, " ")
    .replace(/\bp\.?a\.?\b/g, " ")
    .trim();
  // Indian and western thousands separators.
  text = text.replace(/(\d),(?=\d)/g, "$1").replace(/\s+/g, " ");
  const match = /^(\d+(?:\.\d+)?)\s*([a-z]+)?$/.exec(text);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  const unit = match[2];
  if (!unit) return value;
  const factor = UNITS.find(([re]) => re.test(unit))?.[1];
  return factor ? round2(value * factor) : null;
}

const inrFormatter = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const eurFormatter = new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const eurPreciseFormatter = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** ₹12,00,000 (Indian grouping). */
export function formatInr(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "";
  return inrFormatter.format(value);
}

/** €1,030, or €10.31 for small amounts such as hourly rates. */
export function formatEur(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "";
  return Math.abs(value) < 100 ? eurPreciseFormatter.format(value) : eurFormatter.format(value);
}

/** Numeric column values from Supabase can arrive as strings. */
export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}
