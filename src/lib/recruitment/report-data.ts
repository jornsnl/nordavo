import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import {
  buildRecruitmentReport,
  recruitmentPeriodStart,
  type RecruitmentPeriod,
  type ReportApplication,
  type ReportEvent,
  type ReportVacancy,
} from "@/lib/recruitment/report";

type Db = SupabaseClient<Database>;

const PAGE = 1000;

/** Supabase returns at most 1000 rows per request: page through. */
async function fetchAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const rows: T[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await page(offset, offset + PAGE - 1);
    if (error) throw new Error(`Could not load the recruitment report: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

/**
 * Rows for the recruitment report, read with the user's own client (RLS:
 * recruitment module). Applications created in the period, of vacancies
 * that are not talent pool vacancies; optionally of one vacancy.
 */
export async function loadRecruitmentReport(
  db: Db,
  { period, vacancyId }: { period: RecruitmentPeriod; vacancyId?: string | null },
  now = new Date(),
) {
  const from = recruitmentPeriodStart(period, now);

  const vacancyRows = await fetchAll((start, end) =>
    db
      .from("vacancies")
      .select("id, title, status, opened_at, closed_at, client:clients(name), company:companies(name)")
      .eq("is_talent_pool", false)
      .order("opened_at", { ascending: false })
      .range(start, end),
  );
  const vacancies: ReportVacancy[] = vacancyRows.map((v) => ({
    id: v.id,
    title: v.title,
    client: v.client?.name ?? v.company?.name ?? null,
    status: v.status,
    opened_at: v.opened_at,
    closed_at: v.closed_at,
  }));
  const selected = vacancyId ? vacancies.filter((v) => v.id === vacancyId) : vacancies;
  const ids = new Set(selected.map((v) => v.id));

  const applicationRows = await fetchAll((start, end) => {
    let query = db
      .from("applications")
      .select(
        "id, vacancy_id, source, origin, stage, exit_from_stage, form_completed_at, cv_score, rejection_reason, park_reason, created_at, vacancies!inner(is_talent_pool)",
      )
      .eq("vacancies.is_talent_pool", false)
      .order("created_at")
      .range(start, end);
    if (from) query = query.gte("created_at", from);
    if (vacancyId) query = query.eq("vacancy_id", vacancyId);
    return query;
  });
  const applications: ReportApplication[] = applicationRows
    .filter((a) => ids.has(a.vacancy_id))
    .map((a) => ({
      id: a.id,
      vacancy_id: a.vacancy_id,
      source: a.source,
      origin: a.origin,
      stage: a.stage,
      exit_from_stage: a.exit_from_stage,
      form_completed_at: a.form_completed_at,
      cv_score: a.cv_score,
      rejection_reason: a.rejection_reason,
      park_reason: a.park_reason,
      created_at: a.created_at,
    }));

  // History of these applications: never older than the oldest application.
  const appIds = new Set(applications.map((a) => a.id));
  const oldest = applications[0]?.created_at ?? from;
  const eventRows =
    applications.length === 0
      ? []
      : await fetchAll((start, end) => {
          let query = db
            .from("application_stage_events")
            .select("application_id, vacancy_id, to_stage, created_at")
            .order("id")
            .range(start, end);
          if (oldest) query = query.gte("created_at", oldest);
          if (vacancyId) query = query.eq("vacancy_id", vacancyId);
          return query;
        });
  const events: ReportEvent[] = eventRows
    .filter((e) => appIds.has(e.application_id))
    .map((e) => ({ application_id: e.application_id, to_stage: e.to_stage, created_at: e.created_at }));

  return {
    report: buildRecruitmentReport({ applications, events, vacancies: selected }, now),
    vacancies,
  };
}
