/**
 * Client rates for Sales (feedback round 3): what we charge a client, from
 * the vacancies (budget per month) and placements (monthly rate). Pure.
 */

const eur = new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

type Num = number | string | null;

function num(value: Num): number | null {
  if (value === null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** "€4,500 per month", "€4,000 to €5,000", or null when no amount is known. */
export function vacancyBudgetText(v: { monthly_budget: Num; budget_min: Num; budget_max: Num }): string | null {
  const budget = num(v.monthly_budget);
  if (budget !== null) return eur.format(budget);
  const min = num(v.budget_min);
  const max = num(v.budget_max);
  if (min !== null && max !== null) return min === max ? eur.format(min) : `${eur.format(min)} to ${eur.format(max)}`;
  if (min !== null) return `from ${eur.format(min)}`;
  if (max !== null) return `up to ${eur.format(max)}`;
  return null;
}

/**
 * Running per month: the monthly rates of active placements and those in
 * their notice period. Open budget: the monthly budget (or the top of the
 * range) of open vacancies. Null when nothing is known.
 */
export function clientRateTotals(
  placements: { status: string; monthly_rate: Num }[],
  vacancies: { status: string; monthly_budget: Num; budget_min: Num; budget_max: Num }[],
): { runningPerMonth: number | null; openBudgetPerMonth: number | null } {
  const running = placements
    .filter((p) => p.status === "active" || p.status === "notice")
    .map((p) => num(p.monthly_rate))
    .filter((n): n is number => n !== null);
  const open = vacancies
    .filter((v) => v.status === "open")
    .map((v) => num(v.monthly_budget) ?? num(v.budget_max) ?? num(v.budget_min))
    .filter((n): n is number => n !== null);
  const sum = (list: number[]) => (list.length === 0 ? null : Math.round(list.reduce((a, b) => a + b, 0) * 100) / 100);
  return { runningPerMonth: sum(running), openBudgetPerMonth: sum(open) };
}
