/**
 * Talent pool vacancies: roles Nordavo recruits for without a client or
 * prospect yet. They have no three-week clock and do not count on the
 * dashboard or in the report. Pure, used by actions, data and tests.
 */

export const TALENT_POOL_LABEL = "Talent pool";

export type VacancyOwnerType = "client" | "company" | "talent_pool";

export function isVacancyOwnerType(value: unknown): value is VacancyOwnerType {
  return value === "client" || value === "company" || value === "talent_pool";
}

/** The owner columns of a vacancy for the chosen owner type. */
export function ownerColumns(
  ownerType: VacancyOwnerType,
  ids: { client_id?: string | null; company_id?: string | null },
): { is_talent_pool: boolean; client_id: string | null; company_id: string | null } {
  if (ownerType === "talent_pool") return { is_talent_pool: true, client_id: null, company_id: null };
  if (ownerType === "client") return { is_talent_pool: false, client_id: ids.client_id ?? null, company_id: null };
  return { is_talent_pool: false, client_id: null, company_id: ids.company_id ?? null };
}

/** The owner type the form starts with for an existing vacancy. */
export function ownerTypeOf(v: {
  is_talent_pool?: boolean | null;
  client_id?: string | null;
  company_id?: string | null;
}): VacancyOwnerType {
  if (v.is_talent_pool) return "talent_pool";
  if (v.company_id && !v.client_id) return "company";
  return "client";
}

/** Whether a vacancy counts on the dashboard and in the report. */
export function countsInMetrics(v: { is_talent_pool?: boolean | null }) {
  return !v.is_talent_pool;
}

/**
 * Clock fields to set when a talent pool vacancy is linked to a client or
 * prospect. Choice: the three-week clock starts at the moment of linking,
 * not at creation. Time in the talent pool was spent without a client, so
 * counting it would put a freshly linked vacancy over (or near) the promise
 * of three candidates within three weeks on day one. So opened_at (days
 * open) becomes the linking day, and an intake date set while the vacancy
 * was in the pool moves to the linking moment (lead time). Returns nothing
 * when the vacancy was not in the talent pool or stays there.
 */
export function clockOnLink(
  current: { is_talent_pool: boolean; intake_at: string | null },
  nextIsTalentPool: boolean,
  now: Date = new Date(),
): { opened_at: string; intake_at: string | null } | null {
  if (!current.is_talent_pool || nextIsTalentPool) return null;
  return {
    opened_at: amsterdamDate(now),
    intake_at: current.intake_at ? now.toISOString() : null,
  };
}

/** YYYY-MM-DD in Europe/Amsterdam, like todayIso() in lib/format. */
function amsterdamDate(date: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Amsterdam" }).format(date);
}
